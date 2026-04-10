import { useEffect, useState, useRef } from 'react';
import { Trophy, FileText, Save, Send, UserCheck, UserX, Ban, X, QrCode, KeyRound, Copy, Check, Share2, AlertTriangle, User } from 'lucide-react';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { supabase } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import { useAuth } from '../../../contexts/AuthContext';
import logger from '../../../lib/logger';
import { getRiskTier } from '../../../lib/churnScore';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';
import { Avatar, SectionLabel, AdminModal } from '../../../components/admin';
import { StatusBadge } from '../../../components/admin/StatusBadge';

const statusActionMap = {
  freeze:     { next: 'frozen',      labelKey: 'freeze',      label: 'Freeze Account',      btnColor: 'text-[#60A5FA]',  btnBg: 'bg-[#60A5FA]/10 border-[#60A5FA]/20' },
  deactivate: { next: 'deactivated', labelKey: 'deactivate',  label: 'Deactivate Account',  btnColor: 'text-[#F97316]',  btnBg: 'bg-[#F97316]/10 border-[#F97316]/20' },
  cancel:     { next: 'cancelled',   labelKey: 'cancel',      label: 'Cancel Membership',   btnColor: 'text-[#9CA3AF]',  btnBg: 'bg-white/6 border-white/10' },
  ban:        { next: 'banned',      labelKey: 'ban',         label: 'Ban Member',          btnColor: 'text-[#EF4444]',  btnBg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
  reactivate: { next: 'active',      labelKey: 'reactivate',  label: 'Reactivate',          btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
  unban:      { next: 'active',      labelKey: 'unban',       label: 'Unban',               btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
};

const outcomeConfig = {
  returned:    { labelKey: 'admin.memberDetail.outcomeReturned', label: 'Member returned', color: 'text-[#10B981]', bg: 'bg-[#10B981]/10 border-[#10B981]/20' },
  no_response: { labelKey: 'admin.memberDetail.outcomeNoResponse', label: 'No response',     color: 'text-[#9CA3AF]', bg: 'bg-white/6 border-white/10' },
  cancelled:   { labelKey: 'admin.memberDetail.outcomeCancelled', label: 'Cancelled',       color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
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
  const { user: authUser } = useAuth();
  const adminId = authUser?.id;
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [sessions, setSessions] = useState([]);
  const [prs, setPrs] = useState([]);
  const [challenges, setChallenges] = useState(0);
  const [note, setNote] = useState(member.admin_note ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('workouts');
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);

  // Referral state
  const [referralCode, setReferralCode] = useState('');
  const [referrals, setReferrals] = useState([]);
  const [referralCount, setReferralCount] = useState(0);

  // Invite code for this member
  const [memberInvite, setMemberInvite] = useState(null); // { invite_code, created_at, used_at }
  const [inviteCopied, setInviteCopied] = useState(false);

  const [memberStatus, setMemberStatus] = useState(member.membership_status ?? 'active');
  const [memberStatusUpdatedAt, setMemberStatusUpdatedAt] = useState(member.membership_status_updated_at ?? null);
  const [statusReason, setStatusReason] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusConflict, setStatusConflict] = useState(false);

  const [externalId, setExternalId] = useState(member.qr_external_id ?? '');
  const [externalIdSaving, setExternalIdSaving] = useState(false);

  const [memberName, setMemberName] = useState(member.full_name ?? '');
  const [memberUsername, setMemberUsername] = useState(member.username ?? '');
  const [memberEmail, setMemberEmail] = useState(member.email ?? '');
  const originalEmailRef = useRef(member.email ?? '');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [memberPhone, setMemberPhone] = useState('');
  const originalPhoneRef = useRef('');
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  // Workouts "see more" toggle
  const [showAllWorkouts, setShowAllWorkouts] = useState(false);

  // Password reset state
  const [resetCode, setResetCode] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  const [followupMsg, setFollowupMsg] = useState(
    t('admin.memberDetail.followupDefault', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.` })
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
        supabase.from('personal_records').select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)').eq('profile_id', member.id).order('achieved_at', { ascending: false }).limit(20),
        supabase.from('challenge_participants').select('id', { count: 'exact', head: true }).eq('profile_id', member.id),
      ]);
      if (sessRes.error) logger.error('MemberModal: sessions:', sessRes.error);
      if (prRes.error) logger.error('MemberModal: PRs:', prRes.error);
      setSessions(sessRes.data || []);
      // Filter out PRs with missing data and deduplicate by exercise (keep best per exercise)
      const rawPrs = prRes.data || [];
      const bestByExercise = new Map();
      rawPrs.forEach(pr => {
        const existing = bestByExercise.get(pr.exercise_id);
        if (!existing || (pr.estimated_1rm || 0) > (existing.estimated_1rm || 0)) {
          bestByExercise.set(pr.exercise_id, pr);
        }
      });
      const dedupedPrs = Array.from(bestByExercise.values())
        .sort((a, b) => (b.estimated_1rm || 0) - (a.estimated_1rm || 0));
      setPrs(dedupedPrs);
      setChallenges(chalRes.count ?? 0);

      if (isFollowupCandidate) {
        const { data: churnRow } = await supabase.from('churn_risk_scores').select('id, followup_sent_at, followup_outcome').eq('profile_id', member.id).eq('gym_id', gymId).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (churnRow) {
          setChurnRowId(churnRow.id);
          setFollowupSentAt(churnRow.followup_sent_at ?? null);
          setFollowupOutcome(churnRow.followup_outcome ?? null);
        }
      }

      // Load referral data
      const [refProfileRes, refListRes] = await Promise.all([
        supabase.from('profiles').select('referral_code').eq('id', member.id).single(),
        supabase.from('referrals').select('id, referred_id, status, created_at, profiles!referrals_referred_id_fkey(full_name)').eq('referrer_id', member.id).eq('gym_id', gymId).order('created_at', { ascending: false }).limit(50),
      ]);
      if (refProfileRes.data?.referral_code) setReferralCode(refProfileRes.data.referral_code);

      // Fetch the invite code used by this member (check both tables)
      const { data: inviteRow } = await supabase
        .from('gym_invites')
        .select('invite_code, created_at, used_at')
        .eq('gym_id', gymId)
        .eq('used_by', member.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inviteRow) {
        setMemberInvite(inviteRow);
      } else {
        // Also check member_invites table (alternative invite system)
        const { data: memberInviteRow } = await supabase
          .from('member_invites')
          .select('invite_code, created_at, claimed_at')
          .eq('claimed_by', member.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (memberInviteRow) {
          setMemberInvite({
            invite_code: memberInviteRow.invite_code,
            created_at: memberInviteRow.created_at,
            used_at: memberInviteRow.claimed_at,
          });
        }
      }

      // Fetch phone_number separately (column may not exist yet pre-migration)
      try {
        const { data: phoneData } = await supabase.from('profiles').select('phone_number').eq('id', member.id).single();
        if (phoneData?.phone_number) {
          setMemberPhone(phoneData.phone_number);
          originalPhoneRef.current = phoneData.phone_number;
        }
      } catch { /* column not deployed yet — ignore */ }

      // Fetch email from auth.users via RPC
      if (!member.email) {
        try {
          const { data: emailData } = await supabase.rpc('admin_get_member_email', { p_member_id: member.id });
          if (emailData) {
            setMemberEmail(emailData);
            originalEmailRef.current = emailData;
          }
        } catch {}
      }
      const refList = refListRes.data || [];
      setReferrals(refList);
      setReferralCount(refList.length);

      setLoading(false);
    };
    load();
  }, [member.id, gymId, isFollowupCandidate]);

  const handleSaveNote = async () => {
    setNoteSaving(true);
    await supabase.from('profiles').update({ admin_note: note || null }).eq('id', member.id).eq('gym_id', gymId);
    logAdminAction('update_note', 'member', member.id, { note: note?.substring(0, 100) });
    setNoteSaving(false);
    onNoteSaved(member.id, note);
  };

  const handleSaveExternalId = async () => {
    setExternalIdSaving(true);
    const payload = externalId.trim() || null;
    await supabase.from('profiles').update({
      qr_external_id: payload,
      qr_code_payload: payload,
    }).eq('id', member.id).eq('gym_id', gymId);
    setExternalIdSaving(false);
  };

  const handleSaveInfo = async () => {
    setInfoSaving(true);
    setInfoSaved(false);
    const updates = {};
    if (memberName.trim() && memberName !== member.full_name) updates.full_name = memberName.trim();
    if (memberUsername.trim() && memberUsername !== member.username) updates.username = memberUsername.trim();
    const phoneVal = memberPhone.trim() || null;
    if (phoneVal !== (originalPhoneRef.current || null)) updates.phone_number = phoneVal;
    if (Object.keys(updates).length > 0) {
      await supabase.from('profiles').update(updates).eq('id', member.id).eq('gym_id', gymId);
      logAdminAction('update_info', 'member', member.id);
    }
    setInfoSaving(false);
    setInfoSaved(true);
    setTimeout(() => setInfoSaved(false), 2000);
  };

  const handleSaveEmail = async () => {
    if (!memberEmail.trim() || memberEmail === originalEmailRef.current) return;
    setEmailSaving(true);
    setEmailSaved(false);
    try {
      // Update email in both auth.users and profiles via RPC
      const { error } = await supabase.rpc('admin_update_member_email', {
        p_member_id: member.id,
        p_new_email: memberEmail.trim(),
      });
      if (error) throw error;
      logAdminAction('update_email', 'member', member.id, { email: memberEmail.trim() });
      originalEmailRef.current = memberEmail.trim();
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2000);
    } catch (err) {
      logger.error('Failed to update email:', err);
      showToast?.(err?.message || t('admin.members.emailUpdateFailed', 'Failed to update email'), 'error');
    }
    setEmailSaving(false);
  };

  const handleGenerateResetCode = async () => {
    setResetLoading(true);
    setResetError('');
    setCodeCopied(false);
    try {
      const { data, error } = await supabase.rpc('admin_generate_password_reset', { p_profile_id: member.id });
      if (error) throw error;
      setResetCode(data);
    } catch (err) {
      setResetError(err.message || 'Failed to generate reset code.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!resetCode) return;
    try {
      await navigator.clipboard.writeText(String(resetCode));
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      setCodeCopied(false);
    }
  };

  const refetchMemberStatus = async () => {
    const { data } = await supabase.from('profiles')
      .select('membership_status, membership_status_updated_at')
      .eq('id', member.id).eq('gym_id', gymId).single();
    if (data) {
      setMemberStatus(data.membership_status ?? 'active');
      setMemberStatusUpdatedAt(data.membership_status_updated_at ?? null);
    }
  };

  const handleConfirmStatusAction = async () => {
    if (!pendingAction) return;
    setStatusSaving(true);
    setStatusConflict(false);
    const nextStatus = statusActionMap[pendingAction].next;
    const oldStatus = memberStatus;
    const now = new Date().toISOString();

    // Optimistic locking: only update if the record hasn't been modified since we loaded it
    let query = supabase.from('profiles').update({
      membership_status: nextStatus,
      membership_status_updated_at: now,
      membership_status_reason: statusReason || null,
    }).eq('id', member.id).eq('gym_id', gymId);

    if (memberStatusUpdatedAt) {
      query = query.eq('membership_status_updated_at', memberStatusUpdatedAt);
    } else {
      query = query.is('membership_status_updated_at', null);
    }

    const { data, error } = await query.select('id');
    const rowsUpdated = data?.length ?? 0;

    if (error || rowsUpdated === 0) {
      // Conflict: another admin modified this member — refetch and alert
      await refetchMemberStatus();
      setStatusConflict(true);
      setStatusSaving(false);
      return;
    }

    logAdminAction('change_status', 'member', member.id, { from: oldStatus, to: nextStatus });
    if (nextStatus === 'frozen') posthog?.capture('admin_member_frozen');
    setMemberStatus(nextStatus);
    setMemberStatusUpdatedAt(now);
    setPendingAction(null);
    setShowStatusConfirm(false);
    setStatusReason('');
    setStatusSaving(false);
    onStatusChanged?.(member.id, nextStatus);
  };

  const handleSendFollowup = async () => {
    setFollowupSending(true);
    try {
      const { data: convoId } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
      if (convoId) {
        const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
        const seed = convo?.encryption_seed || convoId;
        const encrypted = await encryptMessage(followupMsg, convoId, seed);
        await supabase.from('direct_messages').insert({ conversation_id: convoId, sender_id: adminId, body: encrypted });
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

        // Push notification
        const { data: { session } } = await supabase.auth.getSession();
        supabase.functions.invoke('send-push-user', {
          body: { profile_id: member.id, gym_id: gymId, title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: followupMsg.substring(0, 100), data: { type: 'direct_message', conversation_id: convoId } },
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        }).catch(() => {});
      }
    } catch (err) {
      logger.error('Followup DM failed:', err);
    }
    const now = new Date().toISOString();
    if (churnRowId) await supabase.from('churn_risk_scores').update({ followup_sent_at: now }).eq('id', churnRowId);
    logAdminAction('send_followup', 'member', member.id);
    setFollowupSentAt(now);
    setFollowupSending(false);
  };

  const handleSetOutcome = async (outcome) => {
    if (!churnRowId) return;
    setOutcomeSaving(true);
    await supabase.from('churn_risk_scores').update({ followup_outcome: outcome }).eq('id', churnRowId);
    logAdminAction('set_outcome', 'member', member.id, { outcome });
    setFollowupOutcome(outcome);
    setOutcomeSaving(false);
  };

  const daysInactive = member.daysInactive ?? 0;
  const neverActive = member.neverActive ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="member-detail-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-[14px] w-full max-w-lg md:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar name={member.full_name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p id="member-detail-title" className="text-[14px] font-bold text-[#E5E7EB] truncate">{member.full_name}</p>
                <StatusBadge status={memberStatus} />
              </div>
              <p className="text-[11px] text-[#6B7280] truncate">@{member.username} · {t('admin.members.joined', 'joined')} {format(new Date(member.created_at), 'MMM yyyy', dateFnsLocale)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close member detail" className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"><X size={20} /></button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/6 flex-shrink-0">
          {[
            { label: t('admin.memberDetail.risk', 'Risk'), value: <span className={risk.textClass}>{risk.label}</span>, sub: `${t('admin.memberDetail.score', 'score')} ${member.score}%` },
            { label: t('admin.memberDetail.inactive', 'Inactive'), value: `${daysInactive}d`, sub: neverActive ? t('admin.memberDetail.neverLogged', 'never logged') : t('admin.memberDetail.days', 'days') },
            { label: t('admin.memberDetail.workouts', 'Workouts'), value: member.recentWorkouts ?? 0, sub: t('admin.memberDetail.last14d', 'last 14d') },
            { label: t('admin.memberDetail.challenges', 'Challenges'), value: challenges, sub: t('admin.memberDetail.joinedChallenges', 'joined') },
          ].map(({ label, value, sub }) => (
            <div key={label} className="py-3 px-2 text-center border-r border-white/4 last:border-0">
              <p className="text-[15px] font-bold text-[#E5E7EB] leading-none">{value}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{label}</p>
              <p className="text-[10px] text-[#6B7280]">{sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/6 flex-shrink-0">
          {[{ key: 'workouts', label: t('admin.memberDetail.tabWorkouts', 'Workouts') }, { key: 'prs', label: t('admin.memberDetail.tabPRs', 'PRs') }, { key: 'referrals', label: t('admin.referral.memberReferrals') }].map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${tab === tb.key ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px' : 'text-[#6B7280] hover:text-[#9CA3AF]'}`}>
              {tb.label}
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
              <p className="text-[13px] text-[#6B7280] text-center py-6">{t('admin.memberDetail.noWorkouts', 'No workouts logged')}</p>
            ) : (
              <div className="space-y-2">
                {(showAllWorkouts ? sessions : sessions.slice(0, 3)).map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 p-3 bg-[#111827] rounded-xl overflow-hidden">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{s.name || t('admin.memberDetail.workout', 'Workout')}</p>
                      <p className="text-[11px] text-[#6B7280]">{format(new Date(s.started_at), 'MMM d, yyyy', dateFnsLocale)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {s.total_volume_lbs > 0 && <p className="text-[12px] font-semibold text-[#9CA3AF]">{Math.round(s.total_volume_lbs).toLocaleString()} lbs</p>}
                      {s.duration_seconds > 0 && <p className="text-[11px] text-[#6B7280]">{Math.floor(s.duration_seconds / 60)}m</p>}
                    </div>
                  </div>
                ))}
                {sessions.length > 3 && !showAllWorkouts && (
                  <button onClick={() => setShowAllWorkouts(true)}
                    className="w-full py-2 text-[12px] font-semibold rounded-xl transition-colors"
                    style={{ color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
                    {t('admin.memberDetail.seeMore', { count: sessions.length - 3, defaultValue: 'See {{count}} more' })}
                  </button>
                )}
                {sessions.length > 3 && showAllWorkouts && (
                  <button onClick={() => setShowAllWorkouts(false)}
                    className="w-full py-2 text-[12px] font-semibold rounded-xl transition-colors"
                    style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    {t('admin.memberDetail.showLess', 'Show less')}
                  </button>
                )}
              </div>
            )
          ) : tab === 'prs' ? (
            prs.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-6">{t('admin.memberDetail.noPRs', 'No PRs recorded yet')}</p>
            ) : (
              <div className="space-y-2">
                {prs.map((pr, i) => (
                  <div key={`${pr.exercise_id}-${pr.achieved_at || i}`} className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${i < 3 ? 'bg-[#D4AF37]/12' : 'bg-white/4'}`}>
                      <Trophy size={13} className={i < 3 ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{pr.exercises?.name ?? pr.exercise_id}</p>
                      {pr.achieved_at && <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d, yyyy', dateFnsLocale)}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-bold text-[#E5E7EB]">{pr.weight_lbs} lbs × {pr.reps}</p>
                      {pr.estimated_1rm > 0 && <p className="text-[10px] text-[#6B7280]">{Math.round(pr.estimated_1rm)} lbs {t('admin.memberDetail.est1RM', 'est. 1RM')}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : tab === 'referrals' ? (
            <div className="space-y-4">
              {/* Referral code */}
              {referralCode && (
                <div className="bg-[#111827] border border-white/6 rounded-xl p-3">
                  <p className="text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.referral.referralCode')}</p>
                  <p className="text-[14px] font-mono font-bold text-[#D4AF37]">{referralCode}</p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#111827] border border-white/6 rounded-xl p-3 text-center">
                  <p className="text-[18px] font-bold text-[#E5E7EB] tabular-nums">{referralCount}</p>
                  <p className="text-[11px] text-[#6B7280]">{t('admin.referral.peopleReferred')}</p>
                </div>
                <div className="bg-[#111827] border border-white/6 rounded-xl p-3 text-center">
                  <p className="text-[18px] font-bold text-[#10B981] tabular-nums">{referrals.filter(r => r.status === 'completed').length}</p>
                  <p className="text-[11px] text-[#6B7280]">{t('admin.referral.completed')}</p>
                </div>
              </div>

              {/* Referred members list */}
              <div>
                <SectionLabel icon={Share2} className="mb-3">{t('admin.referral.referredList')}</SectionLabel>
                {referrals.length === 0 ? (
                  <p className="text-[13px] text-[#6B7280] text-center py-6">{t('admin.referral.noReferralsMember')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {referrals.map(ref => {
                      const statusColors = {
                        pending: 'text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/20',
                        completed: 'text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20',
                        expired: 'text-[#6B7280] bg-white/6 border-white/10',
                      };
                      const statusLabel = {
                        pending: t('admin.referral.statusPending'),
                        completed: t('admin.referral.statusCompleted'),
                        expired: t('admin.referral.statusExpired'),
                      };
                      return (
                        <div key={ref.id} className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{ref.profiles?.full_name || 'Unknown'}</p>
                            <p className="text-[11px] text-[#6B7280]">{format(new Date(ref.created_at), 'MMM d, yyyy', dateFnsLocale)}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColors[ref.status] || statusColors.pending}`}>
                            {statusLabel[ref.status] || ref.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Member Info */}
          <div>
            <SectionLabel icon={User} className="mb-3">{t('admin.memberDetail.memberInfo', 'Member Info')}</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.memberDetail.fullName', 'Full Name')}</label>
                <input type="text" value={memberName} onChange={e => setMemberName(e.target.value)}
                  className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.memberDetail.username', 'Username')}</label>
                <input type="text" value={memberUsername} onChange={e => setMemberUsername(e.target.value)}
                  className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.memberDetail.email', 'Email')}</label>
                <div className="flex gap-2">
                  <input type="email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)}
                    className="flex-1 bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40" />
                  <button onClick={handleSaveEmail}
                    disabled={emailSaving || !memberEmail.trim() || memberEmail === originalEmailRef.current}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                    <Save size={12} />
                    {emailSaving ? t('admin.memberDetail.saving', 'Saving...') : emailSaved ? t('admin.memberDetail.saved', 'Saved!') : t('admin.memberDetail.save', 'Save')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.memberDetail.phoneNumber', 'Phone Number')}</label>
                <input type="tel" value={memberPhone} onChange={e => setMemberPhone(e.target.value)}
                  placeholder="+1XXXXXXXXXX"
                  className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40" />
              </div>
              <button onClick={handleSaveInfo}
                disabled={infoSaving || (memberName === (member.full_name ?? '') && memberUsername === (member.username ?? '') && memberPhone === originalPhoneRef.current)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                <Save size={12} />
                {infoSaving ? t('admin.memberDetail.saving', 'Saving…') : infoSaved ? t('admin.memberDetail.saved', 'Saved!') : t('admin.memberDetail.saveInfo', 'Save Info')}
              </button>

              {/* Invite / Registration info */}
              {(() => {
                const hasLoggedIn = !!member.is_onboarded;
                return (
                  <div className="bg-[#0F172A] border border-white/6 rounded-xl p-3 mt-3">
                    <p className="text-[11px] font-medium text-[#6B7280] mb-1.5">{t('admin.memberDetail.inviteCode', 'Invite Code')}</p>
                    {memberInvite ? (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[14px] font-mono font-bold text-[#D4AF37]">{memberInvite.invite_code}</p>
                            <p className="text-[10px] text-[#6B7280] mt-0.5">
                              {memberInvite.used_at
                                ? `${t('admin.memberDetail.registeredOn', 'Registered')} ${format(new Date(memberInvite.used_at), 'MMM d, yyyy', dateFnsLocale)}`
                                : `${t('admin.memberDetail.createdOn', 'Created')} ${format(new Date(memberInvite.created_at), 'MMM d, yyyy', dateFnsLocale)}`}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(memberInvite.invite_code).catch(() => {});
                              setInviteCopied(true);
                              setTimeout(() => setInviteCopied(false), 2000);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
                            {inviteCopied ? <Check size={12} className="text-[#10B981]" /> : <Copy size={12} />}
                            {inviteCopied ? t('admin.memberDetail.copied', 'Copied') : t('admin.memberDetail.copy', 'Copy')}
                          </button>
                        </div>
                        <span className={`inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          hasLoggedIn
                            ? 'bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/25'
                            : 'bg-[#F59E0B]/12 text-[#F59E0B] border border-[#F59E0B]/25'
                        }`}>
                          {hasLoggedIn
                            ? t('admin.memberDetail.alreadyRegistered', 'Already Registered')
                            : t('admin.memberDetail.pendingRegistration', 'Pending — Not yet logged in')}
                        </span>
                      </>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                            {hasLoggedIn
                              ? t('admin.memberDetail.directSignup', 'Direct signup')
                              : t('admin.memberDetail.profileCreated', 'Profile created by admin')}
                          </p>
                          <p className="text-[10px] text-[#6B7280] mt-0.5">
                            {t('admin.memberDetail.noInviteUsed', 'No invite code was used')}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          hasLoggedIn
                            ? 'bg-[#10B981]/12 text-[#10B981] border border-[#10B981]/25'
                            : 'bg-[#F59E0B]/12 text-[#F59E0B] border border-[#F59E0B]/25'
                        }`}>
                          {hasLoggedIn
                            ? t('admin.memberDetail.alreadyRegistered', 'Already Registered')
                            : t('admin.memberDetail.notRegistered', 'Not Registered')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Membership */}
          <div>
            <SectionLabel icon={UserCheck} className="mb-3">{t('admin.memberDetail.membership', 'Membership')}</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[#6B7280]">{t('admin.memberDetail.status', 'Status')}</p>
                <StatusBadge status={memberStatus} />
              </div>
              <div className="flex flex-wrap gap-2">
                {getStatusActions(memberStatus).map(action => {
                  const cfg = statusActionMap[action];
                  return (
                    <button key={action} onClick={() => { setPendingAction(action); setShowStatusConfirm(true); setStatusConflict(false); }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors whitespace-nowrap ${cfg.btnColor} ${cfg.btnBg}`}>
                      {action === 'ban' || action === 'cancel' ? <UserX size={12} /> : action === 'freeze' ? <Ban size={12} /> : <UserCheck size={12} />}
                      {t(`admin.memberDetail.statusActions.${action}`, { defaultValue: cfg.label })}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Admin note */}
          <div>
            <SectionLabel icon={FileText} className="mb-2">{t('admin.memberDetail.adminNote', 'Admin Note')}</SectionLabel>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={t('admin.memberDetail.adminNotePlaceholder', 'e.g. Reached out Jan 5 \u2014 no response. At risk of churning.')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
            <button onClick={handleSaveNote} disabled={noteSaving || note === (member.admin_note ?? '')}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
              <Save size={12} /> {noteSaving ? t('admin.memberDetail.saving', 'Saving\u2026') : t('admin.memberDetail.saveNote', 'Save Note')}
            </button>
          </div>

          {/* QR / External ID */}
          <div>
            <SectionLabel icon={QrCode} className="mb-3">{t('admin.memberDetail.qrTitle', 'QR Code / External ID')}</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.memberDetail.externalId', 'External ID')}</label>
                <p className="text-[11px] text-[#6B7280] mb-1.5">{t('admin.memberDetail.externalIdDesc', "The code from your gym's existing system (e.g. keypad code, barcode number)")}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={externalId}
                    onChange={e => setExternalId(e.target.value)}
                    placeholder={t('admin.memberDetail.externalIdPlaceholder', 'e.g. 4821 or MBR-0042')}
                    className="flex-1 bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 font-mono"
                  />
                  <button
                    onClick={handleSaveExternalId}
                    disabled={externalIdSaving || externalId === (member.qr_external_id ?? '')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
                  >
                    <Save size={12} />
                    {externalIdSaving ? t('admin.memberDetail.saving', 'Saving...') : t('admin.memberDetail.save', 'Save')}
                  </button>
                </div>
              </div>
              {member.qr_code_payload && (
                <div className="flex items-center justify-between pt-2 border-t border-white/4">
                  <p className="text-[11px] text-[#6B7280]">{t('admin.memberDetail.currentQrPayload', 'Current QR payload')}</p>
                  <p className="text-[12px] font-mono font-semibold text-[#D4AF37]">{member.qr_code_payload}</p>
                </div>
              )}
            </div>
          </div>

          {/* Password Reset */}
          <div>
            <SectionLabel icon={KeyRound} className="mb-3">{t('admin.memberDetail.passwordReset', 'Password Reset')}</SectionLabel>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              {resetCode ? (
                <div className="space-y-3">
                  <p className="text-[12px] text-[#6B7280]">{t('admin.memberDetail.showCode', 'Show this code to the member:')}</p>
                  <div className="flex items-center justify-center py-4">
                    <span className="text-[36px] font-mono font-bold text-[#D4AF37] tracking-[0.3em] select-all">
                      {String(resetCode).padStart(6, '0')}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B7280] text-center">{t('admin.memberDetail.codeExpires', 'Code expires in 15 minutes')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyCode}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
                    >
                      {codeCopied ? <><Check size={12} /> {t('admin.memberDetail.copied', 'Copied!')}</> : <><Copy size={12} /> {t('admin.memberDetail.copyCode', 'Copy Code')}</>}
                    </button>
                    <button
                      onClick={() => { setResetCode(null); setResetError(''); }}
                      className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors"
                    >
                      {t('admin.memberDetail.done', 'Done')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {resetError && (
                    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <p className="text-[11px] text-red-400">{resetError}</p>
                    </div>
                  )}
                  <p className="text-[12px] text-[#6B7280]">{t('admin.memberDetail.generateResetDesc', 'Generate a one-time 6-digit code the member can use to set a new password.')}</p>
                  <button
                    onClick={handleGenerateResetCode}
                    disabled={resetLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
                  >
                    <KeyRound size={12} />
                    {resetLoading ? t('admin.memberDetail.generating', 'Generating\u2026') : t('admin.memberDetail.generateResetCode', 'Generate Reset Code')}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Churn follow-up */}
          {isFollowupCandidate && (
            <div>
              <SectionLabel icon={Send} className="mb-3">{t('admin.memberDetail.sendFollowup', 'Send Follow-up')}</SectionLabel>
              <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
                {followupSentAt ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[#6B7280]">{t('admin.memberDetail.followupSent', 'Follow-up sent')} <span className="text-[#9CA3AF] font-medium">{format(new Date(followupSentAt), 'MMM d, yyyy', dateFnsLocale)}</span></p>
                    <div>
                      <p className="text-[11px] text-[#6B7280] mb-2">{t('admin.memberDetail.outcome', 'Outcome')}</p>
                      {followupOutcome ? (
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig[followupOutcome]?.color} ${outcomeConfig[followupOutcome]?.bg}`}>
                          {t(outcomeConfig[followupOutcome]?.labelKey, outcomeConfig[followupOutcome]?.label)}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(outcomeConfig).map(([key, cfg]) => (
                            <button key={key} onClick={() => handleSetOutcome(key)} disabled={outcomeSaving}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${cfg.color} ${cfg.bg}`}>
                              {t(cfg.labelKey, cfg.label)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea value={followupMsg} onChange={e => setFollowupMsg(e.target.value)} rows={3}
                      className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
                    <button onClick={handleSendFollowup} disabled={followupSending || !followupMsg.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}>
                      <Send size={12} /> {followupSending ? t('admin.memberDetail.sendingFollowup', 'Sending\u2026') : t('admin.memberDetail.sendFollowup', 'Send Follow-up')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Status action confirmation modal */}
        <AdminModal
          isOpen={showStatusConfirm && !!pendingAction}
          onClose={() => { setShowStatusConfirm(false); setPendingAction(null); setStatusReason(''); setStatusConflict(false); }}
          title={t('admin.memberDetail.confirmStatusTitle', { defaultValue: 'Confirm Action' })}
          titleIcon={AlertTriangle}
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setShowStatusConfirm(false); setPendingAction(null); setStatusReason(''); setStatusConflict(false); }}
                className="flex-1 py-2 rounded-lg text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors whitespace-nowrap"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleConfirmStatusAction}
                disabled={statusSaving}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors whitespace-nowrap disabled:opacity-40"
              >
                {statusSaving ? tc('saving', { defaultValue: 'Saving...' }) : tc('confirm')}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[12px] text-[#9CA3AF] text-center">
              {t('admin.memberDetail.confirmStatusMessage', {
                action: pendingAction ? t(`admin.memberDetail.statusActions.${pendingAction}`, { defaultValue: statusActionMap[pendingAction]?.label }).toLowerCase() : '',
                name: member.full_name,
                defaultValue: `Are you sure you want to {{action}} for {{name}}?`,
              })}
            </p>
            <input
              type="text"
              value={statusReason}
              onChange={e => setStatusReason(e.target.value)}
              placeholder={t('admin.memberDetail.reasonPlaceholder', { defaultValue: 'Reason (optional)' })}
              aria-label={t('admin.memberDetail.reasonPlaceholder', { defaultValue: 'Reason (optional)' })}
              className="w-full bg-[#111827] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
            {statusConflict && (
              <div className="flex items-center gap-2 p-2.5 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-lg">
                <AlertTriangle size={14} className="text-[#F59E0B] flex-shrink-0" />
                <p className="text-[11px] text-[#F59E0B]">
                  {t('admin.memberDetail.statusConflict', { defaultValue: 'This member was modified by another admin. The status has been refreshed. Please review and try again.' })}
                </p>
              </div>
            )}
          </div>
        </AdminModal>
      </div>
    </div>
  );
}
