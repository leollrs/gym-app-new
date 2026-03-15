import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, ChevronRight, Trophy, FileText, Save, Link, Mail, UserX, UserCheck, Ban, Send, Users, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { createNotification } from '../../lib/notifications';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { getRiskTier } from '../../lib/churnScore';
import { exportCSV } from '../../lib/csvExport';

// ── Membership status helpers ───────────────────────────────
const statusConfig = {
  active:    { dot: true,  label: 'Active',     color: 'text-[#10B981]',  bg: 'bg-[#10B981]/10',  border: 'border-[#10B981]/20' },
  frozen:    { dot: false, label: 'Frozen',     color: 'text-[#60A5FA]',  bg: 'bg-[#60A5FA]/10',  border: 'border-[#60A5FA]/20' },
  cancelled: { dot: false, label: 'Cancelled',  color: 'text-[#9CA3AF]',  bg: 'bg-white/6',       border: 'border-white/10' },
  banned:    { dot: false, label: 'Banned',     color: 'text-[#EF4444]',  bg: 'bg-[#EF4444]/10',  border: 'border-[#EF4444]/20' },
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] ?? statusConfig.active;
  if (cfg.dot) {
    return (
      <span className="flex items-center gap-1" title="Active">
        <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0" />
      </span>
    );
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
};

