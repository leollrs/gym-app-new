import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Search, Phone, Filter, Users, Clock, RotateCcw,
  CheckCircle, MessageSquare, Download, Square, CheckSquare, Send,
  UserPlus, X, Sparkles, FlaskConical, Trophy, StopCircle, Plus, ChevronDown, MoreHorizontal, Trash2,
  RefreshCw,
} from 'lucide-react';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { fetchMembersWithChurnScores } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';

// Shared components
import { PageHeader, Avatar, FilterBar, StatCard, SkeletonRow, AdminTable, AdminPageShell, AdminTabs, AdminModal } from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { ScoreBar, RiskBadge } from '../../components/admin/StatusBadge';

import { translateSignal, translateSignalName } from '../../lib/churn/signalI18n';

// Sub-components
import SendMessageModal from './components/SendMessageModal';
import WinBackModal from './components/WinBackModal';
import ContactPanel from './components/ContactPanel';
import CreateCampaignModal from './components/CreateCampaignModal';

// ── Fallback scoring when v2 pipeline fails ──────────────
async function fetchChurnFallback(gymId) {
  const now = new Date();
  const MS_PER_DAY = 86400000;
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [membersRes, checkInsRes, sessionsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, created_at').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo).order('checked_in_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
  ]);

  const memberRows = membersRes.data || [];
  logger.debug('[ChurnFallback] gymId:', gymId, 'membersRes.error:', membersRes.error, 'memberRows:', memberRows.length);
  if (!memberRows.length) return [];

  const lastCheckInMap = {};
  (checkInsRes.data || []).forEach(r => { if (!lastCheckInMap[r.profile_id]) lastCheckInMap[r.profile_id] = r.checked_in_at; });
  const sessionsLast14 = {};
  (sessionsRes.data || []).forEach(s => { sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1; });

  const nowMs = Date.now();
  return memberRows.map(m => {
    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const lastActive = lastCheckIn ?? m.created_at;
    const daysInactive = Math.floor((nowMs - new Date(lastActive)) / MS_PER_DAY);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const neverActive = !lastCheckIn && recentWorkouts === 0;
    const tenureMonths = (nowMs - new Date(m.created_at)) / (MS_PER_DAY * 30.44);
    const daysSinceLastCheckIn = lastCheckIn ? (nowMs - new Date(lastCheckIn)) / MS_PER_DAY : null;

    let score;
    if (neverActive || daysInactive > 30) score = 95;
    else if (daysInactive > 14) score = recentWorkouts === 0 ? 85 : 70;
    else if (daysInactive > 7) score = recentWorkouts === 0 ? 45 : 30;
    else score = Math.max(0, 20 - recentWorkouts * 5);
    score = Math.min(100, Math.max(0, score));

    const keySignals = [];
    if (neverActive) keySignals.push('Never logged a workout');
    else if (daysInactive > 30) keySignals.push('No activity in 30+ days');
    else if (daysInactive > 14) keySignals.push('No activity in 14+ days');
    if (recentWorkouts === 0 && !neverActive) keySignals.push('No workouts in last 14 days');
    if (keySignals.length === 0) keySignals.push('Engagement looks healthy');

    return {
      ...m,
      username: m.username || m.full_name,
      churnScore: score,
      riskTier: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low',
      keySignals,
      keySignal: keySignals[0],
      daysSinceLastCheckIn,
      lastCheckInAt: lastCheckIn,
      tenureMonths,
      velocityTrend: 'stable',
      velocityLabel: 'Not enough history',
    };
  }).sort((a, b) => b.churnScore - a.churnScore);
}

// ── Auto-detect returned members in win-back attempts ────
async function autoDetectReturns(winBackAttempts, gymId) {
  const pending = winBackAttempts.filter(a => a.outcome === 'pending' || a.outcome === 'no_response');
  if (!pending.length) return { attempts: winBackAttempts, autoDetected: [] };

  const memberIds = [...new Set(pending.map(a => a.user_id))];

  const [sessionsRes, checkInsRes] = await Promise.all([
    supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed')
      .in('profile_id', memberIds)
      .order('started_at', { ascending: true }),
    supabase.from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId)
      .in('profile_id', memberIds)
      .order('checked_in_at', { ascending: true }),
  ]);

  const sessions = sessionsRes.data || [];
  const checkIns = checkInsRes.data || [];
  const autoDetected = [];
  const toUpdate = [];

  const updated = winBackAttempts.map(a => {
    if (a.outcome !== 'pending' && a.outcome !== 'no_response') return a;

    const memberSessions = sessions.filter(s => s.profile_id === a.user_id && new Date(s.started_at) > new Date(a.created_at));
    const memberCheckIns = checkIns.filter(c => c.profile_id === a.user_id && new Date(c.checked_in_at) > new Date(a.created_at));

    if (memberSessions.length > 0 || memberCheckIns.length > 0) {
      const earliestReturn = [...memberSessions.map(s => s.started_at), ...memberCheckIns.map(c => c.checked_in_at)]
        .sort((x, y) => new Date(x) - new Date(y))[0];

      toUpdate.push(a.id);
      autoDetected.push({ attemptId: a.id, memberId: a.user_id, returnedAt: earliestReturn });
      return { ...a, outcome: 'returned', _autoDetected: true, _returnedAt: earliestReturn };
    }
    return a;
  });

  if (toUpdate.length > 0) {
    try {
      const results = await Promise.allSettled(toUpdate.map(id =>
        supabase.from('win_back_attempts').update({ outcome: 'returned' }).eq('id', id).eq('gym_id', gymId).then(res => {
          if (res.error) throw res.error;
          return res;
        })
      ));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        logger.error(`Auto-detect returns: ${failed} of ${toUpdate.length} updates failed`);
      }
    } catch (err) {
      logger.error('Auto-detect returns: batch update failed', err);
    }
  }

  return { attempts: updated, autoDetected };
}

// ── Data fetcher ──────────────────────────────────────────
async function fetchChurnData(gymId) {
  let scored;
  try {
    scored = await fetchMembersWithChurnScores(gymId, supabase);
    logger.debug('[Churn] v2 scoring returned:', scored?.length, 'members');
  } catch (err) {
    logger.error('[Churn] v2 scoring THREW:', err);
    scored = [];
  }

  if (!scored || scored.length === 0) {
    logger.debug('[Churn] v2 empty, trying fallback...');
    try {
      scored = await fetchChurnFallback(gymId);
      logger.debug('[Churn] fallback returned:', scored?.length, 'members');
    } catch (err) {
      logger.error('[Churn] fallback THREW:', err);
      scored = [];
    }
  }

  // Core queries — challenges + win-backs (original, always work)
  let challenges = [];
  let winBackRows = [];
  let contactLogRows = [];
  let campaignRows = [];

  try {
    const [challengeRes, winBackRes] = await Promise.all([
      supabase.from('challenges').select('id, name').eq('gym_id', gymId).gte('end_date', new Date().toISOString()).order('name'),
      supabase.from('win_back_attempts').select('id, user_id, message, offer, outcome, created_at').eq('gym_id', gymId).order('created_at', { ascending: false }),
    ]);
    challenges = challengeRes.data || [];
    winBackRows = winBackRes.data || [];
  } catch (err) {
    logger.error('AdminChurn: core queries failed:', err);
  }

  // Optional queries — tables/columns may not exist before migrations
  try {
    const r = await supabase.from('admin_contact_log').select('id, admin_id, member_id, method, note, created_at').eq('gym_id', gymId).order('created_at', { ascending: false });
    if (!r.error) contactLogRows = r.data || [];
  } catch (_) {}

  try {
    const r = await supabase.from('win_back_attempts').select('id, variant, message_template, responded_at').eq('gym_id', gymId);
    if (!r.error && r.data) {
      const extMap = {};
      for (const row of r.data) extMap[row.id] = row;
      winBackRows = winBackRows.map(w => ({ ...w, ...(extMap[w.id] || {}) }));
    }
  } catch (_) {}

  try {
    const r = await supabase.from('winback_campaigns').select('*').eq('gym_id', gymId).order('created_at', { ascending: false });
    if (!r.error && r.data) campaignRows = r.data;
  } catch (_) {}

  // Auto-detect returned members
  let processedWinBacks = winBackRows;
  let autoDetected = [];
  try {
    const result = await autoDetectReturns(winBackRows, gymId);
    processedWinBacks = result.attempts;
    autoDetected = result.autoDetected;
  } catch (_) {}

  // Fetch the most recent computed_at timestamp for staleness indicator
  let lastComputedAt = null;
  try {
    const { data: latestScore } = await supabase
      .from('churn_risk_scores')
      .select('computed_at')
      .eq('gym_id', gymId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestScore?.computed_at) lastComputedAt = latestScore.computed_at;
  } catch (_) {}

  return {
    members: scored,
    challenges,
    winBackAttempts: processedWinBacks,
    autoDetectedReturns: autoDetected,
    contactLogs: contactLogRows,
    campaigns: campaignRows,
    lastComputedAt,
  };
}

