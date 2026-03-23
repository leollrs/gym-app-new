import { useEffect, useState } from 'react';
import { Trophy, FileText, Save, Send, UserCheck, UserX, Ban, X, QrCode } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notifications';
import logger from '../../../lib/logger';
import { getRiskTier } from '../../../lib/churnScore';
import { Avatar, SectionLabel } from '../../../components/admin';
import { StatusBadge } from '../../../components/admin/StatusBadge';

const statusActionMap = {
  freeze:     { next: 'frozen',      label: 'Freeze Account',      btnColor: 'text-[#60A5FA]',  btnBg: 'bg-[#60A5FA]/10 border-[#60A5FA]/20' },
  deactivate: { next: 'deactivated', label: 'Deactivate Account',  btnColor: 'text-[#F97316]',  btnBg: 'bg-[#F97316]/10 border-[#F97316]/20' },
  cancel:     { next: 'cancelled',   label: 'Cancel Membership',   btnColor: 'text-[#9CA3AF]',  btnBg: 'bg-white/6 border-white/10' },
  ban:        { next: 'banned',      label: 'Ban Member',          btnColor: 'text-[#EF4444]',  btnBg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
  reactivate: { next: 'active',      label: 'Reactivate',          btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
  unban:      { next: 'active',      label: 'Unban',               btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
};

const outcomeConfig = {
  returned:    { label: 'Member returned', color: 'text-[#10B981]', bg: 'bg-[#10B981]/10 border-[#10B981]/20' },
  no_response: { label: 'No response',     color: 'text-[#9CA3AF]', bg: 'bg-white/6 border-white/10' },
  cancelled:   { label: 'Cancelled',       color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
};

function getStatusActions(status) {
  switch (status) {
    case 'active':      return ['freeze', 'deactivate', 'ban'];
    case 'frozen':      return ['reactivate', 'deactivate', 'ban'];
    case 'deactivated': return ['reactivate', 'ban'];
    case 'cancelled':   return ['reactivate', 'ban'];
    case 'banned':      return ['unban'];
    default:            return [];
  }
}

export default function MemberDetail({ member, gymId, onClose, onNoteSaved, onStatusChanged }) {
  const [sessions, setSessions] = useState([]);
  const [prs, setPrs] = useState([]);
  const [challenges, setChallenges] = useState(0);
  const [note, setNote] = useState(member.admin_note ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('workouts');

  const [memberStatus, setMemberStatus] = useState(member.membership_status ?? 'active');
  const [statusReason, setStatusReason] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [externalId, setExternalId] = useState(member.qr_external_id ?? '');
  const [externalIdSaving, setExternalIdSaving] = useState(false);

  const [followupMsg, setFollowupMsg] = useState(
    `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.`
  );
  const [followupSending, setFollowupSending] = useState(false);
  const [followupSentAt, setFollowupSentAt] = useState(null);
  const [followupOutcome, setFollowupOutcome] = useState(null);
  const [outcomeSaving, setOutcomeSaving] = useState(false);
  const [churnRowId, setChurnRowId] = useState(null);

  const isFollowupCandidate = member.score >= 31;
  const risk = getRiskTier(member.score);

  useEffect(() => {
    const load = async () => {
      const [sessRes, prRes, chalRes] = await Promise.all([
        supabase.from('workout_sessions').select('id, name, started_at, duration_seconds, total_volume_lbs').eq('profile_id', member.id).eq('status', 'completed').order('started_at', { ascending: false }).limit(10),
        supabase.from('personal_records').select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)').eq('profile_id', member.id).order('estimated_1rm', { ascending: false }).limit(8),
        supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('profile_id', member.id),
      ]);
      if (sessRes.error) logger.error('MemberModal: sessions:', sessRes.error);
      if (prRes.error) logger.error('MemberModal: PRs:', prRes.error);
      setSessions(sessRes.data || []);
      setPrs(prRes.data || []);
      setChallenges(chalRes.count ?? 0);

      if (isFollowupCandidate) {
        const { data: churnRow } = await supabase.from('churn_risk_scores').select('id, followup_sent_at, followup_outcome').eq('profile_id', member.id).eq('gym_id', gymId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (churnRow) {
          setChurnRowId(churnRow.id);
          setFollowupSentAt(churnRow.followup_sent_at ?? null);
          setFollowupOutcome(churnRow.followup_outcome ?? null);
        }
      }
      setLoading(false);
    };
    load();
  }, [member.id, gymId, isFollowupCandidate]);

  const handleSaveNote = async () => {
    setNoteSaving(true);
    await supabase.from('profiles').update({ admin_note: note || null }).eq('id', member.id);
    setNoteSaving(false);
    onNoteSaved(member.id, note);
  };

  const handleSaveExternalId = async () => {
    setExternalIdSaving(true);
    const payload = externalId.trim() || null;
    await supabase.from('profiles').update({
      qr_external_id: payload,
      qr_code_payload: payload,
    }).eq('id', member.id);
    setExternalIdSaving(false);
  };

  const handleConfirmStatusAction = async () => {
    if (!pendingAction) return;
    setStatusSaving(true);
    const nextStatus = statusActionMap[pendingAction].next;
    await supabase.from('profiles').update({
      membership_status: nextStatus,
      membership_status_updated_at: new Date().toISOString(),
      membership_status_reason: statusReason || null,
    }).eq('id', member.id);
    setMemberStatus(nextStatus);
    setPendingAction(null);
    setStatusReason('');
    setStatusSaving(false);
    onStatusChanged?.(member.id, nextStatus);
  };

  const handleSendFollowup = async () => {
    setFollowupSending(true);
    await createNotification({ profileId: member.id, gymId, type: 'churn_followup', title: 'Message from your gym', body: followupMsg, data: { source: 'admin_followup' } });
    const now = new Date().toISOString();
    if (churnRowId) await supabase.from('churn_risk_scores').update({ followup_sent_at: now }).eq('id', churnRowId);
    setFollowupSentAt(now);
    setFollowupSending(false);
  };

  const handleSetOutcome = async (outcome) => {
    if (!churnRowId) return;
    setOutcomeSaving(true);
    await supabase.from('churn_risk_scores').update({ followup_outcome: outcome }).eq('id', churnRowId);
    setFollowupOutcome(outcome);
    setOutcomeSaving(false);
  };

  const daysInactive = member.daysInactive ?? 0;
  const neverActive = member.neverActive ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-[14px] w-full max-w-lg md:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Avatar name={member.full_name} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold text-[#E5E7EB]">{member.full_name}</p>
                <StatusBadge status={memberStatus} />
              </div>
              <p className="text-[11px] text-[#6B7280]">@{member.username} · joined {format(new Date(member.created_at), 'MMM yyyy')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors"><X size={20} /></button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/6 flex-shrink-0">
          {[
            { label: 'Risk', value: <span className={risk.textClass}>{risk.label}</span>, sub: `score ${member.score}%` },
            { label: 'Inactive', value: `${daysInactive}d`, sub: neverActive ? 'never logged' : 'days' },
            { label: 'Workouts', value: member.recentWorkouts ?? 0, sub: 'last 14d' },
            { label: 'Challenges', value: challenges, sub: 'joined' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="py-3 px-2 text-center border-r border-white/4 last:border-0">
              <p className="text-[15px] font-bold text-[#E5E7EB] leading-none">{value}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{label}</p>
              <p className="text-[10px] text-[#4B5563]">{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/6 flex-shrink-0">
          {[{ key: 'workouts', label: 'Workouts' }, { key: 'prs', label: 'PRs' }].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${tab === t.key ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
            </div>
          ) : tab === 'workouts' ? (
            sessions.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-6">No workouts logged</p>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-[#111827] rounded-xl">
                    <div>
                      <p className="text-[13px] font-medium text-[#E5E7EB]">{s.name || 'Workout'}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(s.started_at), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="text-right">
                      {s.total_volume_lbs > 0 && <p className="text-[12px] font-semibold text-[#9CA3AF]">{Math.round(s.total_volume_lbs).toLocaleString()} lbs</p>}
                      {s.duration_seconds > 0 && <p className="text-[11px] text-[#6B7280]">{Math.floor(s.duration_seconds / 60)}m</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            prs.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-6">No PRs recorded yet</p>
            ) : (
              <div className="space-y-2">
                {prs.map((pr, i) => (
                  <div key={pr.exercise_id} className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${i < 3 ? 'bg-[#D4AF37]/12' : 'bg-white/4'}`}>
                      <Trophy size={13} className={i < 3 ? 'text-[#D4AF37]' : 'text-[#4B5563]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{pr.exercises?.name ?? pr.exercise_id}</p>
                      {pr.achieved_at && <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d, yyyy')}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-bold text-[#E5E7EB]">{pr.weight_lbs} lbs × {pr.reps}</p>
                      {pr.estimated_1rm > 0 && <p className="text-[10px] text-[#6B7280]">{Math.round(pr.estimated_1rm)} lbs est. 1RM</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Membership */}
          <div>
            <SectionLabel icon={UserCheck} className="mb-3">Membership</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[#6B7280]">Status</p>
                <StatusBadge status={memberStatus} />
              </div>
              {!pendingAction && (
                <div className="flex flex-wrap gap-2">
                  {getStatusActions(memberStatus).map(action => {
                    const cfg = statusActionMap[action];
                    return (
                      <button key={action} onClick={() => setPendingAction(action)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${cfg.btnColor} ${cfg.btnBg}`}>
                        {action === 'ban' || action === 'cancel' ? <UserX size={12} /> : action === 'freeze' ? <Ban size={12} /> : <UserCheck size={12} />}
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {pendingAction && (
                <div className="space-y-2">
                  <p className="text-[12px] text-[#E5E7EB]">Are you sure you want to <span className="font-semibold">{statusActionMap[pendingAction].label.toLowerCase()}</span>?</p>
                  <input type="text" value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="Reason (optional)"
                    className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40" />
                  <div className="flex gap-2">
                    <button onClick={handleConfirmStatusAction} disabled={statusSaving}
                      className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40">
                      {statusSaving ? 'Saving…' : 'Confirm'}
                    </button>
                    <button onClick={() => { setPendingAction(null); setStatusReason(''); }}
                      className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* QR / External ID */}
          <div>
            <SectionLabel icon={QrCode} className="mb-3">QR Code / External ID</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">External ID</label>
                <p className="text-[11px] text-[#4B5563] mb-1.5">The code from your gym's existing system (e.g. keypad code, barcode number)</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={externalId}
                    onChange={e => setExternalId(e.target.value)}
                    placeholder="e.g. 4821 or MBR-0042"
                    className="flex-1 bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 font-mono"
                  />
                  <button
                    onClick={handleSaveExternalId}
                    disabled={externalIdSaving || externalId === (member.qr_external_id ?? '')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}
                  >
                    <Save size={12} />
                    {externalIdSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              {member.qr_code_payload && (
                <div className="flex items-center justify-between pt-2 border-t border-white/4">
                  <p className="text-[11px] text-[#6B7280]">Current QR payload</p>
                  <p className="text-[12px] font-mono font-semibold text-[#D4AF37]">{member.qr_code_payload}</p>
                </div>
              )}
            </div>
          </div>

          {/* Churn follow-up */}
          {isFollowupCandidate && (
            <div>
              <SectionLabel icon={Send} className="mb-3">Send Follow-up</SectionLabel>
              <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
                {followupSentAt ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[#6B7280]">Follow-up sent <span className="text-[#9CA3AF] font-medium">{format(new Date(followupSentAt), 'MMM d, yyyy')}</span></p>
                    <div>
                      <p className="text-[11px] text-[#6B7280] mb-2">Outcome</p>
                      {followupOutcome ? (
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig[followupOutcome]?.color} ${outcomeConfig[followupOutcome]?.bg}`}>
                          {outcomeConfig[followupOutcome]?.label}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(outcomeConfig).map(([key, cfg]) => (
                            <button key={key} onClick={() => handleSetOutcome(key)} disabled={outcomeSaving}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${cfg.color} ${cfg.bg}`}>
                              {cfg.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea value={followupMsg} onChange={e => setFollowupMsg(e.target.value)} rows={3}
                      className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
                    <button onClick={handleSendFollowup} disabled={followupSending || !followupMsg.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                      style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}>
                      <Send size={12} /> {followupSending ? 'Sending…' : 'Send Follow-up'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Admin note */}
          <div>
            <SectionLabel icon={FileText} className="mb-2">Admin Note</SectionLabel>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="e.g. Reached out Jan 5 — no response. At risk of churning."
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
            <button onClick={handleSaveNote} disabled={noteSaving || note === (member.admin_note ?? '')}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
              style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}>
              <Save size={12} /> {noteSaving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