// ── Invite Member modal ─────────────────────────────────────
const InviteModal = ({ gymId, onClose }) => {
  const [gym, setGym]             = useState(null);
  const [copied, setCopied]       = useState(false);
  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    supabase.from('gyms').select('slug, name').eq('id', gymId).single()
      .then(({ data }) => setGym(data ?? null));
  }, [gymId]);

  const inviteLink = gym?.slug
    ? `${window.location.origin}/signup?gym=${gym.slug}`
    : null;

  const handleCopy = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEmailInvite = () => {
    if (!inviteLink || !emailInput.trim()) return;
    const gymName = gym?.name ?? 'your gym';
    const subject = encodeURIComponent(`You're invited to join ${gymName}`);
    const body = encodeURIComponent(
      `Hey!\n\nYou've been invited to join ${gymName} on our gym tracking app.\n\nClick the link below to create your account and get started:\n\n${inviteLink}\n\nSee you in the gym! 💪`
    );
    window.open(`mailto:${emailInput.trim()}?subject=${subject}&body=${body}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-member-title"
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-md md:max-w-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <div className="flex items-center gap-2">
            <Link size={16} className="text-[#D4AF37]" />
            <p id="invite-member-title" className="text-[15px] font-bold text-[#E5E7EB]">Invite Member</p>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Invite link */}
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Invite Link</p>
            {inviteLink ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 overflow-hidden">
                  <p className="text-[12px] text-[#9CA3AF] truncate select-all">{inviteLink}</p>
                </div>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors flex-shrink-0 ${
                    copied
                      ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20'
                      : 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'
                  }`}
                >
                  <Link size={12} />
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : (
              <div className="h-10 bg-[#111827] border border-white/6 rounded-xl animate-pulse" />
            )}
            <p className="text-[11px] text-[#6B7280] mt-2">
              Share this link with new members to join your gym. Members who click it will have the gym code pre-filled.
            </p>
          </div>

          {/* Email invite */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Mail size={12} className="text-[#6B7280]" />
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Email Invite</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="member@example.com"
                className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors"
              />
              <button
                onClick={handleEmailInvite}
                disabled={!emailInput.trim() || !inviteLink}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                <Send size={12} />
                Send
              </button>
            </div>
            <p className="text-[11px] text-[#4B5563] mt-1.5">
              Opens your email client with a pre-written invite message.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Member detail modal ────────────────────────────────────
const MemberModal = ({ member, gymId, onClose, onNoteSaved, onStatusChanged }) => {
  const [sessions,   setSessions]   = useState([]);
  const [prs,        setPrs]        = useState([]);
  const [challenges, setChallenges] = useState(0);
  const [note,       setNote]       = useState(member.admin_note ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState('workouts');

  // Membership status
  const [memberStatus,        setMemberStatus]        = useState(member.membership_status ?? 'active');
  const [statusReason,        setStatusReason]        = useState('');
  const [pendingAction,       setPendingAction]       = useState(null); // 'freeze'|'cancel'|'ban'|'reactivate'|'unban'
  const [statusSaving,        setStatusSaving]        = useState(false);

  // Churn follow-up
  const [followupMsg,         setFollowupMsg]         = useState(
    `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together. 💪`
  );
  const [followupSending,     setFollowupSending]     = useState(false);
  const [followupSentAt,      setFollowupSentAt]      = useState(null);
  const [followupOutcome,     setFollowupOutcome]     = useState(null);
  const [outcomeSaving,       setOutcomeSaving]       = useState(false);
  const [churnRowId,          setChurnRowId]          = useState(null);

  const isFollowupCandidate = member.score >= 31;

  useEffect(() => {
    const load = async () => {
      const [sessRes, prRes, chalRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, name, started_at, duration_seconds, total_volume_lbs')
          .eq('profile_id', member.id)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(10),
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name)')
          .eq('profile_id', member.id)
          .order('estimated_1rm', { ascending: false })
          .limit(8),
        supabase
          .from('challenge_participants')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', member.id),
      ]);
      if (sessRes.error) console.error('MemberModal: failed to load sessions:', sessRes.error);
      if (prRes.error) console.error('MemberModal: failed to load PRs:', prRes.error);
      if (chalRes.error) console.error('MemberModal: failed to load challenges:', chalRes.error);
      setSessions(sessRes.data || []);
      setPrs(prRes.data || []);
      setChallenges(chalRes.count ?? 0);

      // Load churn follow-up data if relevant
      if (isFollowupCandidate) {
        const { data: churnRow } = await supabase
          .from('churn_risk_scores')
          .select('id, followup_sent_at, followup_outcome')
          .eq('profile_id', member.id)
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
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

  // Membership status actions
  const statusActionMap = {
    freeze:     { next: 'frozen',    label: 'Freeze Account',      btnColor: 'text-[#60A5FA]',  btnBg: 'bg-[#60A5FA]/10 border-[#60A5FA]/20' },
    cancel:     { next: 'cancelled', label: 'Cancel Membership',   btnColor: 'text-[#9CA3AF]',  btnBg: 'bg-white/6 border-white/10' },
    ban:        { next: 'banned',    label: 'Ban Member',          btnColor: 'text-[#EF4444]',  btnBg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
    reactivate: { next: 'active',    label: 'Reactivate',          btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
    unban:      { next: 'active',    label: 'Unban',               btnColor: 'text-[#10B981]',  btnBg: 'bg-[#10B981]/10 border-[#10B981]/20' },
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

  const statusActions = () => {
    switch (memberStatus) {
      case 'active':    return ['freeze', 'cancel', 'ban'];
      case 'frozen':    return ['reactivate', 'ban'];
      case 'cancelled': return ['reactivate', 'ban'];
      case 'banned':    return ['unban'];
      default:          return [];
    }
  };

  // Churn follow-up
  const handleSendFollowup = async () => {
    setFollowupSending(true);
    await createNotification({
      profileId: member.id,
      gymId,
      type: 'churn_followup',
      title: 'Message from your gym',
      body: followupMsg,
      data: { source: 'admin_followup' },
    });
    const now = new Date().toISOString();
    if (churnRowId) {
      await supabase.from('churn_risk_scores')
        .update({ followup_sent_at: now })
        .eq('id', churnRowId);
    }
    setFollowupSentAt(now);
    setFollowupSending(false);
  };

  const handleSetOutcome = async (outcome) => {
    if (!churnRowId) return;
    setOutcomeSaving(true);
    await supabase.from('churn_risk_scores')
      .update({ followup_outcome: outcome })
      .eq('id', churnRowId);
    setFollowupOutcome(outcome);
    setOutcomeSaving(false);
  };

  const outcomeConfig = {
    returned:    { label: 'Member returned', color: 'text-[#10B981]', bg: 'bg-[#10B981]/10 border-[#10B981]/20' },
    no_response: { label: 'No response',     color: 'text-[#9CA3AF]', bg: 'bg-white/6 border-white/10' },
    cancelled:   { label: 'Cancelled',       color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/10 border-[#EF4444]/20' },
  };

  const risk = getRiskTier(member.score);
  const daysInactive = member.daysInactive ?? 0;
  const neverActive = member.neverActive ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="member-detail-title" className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg md:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
              <span className="text-[15px] font-bold text-[#9CA3AF]">{member.full_name[0]}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p id="member-detail-title" className="text-[15px] font-bold text-[#E5E7EB]">{member.full_name}</p>
                <StatusBadge status={memberStatus} />
              </div>
              <p className="text-[11px] text-[#6B7280]">@{member.username} · joined {format(new Date(member.created_at), 'MMM yyyy')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 border-b border-white/6 flex-shrink-0">
          {[
            { label: 'Risk',       value: <span className={risk.textClass}>{risk.label}</span>, sub: `score ${member.score}%` },
            { label: 'Inactive',   value: `${daysInactive}d`, sub: neverActive ? 'never logged' : 'days' },
            { label: 'Workouts',   value: member.recentWorkouts ?? 0, sub: 'last 14d' },
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
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t.key
                  ? 'text-[#D4AF37] border-b-2 border-[#D4AF37] -mb-px'
                  : 'text-[#6B7280] hover:text-[#9CA3AF]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
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
                      {s.total_volume_lbs > 0 && (
                        <p className="text-[12px] font-semibold text-[#9CA3AF]">{Math.round(s.total_volume_lbs).toLocaleString()} lbs</p>
                      )}
                      {s.duration_seconds > 0 && (
                        <p className="text-[11px] text-[#6B7280]">{Math.floor(s.duration_seconds / 60)}m</p>
                      )}
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
                      {pr.achieved_at && (
                        <p className="text-[11px] text-[#6B7280]">{format(new Date(pr.achieved_at), 'MMM d, yyyy')}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-bold text-[#E5E7EB]">{pr.weight_lbs} lbs × {pr.reps}</p>
                      {pr.estimated_1rm > 0 && (
                        <p className="text-[10px] text-[#6B7280]">{Math.round(pr.estimated_1rm)} lbs est. 1RM</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Membership section — always visible */}
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <UserCheck size={12} className="text-[#6B7280]" />
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Membership</p>
            </div>
            <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
              {/* Current status */}
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[#6B7280]">Status</p>
                <StatusBadge status={memberStatus} />
              </div>

              {/* Action buttons */}
              {!pendingAction && (
                <div className="flex flex-wrap gap-2">
                  {statusActions().map(action => {
                    const cfg = statusActionMap[action];
                    return (
                      <button
                        key={action}
                        onClick={() => setPendingAction(action)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${cfg.btnColor} ${cfg.btnBg}`}
                      >
                        {action === 'ban' || action === 'cancel' ? <UserX size={12} /> :
                         action === 'freeze' ? <Ban size={12} /> :
                         <UserCheck size={12} />}
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Inline confirmation */}
              {pendingAction && (
                <div className="space-y-2">
                  <p className="text-[12px] text-[#E5E7EB]">
                    Are you sure you want to <span className="font-semibold">{statusActionMap[pendingAction].label.toLowerCase()}</span>?
                  </p>
                  <input
                    type="text"
                    value={statusReason}
                    onChange={e => setStatusReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="w-full bg-[#0F172A] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmStatusAction}
                      disabled={statusSaving}
                      className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40"
                    >
                      {statusSaving ? 'Saving…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => { setPendingAction(null); setStatusReason(''); }}
                      className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Churn follow-up — only for Watch / At Risk */}
          {isFollowupCandidate && (
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <Send size={12} className="text-[#6B7280]" />
                <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Send Follow-up</p>
              </div>
              <div className="bg-[#111827] border border-white/6 rounded-xl p-3 space-y-3">
                {followupSentAt ? (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[#6B7280]">
                      Follow-up sent{' '}
                      <span className="text-[#9CA3AF] font-medium">
                        {format(new Date(followupSentAt), 'MMM d, yyyy')}
                      </span>
                    </p>

                    {/* Outcome tracking */}
                    <div>
                      <p className="text-[11px] text-[#6B7280] mb-2">Outcome</p>
                      {followupOutcome ? (
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${outcomeConfig[followupOutcome]?.color} ${outcomeConfig[followupOutcome]?.bg}`}>
                          {outcomeConfig[followupOutcome]?.label}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(outcomeConfig).map(([key, cfg]) => (
                            <button
                              key={key}
                              onClick={() => handleSetOutcome(key)}
                              disabled={outcomeSaving}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-40 ${cfg.color} ${cfg.bg}`}
                            >
                              {cfg.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={followupMsg}
                      onChange={e => setFollowupMsg(e.target.value)}
                      rows={3}
                      className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
                    />
                    <button
                      onClick={handleSendFollowup}
                      disabled={followupSending || !followupMsg.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                      style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}
                    >
                      <Send size={12} />
                      {followupSending ? 'Sending…' : 'Send Follow-up'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Admin note — always visible regardless of tab */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText size={12} className="text-[#6B7280]" />
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Admin Note</p>
            </div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Reached out Jan 5 — no response. At risk of churning."
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
            />
            <button
              onClick={handleSaveNote}
              disabled={noteSaving || note === (member.admin_note ?? '')}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40"
              style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }}
            >
              <Save size={12} /> {noteSaving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Churn risk badge (links to Churn Intel page) ──────────
const ChurnRiskBadge = ({ member, navigate }) => {
  // Compute score using the new library's model for a consistent display.
  // We have enough data on member from the existing scoring pass to derive
  // approximate inputs. We reuse the AdminOverview score (member.score) for
  // the tier classification but display a small badge here.
  const score = member.score ?? 0;
  const tier = getRiskTier(
    // Map the existing 0-100 AdminOverview score through our tier thresholds.
    // AdminOverview uses 61+ = At Risk, 31-60 = Watch — translate to new 70/40 thresholds:
    score >= 61 ? 72 : score >= 31 ? 50 : 20
  );
  if (score < 31) return null; // Only show badge for Watch+ members
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigate('/admin/churn');
      }}
      title={`${tier.label} — click to view in Churn Intel`}
      className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 flex-shrink-0"
      style={{
        color: tier.color,
        background: tier.bg,
        borderColor: `${tier.color}33`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
      {tier.label}
    </button>
  );
};

// ── Main ──────────────────────────────────────────────────
export default function AdminMembers() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [members,      setMembers]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filter,       setFilter]       = useState('all');
  const [selected,     setSelected]     = useState(null);
  const [showInvite,   setShowInvite]   = useState(false);

  // Bulk follow-up
  const [bulkConfirm,  setBulkConfirm]  = useState(false);
  const [bulkSending,  setBulkSending]  = useState(false);

  useEffect(() => { document.title = 'Admin - Members | IronForge'; }, []);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      setLoading(true);
      const gymId = profile.gym_id;

      // Fetch members and pre-computed churn scores in parallel
      const [membersRes, churnRes, sessionsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, last_active_at, created_at, admin_note, membership_status')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .order('last_active_at', { ascending: false, nullsFirst: false }),

        supabase
          .from('churn_risk_scores')
          .select('profile_id, score, risk_tier, key_signals')
          .eq('gym_id', gymId)
          .order('score', { ascending: false }),

        supabase
          .from('workout_sessions')
          .select('profile_id, started_at')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .gte('started_at', subDays(new Date(), 14).toISOString()),
      ]);

      if (membersRes.error) console.error('AdminMembers: failed to load members:', membersRes.error);
      if (churnRes.error) console.error('AdminMembers: failed to load churn scores:', churnRes.error);
      if (sessionsRes.error) console.error('AdminMembers: failed to load sessions:', sessionsRes.error);

      const memberRows = membersRes.data || [];
      const churnRows = churnRes.data || [];
      const recentSessions = sessionsRes.data || [];

      // Build churn score lookup (latest per profile)
      const churnMap = {};
      churnRows.forEach(row => {
        if (!churnMap[row.profile_id]) churnMap[row.profile_id] = row;
      });

      // Recent workout counts & last session
      const sessionsLast14 = {};
      const lastSessionAt  = {};
      recentSessions.forEach(s => {
        sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
        if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) {
          lastSessionAt[s.profile_id] = s.started_at;
        }
      });

      const nowMs = Date.now();
      const scored = memberRows.map(m => {
        const churn = churnMap[m.id];
        const effectiveLast = m.last_active_at ?? lastSessionAt[m.id] ?? m.created_at;
        return {
          ...m,
          recentWorkouts:    sessionsLast14[m.id] ?? 0,
          lastSessionAt:     lastSessionAt[m.id] ?? null,
          score:             churn?.score ?? 0,
          risk_tier:         churn?.risk_tier ?? 'low',
          key_signals:       churn?.key_signals ?? [],
          membership_status: m.membership_status ?? 'active',
          daysInactive:      Math.floor((nowMs - new Date(effectiveLast)) / 86400000),
          neverActive:       !m.last_active_at && !lastSessionAt[m.id],
        };
      });

      setMembers(scored);
      setLoading(false);
    };
    load();
  }, [profile?.gym_id]);

  const handleNoteSaved = (memberId, newNote) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, admin_note: newNote } : m));
    setSelected(prev => prev?.id === memberId ? { ...prev, admin_note: newNote } : prev);
  };

  const handleStatusChanged = (memberId, newStatus) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, membership_status: newStatus } : m));
    setSelected(prev => prev?.id === memberId ? { ...prev, membership_status: newStatus } : prev);
  };

  const atRiskCount  = members.filter(m => m.score >= 61).length;
  const watchCount   = members.filter(m => m.score >= 31 && m.score < 61).length;
  const healthyCount = members.filter(m => m.score < 31).length;

  const filtered = useMemo(() => {
    let list = members;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.full_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
      );
    }
    if (filter === 'at-risk') list = list.filter(m => m.score >= 61);
    else if (filter === 'watch')   list = list.filter(m => m.score >= 31 && m.score < 61);
    else if (filter === 'healthy') list = list.filter(m => m.score < 31);
    return list;
  }, [members, search, filter]);

  const atRiskFiltered = filtered.filter(m => m.score >= 61);

  const handleBulkFollowup = async () => {
    if (!profile?.gym_id) return;
    setBulkSending(true);
    const gymId = profile.gym_id;
    for (const m of atRiskFiltered) {
      const msg = `Hey ${m.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together. 💪`;
      await createNotification({
        profileId: m.id,
        gymId,
        type: 'churn_followup',
        title: 'Message from your gym',
        body: msg,
        data: { source: 'admin_bulk_followup' },
      });
    }
    // Mark followup_sent_at for all at-risk members in bulk
    if (atRiskFiltered.length > 0) {
      const now = new Date().toISOString();
      await supabase
        .from('churn_risk_scores')
        .update({ followup_sent_at: now })
        .in('profile_id', atRiskFiltered.map(m => m.id))
        .eq('gym_id', gymId);
    }
    setBulkSending(false);
    setBulkConfirm(false);
  };

  const handleExport = () => {
    exportCSV({
      filename: 'members',
      columns: [
        { key: 'full_name', label: 'Name' },
        { key: 'membership_status', label: 'Status' },
        { key: 'created_at', label: 'Joined' },
        { key: 'last_active_at', label: 'Last Active' },
        { key: 'score', label: 'Churn Score' },
        { key: 'risk_tier', label: 'Risk Tier' },
        { key: 'recentWorkouts', label: 'Workouts (14d)' },
      ],
      data: filtered,
    });
  };

  const filters = [
    { key: 'all',      label: `All (${members.length})` },
    { key: 'at-risk',  label: `At Risk (${atRiskCount})` },
    { key: 'watch',    label: `Watch (${watchCount})` },
    { key: 'healthy',  label: `Healthy (${healthyCount})` },
  ];

  return (
    <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-[#E5E7EB]">Members</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">{members.length} total · {atRiskCount} at risk</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {filter === 'at-risk' && atRiskFiltered.length > 0 && (
            bulkConfirm ? (
              <div className="flex items-center gap-2">
                <p className="text-[12px] text-[#9CA3AF]">
                  Send to {atRiskFiltered.length} members?
                </p>
                <button
                  onClick={handleBulkFollowup}
                  disabled={bulkSending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors disabled:opacity-40"
                >
                  {bulkSending ? 'Sending…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setBulkConfirm(false)}
                  className="px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setBulkConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
              >
                <Users size={13} />
                Bulk Follow-up
              </button>
            )
          )}
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors"
          >
            <Link size={13} />
            Invite Member
          </button>
        </div>
      </div>

      {/* Search + filter */}
      <div className="md:sticky md:top-0 md:z-20 md:bg-[#05070B]/95 md:backdrop-blur-xl md:-mx-8 md:px-8 md:py-3 flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            placeholder="Search members…"
            aria-label="Search members"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15 transition-colors"
        >
          <Download size={13} />
          Export
        </button>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'bg-[#0F172A] border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#6B7280] text-[14px]">No members found</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] border border-white/6 rounded-[14px] overflow-hidden">
          <div className="divide-y divide-white/4">
            {filtered.map(m => {
              const tier = getRiskTier(m.score);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03] hover:border-white/20 transition-all text-left group"
                >
                  <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center flex-shrink-0">
                    <span className="text-[13px] font-bold text-[#9CA3AF]">{m.full_name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{m.full_name}</p>
                      <StatusBadge status={m.membership_status} />
                      <ChurnRiskBadge member={m} navigate={navigate} />
                      {m.admin_note && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 flex-shrink-0" title="Has note" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {(m.last_active_at || m.lastSessionAt)
                        ? `Active ${formatDistanceToNow(new Date(m.last_active_at ?? m.lastSessionAt), { addSuffix: true })}`
                        : 'Never active'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="text-right hidden md:block">
                      <p className="text-[12px] text-[#9CA3AF]">{format(new Date(m.created_at), 'MMM yyyy')}</p>
                      <p className="text-[10px] text-[#4B5563]">joined</p>
                    </div>
                    <div className="text-right hidden lg:block">
                      <p className="text-[12px] text-[#9CA3AF]">{m.last_active_at ? formatDistanceToNow(new Date(m.last_active_at), { addSuffix: true }) : 'Never'}</p>
                      <p className="text-[10px] text-[#4B5563]">last active</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-[12px] font-semibold text-[#9CA3AF]">{m.recentWorkouts}w / 14d</p>
                    </div>
                    <span
                      className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                      style={{ color: tier.color, background: tier.bg, borderColor: `${tier.color}33` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: tier.color }} />
                      {m.score}%
                    </span>
                    <ChevronRight size={14} className="text-[#4B5563]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <MemberModal
          member={selected}
          gymId={profile?.gym_id}
          onClose={() => setSelected(null)}
          onNoteSaved={handleNoteSaved}
          onStatusChanged={handleStatusChanged}
        />
      )}

      {showInvite && (
        <InviteModal
          gymId={profile?.gym_id}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}