const outcomeConfig = {
  returned:       { i18nKey: 'admin.churn.outcomeReturned', color: 'var(--color-success, #10B981)', bg: 'color-mix(in srgb, var(--color-success, #10B981) 12%, transparent)' },
  no_response:    { i18nKey: 'admin.churn.outcomeNoResponse', color: 'var(--color-text-secondary)', bg: 'color-mix(in srgb, var(--color-text-secondary) 8%, transparent)' },
  still_inactive: { i18nKey: 'admin.churn.outcomeStillInactive', color: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  pending:        { i18nKey: 'admin.churn.outcomePending', color: 'var(--color-text-muted)', bg: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)' },
};

const METHOD_I18N = {
  in_app_message: 'admin.churn.methodMessage',
  email: 'admin.churn.methodEmail',
  push: 'admin.churn.methodPush',
  win_back: 'admin.churn.methodWinBack',
  manual: 'admin.churn.methodManual',
};

// ── Bulk Message Modal ────────────────────────────────────
function BulkMessageModal({ members, gymId, adminId, onClose, onSent }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [msg, setMsg] = useState(t('admin.churn.bulkDefaultMessage'));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    let failures = [];
    try {
      const notifications = members.map(m => ({
        profile_id: m.id, gym_id: gymId, type: 'admin_message',
        title: t('admin.churn.messageFromGym'), body: msg, data: { source: 'bulk_churn_intel' },
      }));
      const { error: notifError } = await supabase.from('notifications').insert(notifications);
      if (notifError) {
        failures.push('notifications');
        logger.error('Bulk message: notifications insert failed', notifError);
      }

      const winBackLogs = members.map(m => ({
        user_id: m.id, gym_id: gymId, admin_id: adminId,
        message: msg, offer: null, outcome: 'pending', created_at: new Date().toISOString(),
      }));
      const { error: winBackError } = await supabase.from('win_back_attempts').insert(winBackLogs);
      if (winBackError) {
        failures.push('win_back_attempts');
        logger.error('Bulk message: win_back_attempts insert failed', winBackError);
      }

      const contactEntries = members.map(m => ({
        admin_id: adminId, member_id: m.id, gym_id: gymId,
        method: 'in_app_message', note: 'Bulk message from churn intelligence',
      }));
      const { error: contactError } = await supabase.from('admin_contact_log').insert(contactEntries);
      if (contactError) {
        failures.push('admin_contact_log');
        logger.error('Bulk message: admin_contact_log insert failed', contactError);
      }

      if (failures.length === 0) {
        posthog?.capture('admin_winback_sent', { method: 'bulk_message', count: members.length });
        setSent(true);
        setTimeout(() => { onSent?.(); onClose(); }, 1200);
      } else if (failures.length < 3) {
        showToast(t('admin.churn.bulkPartialFailure', { failed: failures.length, total: 3, defaultValue: '{{failed}} of 3 operations failed. Messages may be partially saved.' }), 'warning');
        setSent(true);
        setTimeout(() => { onSent?.(); onClose(); }, 1200);
      } else {
        showToast(t('admin.churn.bulkAllFailed', { defaultValue: 'All operations failed. Please try again.' }), 'error');
      }
    } catch (err) {
      logger.error('Bulk message failed', err);
      showToast(t('admin.churn.bulkSendError', { defaultValue: 'Failed to send bulk message' }), 'error');
    } finally { setSending(false); }
  };

  return (
    <AdminModal
      isOpen={true}
      onClose={onClose}
      title={t('admin.churn.bulkMessageTitle')}
      titleIcon={MessageSquare}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            {t('admin.churn.bulkCancel')}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={sent
              ? { backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }
              : { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }
            }>
            {sent ? <><CheckCircle size={14} /> {t('admin.churn.bulkSent')}</> : sending ? t('admin.churn.bulkSending') : <><Send size={13} /> {t('admin.churn.bulkSendAll', { count: members.length })}</>}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.churn.bulkSendingTo', { count: members.length })}</p>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
          className="w-full rounded-xl px-3.5 py-3 text-[13px] outline-none resize-none"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.churn.bulkHint')}</p>
      </div>
    </AdminModal>
  );
}

// ── Member Detail Panel (right pane for at-risk tab) ─────
function MemberDetailPanel({ member, contactLogs, contactedIds, winBackAttempts, onMessage, onContact, onWinBack, t }) {
  const [showHealthy, setShowHealthy] = useState(false);

  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-14 h-14 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
          <Users size={24} className="text-[#4B5563]" />
        </div>
        <p className="text-[14px] font-semibold text-[#6B7280] mb-1">{t('admin.churn.detailEmpty', 'Select a member')}</p>
        <p className="text-[12px] text-[#4B5563]">{t('admin.churn.detailEmptySub', 'Click a row to view details')}</p>
      </div>
    );
  }

  const riskTier = member.churnScore >= 80 ? 'critical' : member.churnScore >= 55 ? 'high' : 'medium';
  const daysInactive = member.daysSinceLastCheckIn != null ? Math.round(member.daysSinceLastCheckIn) : member.daysSinceLastActivity != null ? Math.round(member.daysSinceLastActivity) : null;
  const tenureMonths = member.tenureMonths != null ? Math.round(member.tenureMonths) : null;
  const isContacted = contactedIds.has(member.id);

  const activityStatus = daysInactive === null
    ? t('admin.churn.neverActive', 'Never active')
    : daysInactive < 1
      ? t('admin.churn.activeToday', 'Active today')
      : daysInactive <= 7
        ? t('admin.churn.recentlyActive', 'Recently active')
        : t('admin.churn.inactive', 'Inactive');

  const activityColor = daysInactive === null ? 'var(--color-text-muted)' : daysInactive < 1 ? 'var(--color-success, #10B981)' : daysInactive <= 7 ? '#F59E0B' : 'var(--color-danger, #EF4444)';

  // Contact history for this member
  const memberContactLogs = contactLogs
    .filter(l => l.member_id === member.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  // Win-back attempts for this member
  const memberWinBacks = winBackAttempts
    .filter(a => a.user_id === member.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  const signals = member.keySignals || [member.keySignal].filter(Boolean);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header: Avatar + Name + Badge + Score */}
      <div className="px-4 pt-4 pb-3 border-b border-white/6">
        <div className="flex items-center gap-2.5">
          <Avatar name={member.full_name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[14px] font-bold text-[#E5E7EB] truncate">{member.full_name}</p>
              <RiskBadge tier={riskTier} />
            </div>
            {member.username && member.username !== member.full_name && (
              <p className="text-[11px] text-[#6B7280] truncate">@{member.username}</p>
            )}
          </div>
        </div>
        <div className="mt-2.5">
          <ScoreBar score={member.churnScore} />
        </div>
      </div>

      {/* Inline Stats */}
      <div className="px-4 py-3 border-b border-white/6">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.daysInactive', 'Days Inactive')}</p>
            <p className="text-[15px] font-bold text-[#E5E7EB]">{daysInactive ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.tenure', 'Tenure (mo)')}</p>
            <p className="text-[15px] font-bold text-[#E5E7EB]">{tenureMonths ?? '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.activity', 'Activity')}</p>
            <p className="text-[12px] font-bold mt-0.5" style={{ color: activityColor }}>{activityStatus}</p>
          </div>
        </div>
      </div>

      {/* Signal Breakdown — full detail */}
      {member.signals && (
        <div className="px-4 py-2.5 border-b border-white/6">
          {(() => {
            const entries = Object.entries(member.signals);
            const contributing = entries.filter(([, s]) => s.score > 0).sort((a, b) => (b[1].weightedScore ?? b[1].score) - (a[1].weightedScore ?? a[1].score));
            const healthy = entries.filter(([, s]) => s.score <= 0);
            return (
              <>
                {contributing.length > 0 && (
                  <>
                    <p className="text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churnSignals.contributingFactors', 'Contributing Factors')}</p>
                    <div className="space-y-1.5">
                      {contributing.map(([key, s]) => {
                        const pct = s.maxPts > 0 ? Math.min(100, (s.score / s.maxPts) * 100) : 0;
                        const barColor = pct >= 70 ? '#EF4444' : pct >= 40 ? '#F59E0B' : '#6B7280';
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-semibold text-[#E5E7EB]">{translateSignalName(t, key)}</span>
                              <span className="text-[9px] font-bold tabular-nums" style={{ color: barColor }}>{s.score}/{s.maxPts}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/6 overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                            </div>
                            <p className="text-[9px] text-[#6B7280] mt-0.5 truncate">{s.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {healthy.length > 0 && (
                  <div className="mt-2">
                    <button onClick={() => setShowHealthy(p => !p)} className="flex items-center gap-1 text-[9px] font-semibold text-[#4B5563] uppercase tracking-wider hover:text-[#9CA3AF] transition-colors">
                      {t('admin.churnSignals.healthySignals', 'Healthy Signals')} ({healthy.length})
                      <ChevronDown size={10} className={`transition-transform ${showHealthy ? 'rotate-180' : ''}`} />
                    </button>
                    {showHealthy && (
                      <div className="space-y-1 mt-1.5">
                        {healthy.map(([key, s]) => (
                          <div key={key} className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6B7280]">{translateSignalName(t, key)}</span>
                            <span className="text-[9px] text-[#10B981] font-medium">{s.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      {/* Fallback: key signal pills when detailed signals unavailable */}
      {!member.signals && signals.length > 0 && (
        <div className="px-4 py-2.5 border-b border-white/6">
          <div className="flex flex-wrap gap-1">
            {signals.map((sig, i) => (
              <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-[#9CA3AF] border border-white/8">
                {translateSignal(t, sig)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contact History */}
      <div className="px-4 py-2.5 border-b border-white/6">
        <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churn.contactHistory', 'Contact History')}</p>
        {memberContactLogs.length === 0 && memberWinBacks.length === 0 ? (
          <p className="text-[11px] text-[#4B5563] italic">{t('admin.churn.noContactHistory', 'No contact history')}</p>
        ) : (
          <div className="space-y-1">
            {memberContactLogs.map(log => {
              const parts = log.note?.split('\n---\n');
              const subject = parts?.[0] || null;
              const body = parts?.[1] || null;
              return (
                <details key={log.id} className="group">
                  <summary className="flex items-center gap-2 text-[11px] cursor-pointer list-none">
                    <div className="w-1 h-1 rounded-full bg-[#D4AF37] flex-shrink-0" />
                    <span className="font-medium text-[#E5E7EB]">{METHOD_I18N[log.method] ? t(METHOD_I18N[log.method]) : log.method}</span>
                    {subject && <span className="text-[#6B7280] truncate flex-1 min-w-0">— {subject}</span>}
                    <span className="text-[#4B5563] ml-auto flex-shrink-0">{format(new Date(log.created_at), 'MMM d')}</span>
                  </summary>
                  {body && (
                    <div className="ml-3 mt-1 mb-1.5 pl-2 border-l border-white/6">
                      <p className="text-[10px] text-[#6B7280] whitespace-pre-line line-clamp-4">{body}</p>
                    </div>
                  )}
                </details>
              );
            })}
            {memberWinBacks.map(wb => {
              const outCfg = outcomeConfig[wb.outcome] || outcomeConfig.pending;
              return (
                <details key={wb.id} className="group">
                  <summary className="flex items-center gap-2 text-[11px] cursor-pointer list-none">
                    <div className="w-1 h-1 rounded-full bg-[#EF4444] flex-shrink-0" />
                    <span className="font-medium text-[#E5E7EB]">{t('admin.churn.winBackAttempt', 'Win-Back')}</span>
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: outCfg.color, background: outCfg.bg, borderColor: `${outCfg.color}33` }}>{t(outCfg.i18nKey)}</span>
                    <span className="text-[#4B5563] ml-auto flex-shrink-0">{format(new Date(wb.created_at), 'MMM d')}</span>
                  </summary>
                  {wb.message && (
                    <div className="ml-3 mt-1 mb-1.5 pl-2 border-l border-white/6">
                      <p className="text-[10px] text-[#6B7280] whitespace-pre-line line-clamp-4">{wb.message}</p>
                      {wb.offer && <p className="text-[10px] text-[#D4AF37] mt-0.5">{wb.offer}</p>}
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Buttons — compact row */}
      <div className="px-4 py-3 mt-auto">
        <div className="flex gap-2">
          <button onClick={() => onMessage(member)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
            <MessageSquare size={12} /> {t('admin.churn.message', 'Message')}
          </button>
          <button onClick={() => onContact(member)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold border transition-colors ${isContacted ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'}`}>
            <Phone size={12} /> {isContacted ? t('admin.churn.contacted', 'Contacted') : t('admin.churn.contact', 'Contact')}
          </button>
          {member.churnScore >= 60 && (
            <button onClick={() => onWinBack(member)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
              <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminChurn() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('pages');

  const gymId = profile?.gym_id;
  const adminId = profile?.id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  useEffect(() => { document.title = `Admin - Churn | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

  const [tab, setTab] = useState('task-board');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('needs-action');
  const [msgModal, setMsgModal] = useState(null);
  const [winBackModal, setWinBackModal] = useState(null);
  const [contactPanel, setContactPanel] = useState(null);
  const [savingOutcome, setSavingOutcome] = useState(null);
  const [winBackVisible, setWinBackVisible] = useState(10);
  const [deletingAttempt, setDeletingAttempt] = useState(null);

  const handleDeleteAttempt = async (attemptId) => {
    try {
      const { error } = await supabase.from('win_back_attempts').delete().eq('id', attemptId).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_win_back_attempt', 'win_back_attempt', attemptId);
      await queryClient.invalidateQueries({ queryKey: adminKeys.churn.all(gymId) });
      setDeletingAttempt(null);
      showToast(t('admin.churn.attemptDeleted', 'Intento eliminado'), 'success');
    } catch (err) {
      logger.error('Delete win-back attempt failed', err);
      showToast(err.message || 'Error', 'error');
    }
  };

  const [selectedMember, setSelectedMember] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [mobileVisibleCount, setMobileVisibleCount] = useState(10);

  // A/B campaign state
  const [createCampaignModal, setCreateCampaignModal] = useState(false);

  // Bulk action state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMsgModal, setBulkMsgModal] = useState(false);
  const [bulkChallengeId, setBulkChallengeId] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const overflowMenuRef = useRef(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: adminKeys.churn.all(gymId),
    queryFn: () => fetchChurnData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const churnComputeTriggered = useRef(false);
  useEffect(() => {
    if (!gymId || churnComputeTriggered.current) return;
    churnComputeTriggered.current = true;
    supabase.rpc('compute_churn_scores', { p_gym_id: gymId })
      .then(({ error }) => {
        if (error) logger.error('Auto compute_churn_scores:', error);
        else refetch();
      });
  }, [gymId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual refresh scores
  const [refreshingScores, setRefreshingScores] = useState(false);
  const handleRefreshScores = useCallback(async () => {
    if (!gymId || refreshingScores) return;
    setRefreshingScores(true);
    try {
      const { error } = await supabase.rpc('compute_churn_scores', { p_gym_id: gymId });
      if (error) throw error;
      await refetch();
      showToast(t('admin.churn.scoresRefreshed', 'Scores refreshed'), 'success');
    } catch (err) {
      logger.error('Manual compute_churn_scores:', err);
      showToast(err.message || 'Error refreshing scores', 'error');
    } finally {
      setRefreshingScores(false);
    }
  }, [gymId, refreshingScores, refetch, showToast, t]);

  // Staleness indicator
  const lastComputedAt = data?.lastComputedAt;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const isStale = lastComputedAt ? (Date.now() - new Date(lastComputedAt).getTime()) > TWO_HOURS_MS : false;
  const dateFnsLocaleOpt = i18n.language?.startsWith('es') ? { locale: esLocale } : {};

  // Close overflow menu on click outside
  useEffect(() => {
    if (!overflowMenuOpen) return;
    const handleClickOutside = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setOverflowMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [overflowMenuOpen]);

  const members = data?.members || [];
  const challenges = data?.challenges || [];
  const contactLogs = data?.contactLogs || [];
  const [winBackAttempts, setWinBackAttempts] = useState([]);

  useEffect(() => {
    if (data?.winBackAttempts) setWinBackAttempts(data.winBackAttempts);
  }, [data?.winBackAttempts]);

  // Build contacted map from DB contact logs (keyed by member_id -> latest log)
  const contactedMap = useMemo(() => {
    const map = {};
    for (const log of contactLogs) {
      if (!map[log.member_id] || new Date(log.created_at) > new Date(map[log.member_id].created_at)) {
        map[log.member_id] = log;
      }
    }
    return map;
  }, [contactLogs]);
  const contactedIds = useMemo(() => new Set(Object.keys(contactedMap)), [contactedMap]);

  const campaigns = data?.campaigns || [];
  const activeCampaign = useMemo(() => campaigns.find(c => c.is_active), [campaigns]);

  // Campaign stats: compute per-variant metrics from win_back_attempts
  const campaignStats = useMemo(() => {
    if (!campaigns.length) return {};
    const stats = {};
    for (const campaign of campaigns) {
      const cAttempts = winBackAttempts.filter(a => a.message_template === campaign.id);
      const aAttempts = cAttempts.filter(a => a.variant === 'A');
      const bAttempts = cAttempts.filter(a => a.variant === 'B');
      const calcStats = (attempts) => {
        const sent = attempts.length;
        const responded = attempts.filter(a => a.responded_at).length;
        const returned = attempts.filter(a => a.outcome === 'returned').length;
        return {
          sent,
          responded,
          returned,
          responseRate: sent > 0 ? Math.round((responded / sent) * 100) : 0,
          returnRate: sent > 0 ? Math.round((returned / sent) * 100) : 0,
        };
      };
      stats[campaign.id] = { a: calcStats(aAttempts), b: calcStats(bAttempts) };
    }
    return stats;
  }, [campaigns, winBackAttempts]);

  const handleEndCampaign = async (campaignId, winnerVariant) => {
    try {
      const { error } = await supabase.from('winback_campaigns').update({
        is_active: false, ended_at: new Date().toISOString(),
      }).eq('id', campaignId).eq('gym_id', gymId);
      if (error) {
        logger.error('Failed to end campaign', error);
        showToast(t('admin.churn.endCampaignError', { defaultValue: 'Failed to end campaign' }), 'error');
      } else {
        refetch();
      }
    } catch (err) {
      logger.error('Failed to end campaign', err);
      showToast(t('admin.churn.endCampaignError', { defaultValue: 'Failed to end campaign' }), 'error');
    }
  };

  const atRiskMembers = useMemo(() => {
    let list = members.filter(m => m.churnScore >= 30);
    if (riskFilter === 'needs-action') list = list.filter(m => !contactedIds.has(m.id));
    else if (riskFilter === 'critical') list = list.filter(m => m.churnScore >= 80);
    else if (riskFilter === 'high') list = list.filter(m => m.churnScore >= 55);
    else if (riskFilter === 'medium') list = list.filter(m => m.churnScore >= 30 && m.churnScore < 55);
    else if (riskFilter === 'contacted') list = list.filter(m => contactedIds.has(m.id));
    else if (riskFilter === 'returned') {
      const returnedUserIds = new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id));
      list = list.filter(m => returnedUserIds.has(m.id));
    }
    if (search) { const q = search.toLowerCase(); list = list.filter(m => m.full_name.toLowerCase().includes(q)); }
    return list;
  }, [members, riskFilter, search, contactedIds, winBackAttempts]);

  const churnedMembers = useMemo(() => {
    const MS_PER_DAY = 86400000;
    return members.filter((m) => {
      const joinDays = (Date.now() - new Date(m.created_at)) / MS_PER_DAY;
      if (joinDays < 7) return false;
      const d = m.daysSinceLastActivity;
      if (d != null) return d >= 30;
      return joinDays >= 30;
    });
  }, [members]);

  const { criticalCount, highRiskCount, medRiskCount } = useMemo(() => {
    let critical = 0, high = 0, med = 0;
    for (const m of members) {
      if (m.churnScore >= 80) critical++;
      else if (m.churnScore >= 55) high++;
      else if (m.churnScore >= 30) med++;
    }
    return { criticalCount: critical, highRiskCount: high, medRiskCount: med };
  }, [members]);
  const contactedCount = contactedIds.size;
  const returnedCount = useMemo(() => winBackAttempts.filter(a => a.outcome === 'returned').length, [winBackAttempts]);

  // "Needs Action" = at-risk members who have NOT been contacted
  const needsActionMembers = useMemo(() => {
    return members.filter(m => m.churnScore >= 30 && !contactedIds.has(m.id));
  }, [members, contactedIds]);

  // "Recently Contacted" = at-risk members who HAVE been contacted
  const recentlyContactedMembers = useMemo(() => {
    return members.filter(m => m.churnScore >= 30 && contactedIds.has(m.id));
  }, [members, contactedIds]);

  // "Returned" = members with a returned win-back outcome
  const returnedMembers = useMemo(() => {
    const returnedUserIds = new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id));
    return members.filter(m => returnedUserIds.has(m.id));
  }, [members, winBackAttempts]);

  // Attribution breakdown for win-back tab
  const attributionStats = useMemo(() => {
    const stats = {};
    for (const attempt of winBackAttempts) {
      const relatedLogs = contactLogs.filter(
        l => l.member_id === attempt.user_id
          && Math.abs(new Date(l.created_at) - new Date(attempt.created_at)) < 3600000
      );
      const method = relatedLogs.length > 0 ? relatedLogs[0].method : 'in_app_message';
      if (!stats[method]) stats[method] = { sent: 0, returned: 0 };
      stats[method].sent++;
      if (attempt.outcome === 'returned') stats[method].returned++;
    }
    return stats;
  }, [winBackAttempts, contactLogs]);

  // Bulk action helpers
  const selectedCount = selectedIds.size;
  const selectedMembers = useMemo(() => atRiskMembers.filter(m => selectedIds.has(m.id)), [atRiskMembers, selectedIds]);
  const toggleSelected = (id) => { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const selectAllByTier = (tier) => {
    const tierMembers = atRiskMembers.filter(m => {
      if (tier === 'critical') return m.churnScore >= 80;
      if (tier === 'high') return m.churnScore >= 55 && m.churnScore < 80;
      if (tier === 'medium') return m.churnScore >= 30 && m.churnScore < 55;
      return false;
    });
    setSelectedIds(prev => { const next = new Set(prev); tierMembers.forEach(m => next.add(m.id)); return next; });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectAllVisible = () => {
    setSelectedIds(new Set(atRiskMembers.map(m => m.id)));
  };
  const allVisibleSelected = atRiskMembers.length > 0 && atRiskMembers.every(m => selectedIds.has(m.id));

  const handleBulkAddToChallenge = async (challengeId) => {
    if (!challengeId || selectedMembers.length === 0) return;
    setBulkActionLoading(true);
    try {
      const rows = selectedMembers.map(m => ({ profile_id: m.id, challenge_id: challengeId, gym_id: gymId, score: 0 }));
      const { error } = await supabase.from('challenge_participants').upsert(rows, { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true });
      if (error) {
        logger.error('Bulk add to challenge failed', error);
        showToast(t('admin.churn.bulkChallengeError', { defaultValue: 'Failed to add members to challenge. Please try again.' }), 'error');
      } else {
        showToast(t('admin.churn.bulkChallengeSuccess', { count: selectedMembers.length, defaultValue: '{{count}} members added to challenge' }), 'success');
        clearSelection();
      }
    } catch (err) {
      logger.error('Bulk add to challenge failed', err);
      showToast(t('admin.churn.bulkChallengeError', { defaultValue: 'Failed to add members to challenge. Please try again.' }), 'error');
    }
    finally { setBulkActionLoading(false); setBulkChallengeId(''); }
  };

  const handleBulkMarkContacted = async () => {
    try {
      const entries = selectedMembers.map(m => ({ admin_id: adminId, member_id: m.id, gym_id: gymId, method: 'manual', note: 'Bulk mark contacted' }));
      const { error } = await supabase.from('admin_contact_log').insert(entries);
      if (error) {
        logger.error('Bulk mark contacted failed', error);
        showToast(t('admin.churn.bulkContactError', { defaultValue: 'Failed to mark members as contacted' }), 'error');
      } else {
        showToast(t('admin.churn.bulkContactSuccess', { count: selectedMembers.length, defaultValue: '{{count}} members marked as contacted' }), 'success');
        clearSelection();
        refetch();
      }
    } catch (err) {
      logger.error('Bulk mark contacted failed', err);
      showToast(t('admin.churn.bulkContactError', { defaultValue: 'Failed to mark members as contacted' }), 'error');
    }
  };

  // DB-backed contact logging
  const handleMarkContacted = useCallback(async (memberId, method = 'manual', note = null) => {
    try {
      await supabase.from('admin_contact_log').insert({ admin_id: adminId, member_id: memberId, gym_id: gymId, method, note });
      refetch();
    } catch (err) { logger.error('Failed to log contact', err); }
  }, [adminId, gymId, refetch]);

  const handleUnmarkContacted = useCallback(async (memberId) => {
    try {
      await supabase.from('admin_contact_log').delete().eq('member_id', memberId).eq('gym_id', gymId);
      refetch();
    } catch (err) { logger.error('Failed to unmark contact', err); }
  }, [gymId, refetch]);

  const handleAddToChallenge = async (member, challengeId) => {
    if (!challengeId) return;
    try {
      const { error } = await supabase.from('challenge_participants').upsert(
        { profile_id: member.id, challenge_id: challengeId, gym_id: gymId, score: 0 },
        { onConflict: 'profile_id,challenge_id', ignoreDuplicates: true }
      );
      if (error) {
        logger.error('Add to challenge failed', error);
        showToast(t('admin.churn.addChallengeError', { defaultValue: 'Failed to add member to challenge' }), 'error');
      }
    } catch (err) {
      logger.error('Add to challenge failed', err);
      showToast(t('admin.churn.addChallengeError', { defaultValue: 'Failed to add member to challenge' }), 'error');
    }
  };

  const handleMarkOutcome = async (attemptId, outcome) => {
    setSavingOutcome(attemptId);
    try {
      const { error } = await supabase.from('win_back_attempts').update({ outcome }).eq('id', attemptId).eq('gym_id', gymId);
      if (error) {
        logger.error('Mark outcome failed', error);
        showToast(t('admin.churn.outcomeError', { defaultValue: 'Failed to update outcome' }), 'error');
      } else {
        logAdminAction('update_win_back_outcome', 'win_back_attempt', attemptId, { outcome });
        setWinBackAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, outcome } : a));
      }
    } catch (err) {
      logger.error('Mark outcome failed', err);
      showToast(t('admin.churn.outcomeError', { defaultValue: 'Failed to update outcome' }), 'error');
    } finally { setSavingOutcome(null); }
  };

  const handleExport = () => {
    const visibleData = tab === 'task-board' ? atRiskMembers : tab === 'churned' ? churnedMembers : winBackAttempts;
    // Translate signals and velocity labels for the CSV
    const translatedData = visibleData.map(m => ({
      ...m,
      keySignals: Array.isArray(m.keySignals)
        ? m.keySignals.map(s => translateSignal(t, s)).join(', ')
        : m.keySignal ? translateSignal(t, m.keySignal) : '',
      velocityLabel: m.velocityLabel ? translateSignal(t, m.velocityLabel) : '',
    }));
    exportCSV({
      filename: `churn-${tab}`,
      columns: [
        { key: 'full_name', label: t('admin.churn.csvName', 'Name') },
        { key: 'churnScore', label: t('admin.churn.csvScore', 'Score') },
        { key: 'risk_tier', label: t('admin.churn.csvRiskTier', 'Risk Tier') },
        { key: 'keySignals', label: t('admin.churn.csvSignals', 'Key Signals') },
        { key: 'daysSinceLastCheckIn', label: t('admin.churn.csvDaysInactive', 'Days Inactive') },
        { key: 'velocityLabel', label: t('admin.churn.csvVelocity', 'Velocity') },
      ],
      data: translatedData,
    });
  };

  const PRIMARY_TABS = [
    { key: 'task-board', label: t('admin.churn.tabTaskBoard', 'Retention Board'), count: needsActionMembers.length },
  ];
  const SECONDARY_TABS = [
    { key: 'churned', label: t('admin.churn.tabChurned', 'Churned'), count: churnedMembers.length },
    { key: 'win-back', label: t('admin.churn.tabWinBack', 'Win-Back'), count: winBackAttempts.length },
    { key: 'campaigns', label: t('admin.churn.tabCampaigns', 'Campaigns'), count: campaigns.length },
  ];
  const TABS = [...PRIMARY_TABS, ...SECONDARY_TABS];

  const QUEUE_FILTERS = [
    { key: 'needs-action', label: t('admin.churn.filterNeedsAction', 'Needs Action'), count: needsActionMembers.length },
    { key: 'critical', label: t('admin.churn.filterCritical', 'Critical'), count: criticalCount },
    { key: 'high', label: t('admin.churn.filterHigh', 'High'), count: highRiskCount },
    { key: 'contacted', label: t('admin.churn.filterContacted', 'Recently Contacted'), count: recentlyContactedMembers.length },
    { key: 'returned', label: t('admin.churn.filterReturned', 'Returned'), count: returnedMembers.length },
  ];

  // Helper: get top N signals for a member as { name, label } pairs
  const getTopSignals = (m, count = 2) => {
    if (m.signals) {
      return Object.entries(m.signals)
        .filter(([, s]) => s.score > 0)
        .sort((a, b) => (b[1].weightedScore ?? b[1].score) - (a[1].weightedScore ?? a[1].score))
        .slice(0, count)
        .map(([key, s]) => ({ name: translateSignalName(t, key), pct: s.maxPts > 0 ? Math.min(100, (s.score / s.maxPts) * 100) : 0 }));
    }
    return (m.keySignals || [m.keySignal]).filter(Boolean).slice(0, count).map(sig => ({ name: translateSignal(t, sig), pct: 50 }));
  };

  // Helper: check if member has returned (check-in or workout after being at-risk)
  const returnedUserIds = useMemo(() => new Set(winBackAttempts.filter(a => a.outcome === 'returned').map(a => a.user_id)), [winBackAttempts]);

  // Helper: contact count per member
  const contactCountMap = useMemo(() => {
    const map = {};
    for (const log of contactLogs) {
      map[log.member_id] = (map[log.member_id] || 0) + 1;
    }
    return map;
  }, [contactLogs]);

  const atRiskTableColumns = [
    {
      key: 'select',
      label: '',
      width: '40px',
      render: (m) => (
        <button onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }} aria-label={selectedIds.has(m.id) ? t('admin.churn.deselectMember', 'Deselect member') : t('admin.churn.selectMember', 'Select member')} className="text-[#6B7280] hover:text-[#D4AF37] transition-colors">
          {selectedIds.has(m.id) ? <CheckSquare size={16} className="text-[#D4AF37]" /> : <Square size={16} />}
        </button>
      ),
    },
    {
      key: 'full_name',
      label: t('admin.churn.colMember', 'Member'),
      sortable: true,
      sortValue: (m) => m.full_name?.toLowerCase() || '',
      render: (m) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={m.full_name} />
          <span className="text-[13px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</span>
        </div>
      ),
    },
    {
      key: 'churnScore',
      label: t('admin.churn.score', 'Score'),
      sortable: true,
      sortValue: (m) => m.churnScore ?? 0,
      width: '140px',
      render: (m) => <ScoreBar score={m.churnScore} />,
    },
    {
      key: 'signals',
      label: t('admin.churn.colSignals', 'Top Signals'),
      render: (m) => {
        const pills = getTopSignals(m, 2);
        return (
          <div className="flex flex-wrap gap-1">
            {pills.map((p, i) => {
              const pillColor = p.pct >= 70 ? 'bg-[#EF4444]/12 text-[#EF4444] border-[#EF4444]/20' : p.pct >= 40 ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20' : 'bg-white/5 text-[#9CA3AF] border-white/8';
              return (
                <span key={i} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border truncate max-w-[140px] ${pillColor}`}>
                  {p.name}
                </span>
              );
            })}
            {pills.length === 0 && <span className="text-[10px] text-[#4B5563] italic">--</span>}
          </div>
        );
      },
    },
    {
      key: 'daysInactive',
      label: t('admin.churn.daysInactive', 'Days Inactive'),
      sortable: true,
      numeric: true,
      width: '100px',
      sortValue: (m) => m.daysSinceLastCheckIn ?? 9999,
      render: (m) => {
        const days = m.daysSinceLastCheckIn != null ? Math.round(m.daysSinceLastCheckIn) : null;
        const color = days === null ? 'var(--color-text-muted)' : days < 7 ? 'var(--color-success, #10B981)' : days < 14 ? '#F59E0B' : 'var(--color-danger, #EF4444)';
        return (
          <span className="text-[13px] font-bold tabular-nums" style={{ color }}>
            {days ?? '--'}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      width: '200px',
      render: (m) => {
        const isContacted = contactedIds.has(m.id);
        const contactCount = contactCountMap[m.id] || 0;
        const hasReturned = returnedUserIds.has(m.id);
        return (
          <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
            {hasReturned && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/20 whitespace-nowrap">
                {t('admin.churn.returnedBadge', 'Returned')}
              </span>
            )}
            {isContacted && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 whitespace-nowrap">
                {contactCount > 1 ? t('admin.churn.contactCountBadge', { count: contactCount, defaultValue: '{{count}} contacts' }) : t('admin.churn.contacted', 'Contacted')}
              </span>
            )}
            <button onClick={() => setMsgModal(m)} title={t('admin.churn.message', 'Message')}
              aria-label={t('admin.churn.message', 'Message')}
              className="p-1.5 rounded-lg text-[#D4AF37] hover:bg-[#D4AF37]/12 transition-colors">
              <MessageSquare size={15} />
            </button>
            <button onClick={() => setContactPanel(m)} title={t('admin.churn.contact', 'Contact')}
              aria-label={t('admin.churn.contact', 'Contact')}
              className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/6 transition-colors">
              <Phone size={15} />
            </button>
          </div>
        );
      },
    },
  ];

  const loading = isLoading;

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[#EF4444] text-[14px] font-semibold">{t('admin.churn.accessDenied')}</p>
      </div>
    );
  }

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.churn.title', 'Churn Intelligence')}
        subtitle={loading ? t('admin.churn.analyzing', 'Analyzing member activity…') : `${criticalCount} ${t('admin.churn.critical', 'critical')} · ${highRiskCount} ${t('admin.churn.highRisk', 'high risk')} · ${medRiskCount} ${t('admin.churn.mediumRisk', 'medium risk')} · ${churnedMembers.length} ${t('admin.churn.churned', 'churned')}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handleRefreshScores} disabled={refreshingScores}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors disabled:opacity-50"
              title={t('admin.churn.refreshScores', 'Refresh Scores')}>
              <RefreshCw size={13} className={refreshingScores ? 'animate-spin' : ''} /> {t('admin.churn.refreshScores', 'Refresh Scores')}
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors">
              <Download size={13} /> {t('admin.churn.export', 'Export')}
            </button>
          </div>
        }
      />

      {/* Staleness indicator */}
      {!loading && lastComputedAt && (
        <div className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl text-[12px] ${isStale ? 'bg-[#F59E0B]/8 border border-[#F59E0B]/20' : 'bg-white/3 border border-white/6'}`}>
          <Clock size={13} className={isStale ? 'text-[#F59E0B]' : 'text-[#6B7280]'} />
          <span className={isStale ? 'text-[#F59E0B] font-medium' : 'text-[#6B7280]'}>
            {t('admin.churn.lastUpdated', 'Scores last updated')}: {formatDistanceToNow(new Date(lastComputedAt), { addSuffix: true, ...dateFnsLocaleOpt })}
          </span>
          {isStale && (
            <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F59E0B]/12 text-[#F59E0B] border border-[#F59E0B]/20">
              {t('admin.churn.scoresOutdated', 'Scores may be outdated')}
            </span>
          )}
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-6">
        {[
          { label: t('admin.churn.critical', 'Critical'), value: loading ? '—' : criticalCount, color: '#DC2626', sub: t('admin.churn.scoreGte80', 'score ≥ 80'), filterKey: 'critical' },
          { label: t('admin.churn.highRisk', 'High Risk'), value: loading ? '—' : highRiskCount, color: '#EF4444', sub: t('admin.churn.score5579', 'score 55–79'), filterKey: 'high' },
          { label: t('admin.churn.filterContacted', 'Contacted'), value: loading ? '—' : contactedCount, color: 'var(--color-accent)', sub: t('admin.churn.contactedSub', 'outreach logged'), filterKey: 'contacted' },
          { label: t('admin.churn.filterReturned', 'Returned'), value: loading ? '—' : returnedCount, color: 'var(--color-success, #10B981)', sub: t('admin.churn.returnedSub', 'came back'), filterKey: 'returned' },
        ].map(card => (
          <button key={card.label} onClick={() => { setTab('task-board'); setRiskFilter(card.filterKey); }}
            className={`text-left bg-[#0F172A] border rounded-[14px] p-4 border-l-2 overflow-hidden transition-colors hover:border-white/15 ${tab === 'task-board' && riskFilter === card.filterKey ? 'border-white/20 ring-1 ring-white/10' : 'border-white/8'}`}
            style={{ borderLeftColor: card.color }}>
            <p className="text-[24px] font-bold leading-none truncate" style={{ color: card.color }}>{card.value}</p>
            <p className="text-[12px] font-semibold text-[#E5E7EB] mt-1.5 truncate">{card.label}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">{card.sub}</p>
          </button>
        ))}
      </div>

      {/* Tab Bar */}
      <AdminTabs tabs={TABS} active={tab} onChange={setTab} className="mb-4" />

      <SwipeableTabContent tabs={TABS} active={tab} onChange={setTab}>
        {(tabKey) => {
          if (tabKey === 'task-board') return (
        <div>
          {/* Queue Filters — single horizontal scrollable row */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex overflow-x-auto scrollbar-hide gap-1.5 -mx-1 px-1 pb-1">
              {QUEUE_FILTERS.map(f => (
                <button key={f.key} onClick={() => setRiskFilter(f.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-colors whitespace-nowrap flex-shrink-0 ${riskFilter === f.key ? 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25' : 'text-[#6B7280] border border-white/6 hover:text-[#E5E7EB] hover:border-white/12'}`}>
                  {f.label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${riskFilter === f.key ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/8 text-[#4B5563]'}`}>{f.count}</span>
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
              <input type="text" placeholder={t('admin.churn.searchMembers', 'Search members…')} aria-label={t('admin.churn.searchMembers', 'Search members')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
            </div>
          </div>

          {/* Bulk action bar — only visible when members are selected */}
          {!loading && atRiskMembers.length > 0 && selectedCount > 0 && (
            <div className="mb-4 px-3 md:px-4 py-3 rounded-xl flex items-center gap-2 md:gap-3 bg-[#D4AF37]/8 border border-[#D4AF37]/20">
              <button onClick={allVisibleSelected ? clearSelection : selectAllVisible}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-[#D4AF37] hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
                {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                {t('admin.churn.selectAllVisible', 'Select All')}
              </button>
              <div className="h-4 w-px bg-[#D4AF37]/20" />
              <span className="text-[12px] font-semibold text-[#D4AF37] whitespace-nowrap">
                {t('admin.churn.selectedCount', { count: selectedCount, defaultValue: '{{count}} selected' })}
              </span>
              <div className="h-4 w-px bg-[#D4AF37]/20" />
              <button onClick={() => setBulkMsgModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors whitespace-nowrap">
                <MessageSquare size={12} /> {t('admin.churn.messageSelected', 'Message Selected')}
              </button>
              <button onClick={() => { if (selectedCount > 0) { setWinBackModal(selectedMembers[0]); } }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors whitespace-nowrap">
                <RotateCcw size={12} /> {t('admin.churn.winBackSelected', 'Win-Back Selected')}
              </button>
              {/* Overflow menu for secondary actions */}
              <div className="relative ml-auto" ref={overflowMenuRef}>
                <button onClick={() => setOverflowMenuOpen(prev => !prev)}
                  aria-label={t('admin.churn.moreActions', 'More actions')}
                  className="p-1.5 rounded-lg text-[#D4AF37] hover:bg-[#D4AF37]/12 transition-colors">
                  <MoreHorizontal size={16} />
                </button>
                {overflowMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[#1E293B] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                    {challenges.length > 0 && (
                      <div className="border-b border-white/6">
                        <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.addAllToChallenge', 'Add to Challenge')}</p>
                        {challenges.map(c => (
                          <button key={c.id} onClick={() => { handleBulkAddToChallenge(c.id); setOverflowMenuOpen(false); }}
                            className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/6 transition-colors truncate">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { handleBulkMarkContacted(); setOverflowMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[#10B981] hover:bg-white/6 transition-colors">
                      <CheckCircle size={13} /> {t('admin.churn.markAllContacted', 'Mark Contacted')}
                    </button>
                    <button onClick={() => { clearSelection(); setOverflowMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-[#EF4444] hover:bg-white/6 transition-colors">
                      <X size={13} /> {t('admin.churn.clearSelection', 'Clear Selection')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </div>
          ) : atRiskMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4"><CheckCircle size={22} className="text-[#10B981]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noAtRisk', 'No at-risk members')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.retentionHealthy', 'Your member retention is looking healthy right now.')}</p>
            </div>
          ) : (
            <div>
              {/* Desktop two-pane layout */}
              <div className="hidden lg:flex gap-4 items-start">
                <div className="w-full lg:w-[60%] lg:flex-shrink-0">
                  <AdminTable columns={atRiskTableColumns} data={atRiskMembers} stickyHeader onRowClick={(m) => setSelectedMember(m)} activeRowId={selectedMember?.id} />
                </div>
                <div className="hidden lg:block flex-1 min-w-0 sticky top-4">
                  <div className="w-full bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
                    <MemberDetailPanel
                      member={selectedMember}
                      contactLogs={contactLogs}
                      contactedIds={contactedIds}
                      winBackAttempts={winBackAttempts}
                      onMessage={(m) => setMsgModal(m)}
                      onContact={(m) => setContactPanel(m)}
                      onWinBack={(m) => setWinBackModal(m)}
                      t={t}
                    />
                  </div>
                </div>
              </div>
              {/* Mobile card list */}
              <div className="lg:hidden bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden divide-y divide-white/4">
                {atRiskMembers.slice(0, mobileVisibleCount).map(m => {
                  const isContacted = contactedIds.has(m.id);
                  const mContactCount = contactCountMap[m.id] || 0;
                  const isSelected = selectedIds.has(m.id);
                  const hasReturned = returnedUserIds.has(m.id);
                  const pills = getTopSignals(m, 2);
                  const daysInactive = m.daysSinceLastCheckIn != null ? Math.round(m.daysSinceLastCheckIn) : null;
                  const daysColor = daysInactive === null ? 'var(--color-text-muted)' : daysInactive < 7 ? 'var(--color-success, #10B981)' : daysInactive < 14 ? '#F59E0B' : 'var(--color-danger, #EF4444)';
                  return (
                    <div key={m.id} onClick={() => { setSelectedMember(m); setMobileDetailOpen(true); }}
                      role="button" tabIndex={0} aria-label={t('admin.churn.viewMemberDetails', { name: m.full_name, defaultValue: 'View details for {{name}}' })}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMember(m); setMobileDetailOpen(true); } }}
                      className={`px-4 py-3.5 hover:bg-white/[0.03] transition-all cursor-pointer ${isSelected ? 'bg-[#D4AF37]/[0.04]' : ''}`}>
                      <div className="flex items-start gap-3">
                        <button onClick={(e) => { e.stopPropagation(); toggleSelected(m.id); }} aria-label={isSelected ? t('admin.churn.deselectMember', 'Deselect member') : t('admin.churn.selectMember', 'Select member')} className="mt-1 flex-shrink-0 text-[#6B7280] hover:text-[#D4AF37] transition-colors">
                          {isSelected ? <CheckSquare size={16} className="text-[#D4AF37]" /> : <Square size={16} />}
                        </button>
                        <Avatar name={m.full_name} />
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Name + badges */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                            <p className="text-[13px] font-semibold text-[#E5E7EB]">{m.full_name}</p>
                            <RiskBadge tier={m.churnScore >= 80 ? 'critical' : m.churnScore >= 55 ? 'high' : 'medium'} />
                            {hasReturned && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/20">
                                {t('admin.churn.returnedBadge', 'Returned')}
                              </span>
                            )}
                            {isContacted && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20">
                                {mContactCount > 1 ? t('admin.churn.contactCountBadge', { count: mContactCount, defaultValue: '{{count}} contacts' }) : t('admin.churn.contacted', 'Contacted')}
                              </span>
                            )}
                          </div>
                          {/* Row 2: Score bar */}
                          <div className="mb-1.5"><ScoreBar score={m.churnScore} /></div>
                          {/* Row 3: Top signal pills + days inactive */}
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            {pills.map((p, i) => {
                              const pillColor = p.pct >= 70 ? 'bg-[#EF4444]/12 text-[#EF4444] border-[#EF4444]/20' : p.pct >= 40 ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20' : 'bg-white/5 text-[#9CA3AF] border-white/8';
                              return (
                                <span key={i} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border truncate max-w-[130px] ${pillColor}`}>
                                  {p.name}
                                </span>
                              );
                            })}
                            <span className="text-[11px] font-bold tabular-nums ml-auto" style={{ color: daysColor }}>
                              {daysInactive != null ? t('admin.churn.daysInactiveShort', { days: daysInactive, defaultValue: '{{days}}d inactive' }) : t('admin.churn.neverActive', 'Never active')}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Action row */}
                      <div className="flex items-center gap-2 mt-2.5 pl-[68px] flex-wrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setMsgModal(m)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 hover:bg-[#D4AF37]/18 transition-colors">
                          <MessageSquare size={12} /> {t('admin.churn.message', 'Message')}
                        </button>
                        <button onClick={() => setContactPanel(m)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors">
                          <Phone size={12} /> {t('admin.churn.contact', 'Contact')}
                        </button>
                        {m.churnScore >= 60 && (
                          <button onClick={() => setWinBackModal(m)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
                            <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {atRiskMembers.length > mobileVisibleCount && (
                <button onClick={() => setMobileVisibleCount(c => c + 10)}
                  className="lg:hidden w-full mt-3 py-3 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 border border-[#D4AF37]/20 hover:bg-[#D4AF37]/15 transition-colors">
                  {t('admin.churn.loadMore', 'Load more')} ({atRiskMembers.length - mobileVisibleCount} {t('admin.churn.remaining', 'remaining')})
                </button>
              )}
            </div>
          )}
        </div>
          );
          if (tabKey === 'churned') return (
        <div>
          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : churnedMembers.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4"><Users size={22} className="text-[#10B981]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noChurned', 'No churned members')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.allActive', 'All members have been active in the last 30 days.')}</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 md:gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colMember', 'Member')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">{t('admin.churn.colLastSeen', 'Last Seen')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">{t('admin.churn.colTenure', 'Tenure')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colAction', 'Action')}</p>
              </div>
              <div className="divide-y divide-white/4">
                {churnedMembers.map(m => {
                  const lastSeen = m.lastActivityAt
                    ? formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true })
                    : t('admin.churn.noRecentActivity', 'No recent activity');
                  const tenureLabel = m.tenureMonths < 1 ? t('admin.churn.lessThanMonth', 'Less than 1 month') : `${Math.round(m.tenureMonths)} ${t('admin.churn.months', 'months')}`;
                  return (
                    <div key={m.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 md:gap-4 px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={m.full_name} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                          <p className="text-[11px] text-[#6B7280] sm:hidden">{lastSeen}</p>
                        </div>
                      </div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[#9CA3AF]">{lastSeen}</p></div>
                      <div className="hidden sm:block text-right"><p className="text-[12px] text-[#9CA3AF]">{tenureLabel}</p></div>
                      <button onClick={() => setWinBackModal(m)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors flex-shrink-0">
                        <RotateCcw size={12} /> {t('admin.churn.winBack', 'Win Back')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
          );
          if (tabKey === 'win-back') return (
        <div>
          {!loading && winBackAttempts.length > 0 && Object.keys(attributionStats).length > 0 && (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 mb-4">
              <p className="text-[12px] font-semibold text-[#E5E7EB] mb-2">{t('admin.churn.attributionTitle', 'Outreach Attribution')}</p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(attributionStats).map(([method, stats]) => {
                  const rate = stats.sent > 0 ? Math.round((stats.returned / stats.sent) * 100) : 0;
                  return (
                    <span key={method} className="text-[11px] text-[#9CA3AF]">
                      <span className="font-semibold text-[#E5E7EB]">{METHOD_I18N[method] ? t(METHOD_I18N[method]) : method}:</span>{' '}
                      {t('admin.churn.sentCount', { count: stats.sent, defaultValue: '{{count}} sent' })},{' '}
                      <span className={stats.returned > 0 ? 'text-[#10B981]' : ''}>{t('admin.churn.returnedCount', { count: stats.returned, defaultValue: '{{count}} returned' })}</span>{' '}
                      ({rate}%)
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">{[...Array(3)].map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : winBackAttempts.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4"><RotateCcw size={22} className="text-[#D4AF37]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noWinBacks', 'No win-back attempts yet')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.useChurnedTab', 'Use the Churned tab to send win-back messages to inactive members.')}</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 md:gap-4 px-4 py-2.5 border-b border-white/6">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colMemberMessage', 'Member / Message')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider hidden sm:block">{t('admin.churn.colDate', 'Date')}</p>
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider">{t('admin.churn.colOutcome', 'Outcome')}</p>
              </div>
              <div className="divide-y divide-white/4">
                {winBackAttempts.slice(0, winBackVisible).map(attempt => {
                  const m = members.find(mem => mem.id === attempt.user_id);
                  const memberName = m?.full_name ?? t('admin.churn.unknownMember', 'Unknown Member');
                  const outcome = attempt.outcome ?? 'pending';
                  const outcomeCfg = outcomeConfig[outcome] ?? outcomeConfig.pending;
                  const isSaving = savingOutcome === attempt.id;
                  const relatedLog = contactLogs.find(l => l.member_id === attempt.user_id && Math.abs(new Date(l.created_at) - new Date(attempt.created_at)) < 3600000);
                  const contactMethod = relatedLog?.method;

                  return (
                    <div key={attempt.id} className="px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] items-start gap-2 md:gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="text-[13px] font-semibold text-[#E5E7EB]">{memberName}</p>
                            {contactMethod && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/6 text-[#9CA3AF]">{METHOD_I18N[contactMethod] ? t(METHOD_I18N[contactMethod]) : contactMethod}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#6B7280] line-clamp-2">{attempt.message}</p>
                          {attempt.offer && <p className="text-[11px] text-[#D4AF37] mt-0.5">{t('admin.churn.offer', 'Offer')}: {attempt.offer}</p>}
                          {attempt._autoDetected && attempt._returnedAt && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Sparkles size={11} className="text-[#10B981]" />
                              <span className="text-[10px] font-semibold text-[#10B981]">
                                {t('admin.churn.autoDetected', { date: format(new Date(attempt._returnedAt), 'MMM d, yyyy'), defaultValue: 'Auto-detected: Member returned on {{date}}' })}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <p className="text-[12px] text-[#9CA3AF]">{format(new Date(attempt.created_at), 'MMM d')}</p>
                          <p className="text-[10px] text-[#4B5563]">{format(new Date(attempt.created_at), 'yyyy')}</p>
                        </div>
                        <div className="flex-shrink-0">
                          <span className="text-[11px] font-semibold px-2 py-1 rounded-full border" style={{ color: outcomeCfg.color, background: outcomeCfg.bg, borderColor: `${outcomeCfg.color}33` }}>
                            {t(outcomeCfg.i18nKey)}
                          </span>
                        </div>
                      </div>
                      {/* Viewed timestamp */}
                      {attempt.updated_at && attempt.updated_at !== attempt.created_at && (
                        <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                          {t('admin.churn.viewedAt', 'Visto')}: {format(new Date(attempt.updated_at), 'dd MMM yyyy, HH:mm')}
                        </p>
                      )}
                      <div className="flex gap-2 mt-2.5 flex-wrap">
                        {outcome !== 'returned' && (
                          <>
                            <button onClick={() => handleMarkOutcome(attempt.id, 'returned')} disabled={isSaving}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 hover:bg-[#10B981]/18 transition-colors disabled:opacity-40">
                              <CheckCircle size={11} /> {t('admin.churn.markReturned', 'Mark Returned')}
                            </button>
                            {outcome !== 'no_response' && (
                              <button onClick={() => handleMarkOutcome(attempt.id, 'no_response')} disabled={isSaving}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors disabled:opacity-40">
                                {t('admin.churn.noResponse', 'No Response')}
                              </button>
                            )}
                            {outcome !== 'still_inactive' && (
                              <button onClick={() => handleMarkOutcome(attempt.id, 'still_inactive')} disabled={isSaving}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F59E0B]/8 text-[#F59E0B] border border-[#F59E0B]/15 hover:bg-[#F59E0B]/15 transition-colors disabled:opacity-40">
                                {t('admin.churn.stillInactive', 'Still Inactive')}
                              </button>
                            )}
                          </>
                        )}
                        {deletingAttempt === attempt.id ? (
                          <div className="flex gap-1.5 ml-auto">
                            <button onClick={() => handleDeleteAttempt(attempt.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-400/25 hover:bg-red-500/25 transition-colors">
                              <Trash2 size={11} /> {t('admin.churn.confirmDelete', 'Confirm?')}
                            </button>
                            <button onClick={() => setDeletingAttempt(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#9CA3AF] border border-white/8 hover:text-[#E5E7EB] transition-colors">
                              {t('admin.churn.bulkCancel')}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDeletingAttempt(attempt.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors ml-auto">
                            <Trash2 size={11} /> {t('admin.churn.deleteAttempt', 'Delete')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {winBackAttempts.length > winBackVisible && (
                <button onClick={() => setWinBackVisible(v => v + 10)}
                  className="w-full py-3 text-[12px] font-semibold transition-colors" style={{ color: 'var(--color-accent)', borderTop: '1px solid var(--color-border-subtle)' }}>
                  {t('admin.churn.showMore', 'Show more')} ({winBackAttempts.length - winBackVisible} {t('admin.churn.remaining', 'remaining')})
                </button>
              )}
              <p className="text-[11px] text-center py-2" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border-subtle)' }}>
                {Math.min(winBackVisible, winBackAttempts.length)} / {winBackAttempts.length}
              </p>
            </div>
          )}
        </div>
          );
          if (tabKey === 'campaigns') return (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FlaskConical size={15} className="text-[#D4AF37]" />
              <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('admin.churn.ab.title', 'A/B Campaigns')}</p>
            </div>
            <button onClick={() => setCreateCampaignModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors">
              <Plus size={13} /> {t('admin.churn.ab.newCampaign', 'New Campaign')}
            </button>
          </div>
          {campaigns.length === 0 ? (
            <div className="bg-[#0F172A] border border-white/6 rounded-[14px] p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center mx-auto mb-4"><FlaskConical size={22} className="text-[#D4AF37]" /></div>
              <p className="text-[15px] font-semibold text-[#E5E7EB] mb-1">{t('admin.churn.noCampaigns', 'No campaigns yet')}</p>
              <p className="text-[13px] text-[#6B7280]">{t('admin.churn.createCampaignHint', 'Create an A/B campaign to test different win-back strategies.')}</p>
            </div>
          ) : (
            campaigns.map(campaign => {
              const stats = campaignStats[campaign.id] || { a: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 }, b: { sent: 0, responded: 0, returned: 0, responseRate: 0, returnRate: 0 } };
              const aWins = stats.a.returnRate > stats.b.returnRate;
              const bWins = stats.b.returnRate > stats.a.returnRate;
              const tied = stats.a.returnRate === stats.b.returnRate;
              const totalSent = stats.a.sent + stats.b.sent;

              return (
                <div key={campaign.id} className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/6">
                    <div className="flex items-center gap-2.5">
                      <FlaskConical size={14} className="text-[#D4AF37]" />
                      <div>
                        <p className="text-[13px] font-semibold text-[#E5E7EB]">{campaign.name}</p>
                        <p className="text-[10px] text-[#6B7280]">
                          {t(`admin.churn.campaign.tier.${campaign.target_tier}`, campaign.target_tier)} {t('admin.churn.ab.tier', 'tier')}
                          {' · '}{totalSent} {t('admin.churn.ab.sent', 'sent')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${campaign.is_active ? 'bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/20' : 'bg-white/6 text-[#6B7280] border border-white/8'}`}>
                        {campaign.is_active ? t('admin.churn.ab.active', 'Active') : t('admin.churn.ab.ended', 'Ended')}
                      </span>
                      {campaign.is_active && totalSent >= 2 && (
                        <button onClick={() => handleEndCampaign(campaign.id, aWins ? 'A' : 'B')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/18 transition-colors">
                          <StopCircle size={11} /> {t('admin.churn.ab.endCampaign', 'End')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-4">
                    {[
                      { key: 'A', label: t('admin.churn.ab.variantA', 'Variant A'), data: campaign.variant_a, stat: stats.a, isWinner: aWins && !tied && totalSent >= 2 },
                      { key: 'B', label: t('admin.churn.ab.variantB', 'Variant B'), data: campaign.variant_b, stat: stats.b, isWinner: bWins && !tied && totalSent >= 2 },
                    ].map(v => (
                      <div key={v.key} className={`rounded-xl p-3.5 border transition-colors ${v.isWinner ? 'bg-[#10B981]/5 border-[#10B981]/25' : 'bg-[#111827] border-white/6'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          <p className="text-[12px] font-semibold text-[#E5E7EB]">{v.label}</p>
                          {v.isWinner && (
                            <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981]">
                              <Trophy size={10} /> {t('admin.churn.ab.winner', 'Winner')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#9CA3AF] mb-0.5 truncate">
                          {v.data.offer_type || t('admin.churn.ab.noOffer', 'No offer')}
                          {v.data.discount_pct ? ` (${v.data.discount_pct}%)` : ''}
                          {v.data.free_days ? ` · ${v.data.free_days}d ${t('admin.churn.ab.free', 'free')}` : ''}
                        </p>
                        {v.data.message && (
                          <p className="text-[10px] text-[#6B7280] line-clamp-2 mb-3">{v.data.message}</p>
                        )}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.numSent', 'Sent')}</span>
                            <span className="text-[12px] font-semibold text-[#E5E7EB]">{v.stat.sent}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.responseRate', 'Response Rate')}</span>
                            <span className={`text-[12px] font-semibold ${v.stat.responseRate > 0 ? 'text-[#D4AF37]' : 'text-[#6B7280]'}`}>{v.stat.responseRate}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6B7280]">{t('admin.churn.ab.returnRate', 'Return Rate')}</span>
                            <span className={`text-[12px] font-bold ${v.stat.returnRate > 0 ? 'text-[#10B981]' : 'text-[#6B7280]'}`}>{v.stat.returnRate}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
          );
          return null;
        }}
      </SwipeableTabContent>

      {/* Mobile detail sheet */}
      {mobileDetailOpen && selectedMember && createPortal(
        <div className="lg:hidden fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setMobileDetailOpen(false)}>
          <div className="w-full max-w-md max-h-[85vh] bg-[#0F172A] border border-white/8 rounded-[14px] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <MemberDetailPanel
              member={selectedMember}
              contactLogs={contactLogs}
              contactedIds={contactedIds}
              winBackAttempts={winBackAttempts}
              onMessage={(m) => { setMobileDetailOpen(false); setMsgModal(m); }}
              onContact={(m) => { setMobileDetailOpen(false); setContactPanel(m); }}
              onWinBack={(m) => { setMobileDetailOpen(false); setWinBackModal(m); }}
              t={t}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Modals */}
      {msgModal && <SendMessageModal member={msgModal} gymId={gymId} adminId={adminId} onClose={() => setMsgModal(null)} onSent={() => { setMsgModal(null); handleMarkContacted(msgModal.id, 'in_app_message'); }} />}
      {winBackModal && <WinBackModal member={winBackModal} gymId={gymId} adminId={adminId} activeCampaign={activeCampaign} onClose={() => setWinBackModal(null)}
        onSent={() => { setWinBackModal(null); handleMarkContacted(winBackModal.id, 'win_back'); refetch(); }} />}
      {contactPanel && <ContactPanel member={contactPanel} gymId={gymId} adminId={adminId}
        isContacted={contactedIds.has(contactPanel.id)}
        contactedAt={contactedMap[contactPanel.id]?.created_at}
        onMarkContacted={handleMarkContacted}
        onUnmarkContacted={handleUnmarkContacted}
        onOpenMessage={() => { setContactPanel(null); setMsgModal(contactPanel); }}
        onClose={() => setContactPanel(null)} />}
      {bulkMsgModal && <BulkMessageModal members={selectedMembers} gymId={gymId} adminId={adminId}
        onClose={() => setBulkMsgModal(false)} onSent={() => { clearSelection(); refetch(); }} />}
      {createCampaignModal && <CreateCampaignModal gymId={gymId}
        onClose={() => setCreateCampaignModal(false)} onCreated={() => { setCreateCampaignModal(false); refetch(); }} />}
    </AdminPageShell>
  );
}
