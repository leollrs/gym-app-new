import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy, FileText, Save, Send, UserCheck, UserX, Ban, X, QrCode, KeyRound, Copy, Check, Share2, AlertTriangle, User, Trash2, Shield, Activity, Download, Dumbbell, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { supabase } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';
import { getRiskTier } from '../../../lib/churnScore';
import { logAdminAction } from '../../../lib/adminAudit';
import { exportSelectedMembersCSV } from '../../../lib/exportData';
import { composeFullName, areNamePartsValid, isValidNamePart, splitFullName } from '../../../lib/admin/memberName';
import posthog from 'posthog-js';
import { Avatar, AdminModal, PhoneInput } from '../../../components/admin';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import CheckinPhotoEditor from '../../../components/CheckinPhotoEditor';
import { signCheckinPhoto } from '../../../lib/checkinPhoto';
import CancellationSurveyModal from './CancellationSurveyModal';
import CancellationSaveStep from './CancellationSaveStep';

const statusActionMap = {
  freeze:     { next: 'frozen',      labelKey: 'freeze',      label: 'Freeze Account',      tone: 'blue' },
  deactivate: { next: 'deactivated', labelKey: 'deactivate',  label: 'Deactivate Account',  tone: 'warn' },
  cancel:     { next: 'cancelled',   labelKey: 'cancel',      label: 'Cancel Membership',   tone: 'ghost' },
  ban:        { next: 'banned',      labelKey: 'ban',         label: 'Ban Member',          tone: 'danger' },
  reactivate: { next: 'active',      labelKey: 'reactivate',  label: 'Reactivate',          tone: 'good' },
  unban:      { next: 'active',      labelKey: 'unban',       label: 'Unban',               tone: 'good' },
};

const outcomeConfig = {
  returned:    { labelKey: 'admin.memberDetail.outcomeReturned', label: 'Member returned', tone: 'good' },
  no_response: { labelKey: 'admin.memberDetail.outcomeNoResponse', label: 'No response',    tone: 'ghost' },
  cancelled:   { labelKey: 'admin.memberDetail.outcomeCancelled', label: 'Cancelled',       tone: 'danger' },
};

function getStatusActions(status) {
  switch (status) {
    // 'cancel' is the path that opens the save-step → exit-survey
    // flow (CancellationSaveStep + CancellationSurveyModal). Available
    // from any state that ISN'T already cancelled or banned, so the
    // owner can capture an exit reason whether the member is paused,
    // active, or just deactivated.
    case 'active':      return ['freeze', 'deactivate', 'cancel', 'ban'];
    case 'frozen':      return ['reactivate', 'deactivate', 'cancel', 'ban'];
    case 'deactivated': return ['reactivate', 'cancel', 'ban'];
    case 'cancelled':   return ['reactivate', 'ban'];
    case 'banned':      return ['unban'];
    default:            return [];
  }
}

// ── Style A presentational primitives (cream/coral admin language) ───────────
// Tonal button styles keyed by intent — mirror the design's MBtn tones.
function btnTone(tone) {
  switch (tone) {
    case 'primary':     return { background: 'var(--color-accent)', color: 'var(--color-text-on-accent)', border: '1px solid var(--color-accent)' };
    case 'soft':        return { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' };
    case 'blue':        return { background: 'var(--color-info-soft)', color: '#2A5FCA', border: '1px solid transparent' };
    case 'good':        return { background: 'var(--color-success-soft)', color: 'var(--color-success-ink)', border: '1px solid transparent' };
    case 'warn':        return { background: 'var(--color-warning-soft)', color: 'var(--color-warning-ink)', border: '1px solid transparent' };
    case 'danger':      return { background: 'var(--color-danger-soft)', color: 'var(--color-danger-ink)', border: '1px solid transparent' };
    case 'dangerSolid': return { background: 'var(--color-danger)', color: '#fff', border: '1px solid var(--color-danger)' };
    case 'ghost':
    default:            return { background: 'var(--color-admin-sidebar)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)' };
  }
}

// Risk block tint by churn tier (critical/high → danger, medium → warn, low → good).
function riskTone(tier) {
  if (tier === 'critical' || tier === 'high') return { soft: 'var(--color-danger-soft)', ink: 'var(--color-danger-ink)', bar: 'var(--color-danger)' };
  if (tier === 'medium') return { soft: 'var(--color-warning-soft)', ink: 'var(--color-warning-ink)', bar: 'var(--color-warning)' };
  // Non-scored states (not enough data / paused / lost) are neutral — never green,
  // so a never-attended member isn't painted as a "healthy" Low Risk.
  if (tier === 'insufficient_data' || tier === 'paused' || tier === 'churned')
    return { soft: 'var(--color-admin-panel)', ink: 'var(--color-admin-text-sub)', bar: 'var(--color-admin-text-muted)' };
  return { soft: 'var(--color-success-soft)', ink: 'var(--color-success-ink)', bar: 'var(--color-success)' };
}

// Membership state banner tint by status — mirrors the design's MembershipState
// block (a colored "Cuenta activa" banner) without inventing billing data.
const STATUS_BANNER = {
  active:      { soft: 'var(--color-success-soft)', ink: 'var(--color-success-ink)',  dot: 'var(--color-success)' },
  frozen:      { soft: 'var(--color-info-soft)',    ink: '#2A5FCA',                    dot: 'var(--color-info)' },
  deactivated: { soft: 'var(--color-warning-soft)', ink: 'var(--color-warning-ink)',  dot: 'var(--color-warning)' },
  cancelled:   { soft: 'var(--color-admin-panel)',  ink: 'var(--color-admin-text-sub)', dot: 'var(--color-admin-text-muted)' },
  banned:      { soft: 'var(--color-danger-soft)',  ink: 'var(--color-danger-ink)',   dot: 'var(--color-danger)' },
};

// Uppercase section label with leading icon + divider rule.
function MSecLabel({ icon: Icon, children, tone }) {
  const c = tone === 'danger' ? 'var(--color-danger-ink)' : 'var(--color-admin-text-muted)';
  return (
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon size={13} style={{ color: c }} />}
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.09em] whitespace-nowrap" style={{ color: c, fontFamily: 'var(--admin-font-display)' }}>{children}</span>
      <div className="flex-1 h-px" style={{ background: 'var(--color-admin-border)' }} />
    </div>
  );
}

// Labelled field shell.
function MField({ label, hint, action, children }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-[11.5px] font-bold" style={{ color: 'var(--color-admin-text-sub)' }}>{label}</label>
        {action}
      </div>
      {children}
      {hint && <p className="text-[10.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-admin-text-muted)' }}>{hint}</p>}
    </div>
  );
}

// Text input with focus-accent border.
function MInput({ value, onChange, placeholder, type = 'text', prefix, mono = false, readOnly = false, maxLength, autoComplete, invalid = false }) {
  const [focus, setFocus] = useState(false);
  const borderColor = invalid ? 'var(--color-danger)' : (focus ? 'var(--color-accent)' : 'var(--color-admin-border)');
  return (
    <div className="flex items-center gap-2 rounded-lg px-3" style={{ height: 38, background: readOnly ? 'var(--color-admin-panel)' : 'var(--color-admin-sidebar)', border: `1px solid ${borderColor}`, transition: 'border-color .15s' }}>
      {prefix && <span className="text-[12.5px] font-semibold flex-shrink-0" style={{ color: 'var(--color-admin-text-muted)' }}>{prefix}</span>}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
        maxLength={maxLength} autoComplete={autoComplete}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        className="flex-1 min-w-0 bg-transparent outline-none text-[13px]"
        style={{ color: 'var(--color-admin-text)', fontFamily: mono ? 'var(--admin-font-mono)' : 'var(--admin-font-body)', fontWeight: mono ? 600 : 500 }}
      />
    </div>
  );
}

// Centered stat pip for the risk strip.
function MStatPip({ value, label }) {
  return (
    <div className="flex-1 text-center px-1">
      <div className="font-extrabold text-[17px] leading-none" style={{ color: 'var(--color-admin-text)', fontFamily: 'var(--admin-font-display)' }}>{value}</div>
      <div className="text-[9.5px] mt-1.5 font-semibold leading-tight" style={{ color: 'var(--color-admin-text-muted)' }}>{label}</div>
    </div>
  );
}

export default function MemberDetail({ member, gymId, onClose, onNoteSaved, onStatusChanged }) {
  const { user: authUser } = useAuth();
  const adminId = authUser?.id;
  const { showToast } = useToast();
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
  const [tab, setTab] = useState('perfil');
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [saveStepOpen, setSaveStepOpen] = useState(false);

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

  // Prior cancellations — surfaces "they cancelled before, same reason?"
  // banner in the exit survey. retry:false so a missing table (pre-migration)
  // silently degrades to an empty list instead of throwing.
  const { data: priorCancellations = [] } = useQuery({
    queryKey: ['member-cancellations', member.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cancellation_reasons')
        .select('id, category, details_text, would_return_if, tenure_days, recorded_at')
        .eq('profile_id', member.id)
        .order('recorded_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: showStatusConfirm && pendingAction === 'cancel' && !!member.id,
    retry: false,
  });

  // Lock body scroll while member detail modal is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const [statusConflict, setStatusConflict] = useState(false);

  // Permanent deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [externalId, setExternalId] = useState(member.qr_external_id ?? '');
  const [externalIdSaving, setExternalIdSaving] = useState(false);
  const [externalIdSaved, setExternalIdSaved] = useState(false);
  // Local baseline so the Save button settles (disables) after a successful
  // save — the parent doesn't refresh the `member` prop.
  const originalExternalIdRef = useRef(member.qr_external_id ?? '');

  const [nameParts, setNameParts] = useState(() => splitFullName(member.full_name ?? ''));
  const [memberUsername, setMemberUsername] = useState(member.username ?? '');
  const [memberEmail, setMemberEmail] = useState(member.email ?? '');
  // Staff check-in reference photo. Seed the signed URL from the list row
  // (already signed) so the header avatar paints instantly; only re-sign when
  // the photo actually changes, or on mount if the row arrived without a URL.
  const [checkinPath, setCheckinPath] = useState(member.checkin_photo_path || null);
  const [checkinUrl, setCheckinUrl] = useState(member.checkin_photo_url || null);
  const checkinFirstSignRef = useRef(Boolean(member.checkin_photo_url));
  useEffect(() => {
    if (checkinFirstSignRef.current) { checkinFirstSignRef.current = false; return undefined; }
    let cancelled = false;
    if (!checkinPath) { setCheckinUrl(null); return undefined; }
    signCheckinPhoto(checkinPath).then(u => { if (!cancelled) setCheckinUrl(u); });
    return () => { cancelled = true; };
  }, [checkinPath]);
  // Admin override for the member's actual gym join date — drives
  // the tenure-based churn signal so members who pre-date the app
  // aren't penalized by the 90-day onboarding window.
  const [memberStartedAt, setMemberStartedAt] = useState(
    member.membership_started_at ?? '',
  );
  const originalStartedAtRef = useRef(member.membership_started_at ?? '');
  const originalEmailRef = useRef(member.email ?? '');
  // Local edit baselines for name/username — the parent doesn't refresh the
  // `member` prop after a profile save, so comparing against it would keep the
  // SaveBar "dirty" forever. Refs let the unified save settle cleanly.
  const originalNameRef = useRef(member.full_name ?? '');
  const originalUsernameRef = useRef(member.username ?? '');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [memberPhone, setMemberPhone] = useState('');
  const originalPhoneRef = useRef('');
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  // Workouts "see more" toggle
  const [showAllWorkouts, setShowAllWorkouts] = useState(false);

  // Per-member data export (Avanzado tab)
  const [exportingMember, setExportingMember] = useState(false);

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

  // Pass state so insufficient_data / paused / churned render their own label
  // (was getRiskTier(score) alone → a never-attended score-0 member showed "Low Risk").
  const risk = getRiskTier(member.score, member.state);
  const isScoredState = !member.state || member.state === 'scored' || member.state === 'dormant';
  const isFollowupCandidate = isScoredState && member.score >= 31;

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
        // Wrapped in try/catch — followup_* columns require migration 0260; if it
        // hasn't been deployed yet the select 400s and we just skip the followup state.
        try {
          // churn_risk_scores has `computed_at` (not `created_at`); see migration 0030.
          const { data: churnRow, error: churnErr } = await supabase.from('churn_risk_scores').select('id, followup_sent_at, followup_outcome').eq('profile_id', member.id).eq('gym_id', gymId).order('computed_at', { ascending: false }).limit(1).maybeSingle();
          if (!churnErr && churnRow) {
            setChurnRowId(churnRow.id);
            setFollowupSentAt(churnRow.followup_sent_at ?? null);
            setFollowupOutcome(churnRow.followup_outcome ?? null);
          }
        } catch { /* migration 0260 not deployed — skip silently */ }
      }

      // Load referral data — referral_code lives on the referral_codes table, not profiles.
      const [refCodeRes, refListRes] = await Promise.all([
        supabase.from('referral_codes').select('code').eq('profile_id', member.id).eq('gym_id', gymId).maybeSingle(),
        supabase.from('referrals').select('id, referred_id, status, created_at, profiles!referrals_referred_id_fkey(full_name)').eq('referrer_id', member.id).eq('gym_id', gymId).order('created_at', { ascending: false }).limit(50),
      ]);
      if (refCodeRes.data?.code) setReferralCode(refCodeRes.data.code);

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
    const { error } = await supabase.from('profiles').update({ admin_note: note || null }).eq('id', member.id).eq('gym_id', gymId);
    setNoteSaving(false);
    if (error) {
      logger.error('Failed to save admin note', error);
      showToast?.(t('admin.memberDetail.noteSaveFailed', { defaultValue: 'Failed to save note.' }), 'error');
      return;
    }
    logAdminAction('update_note', 'member', member.id, { note: note?.substring(0, 100) });
    onNoteSaved(member.id, note);
  };

  const handleSaveExternalId = async () => {
    setExternalIdSaving(true);
    setExternalIdSaved(false);
    const payload = externalId.trim() || null;
    const { error } = await supabase.from('profiles').update({
      qr_external_id: payload,
      qr_code_payload: payload,
    }).eq('id', member.id).eq('gym_id', gymId);
    setExternalIdSaving(false);
    if (error) {
      logger.error('Failed to save external ID', error);
      showToast?.(t('admin.memberDetail.externalIdSaveFailed', { defaultValue: 'Failed to save external ID.' }), 'error');
      return;
    }
    logAdminAction('update_external_id', 'member', member.id);
    originalExternalIdRef.current = payload ?? '';
    setExternalIdSaved(true);
    setTimeout(() => setExternalIdSaved(false), 2000);
    showToast?.(t('admin.memberDetail.externalIdSaved', { defaultValue: 'External ID saved' }), 'success');
  };

  // Normalize phone for comparison so cosmetic-only differences (spaces/dashes/parens)
  // between the saved value and what PhoneInput now formats aren't treated as edits.
  // The PhoneInput component stores E.164 (+ followed by digits) so we strip everything
  // non-digit before comparing.
  const normalizePhone = (s) => (s || '').replace(/[^\d+]/g, '');

  const handleSaveInfo = async () => {
    setInfoSaving(true);
    setInfoSaved(false);
    const updates = {};
    const composed = composeFullName(nameParts);
    if (composed && composed !== originalNameRef.current) updates.full_name = composed;
    if (memberUsername.trim() && memberUsername !== originalUsernameRef.current) updates.username = memberUsername.trim();
    const phoneVal = memberPhone.trim() || null;
    if (normalizePhone(phoneVal) !== normalizePhone(originalPhoneRef.current)) {
      updates.phone_number = phoneVal;
    }
    const startedVal = memberStartedAt || null;
    if (startedVal !== (originalStartedAtRef.current || null)) {
      updates.membership_started_at = startedVal;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('profiles').update(updates).eq('id', member.id).eq('gym_id', gymId);
      logAdminAction('update_info', 'member', member.id);
      if (updates.membership_started_at !== undefined) {
        originalStartedAtRef.current = updates.membership_started_at ?? '';
      }
      if (updates.phone_number !== undefined) {
        originalPhoneRef.current = updates.phone_number ?? '';
      }
      if (updates.full_name !== undefined) originalNameRef.current = updates.full_name;
      if (updates.username !== undefined) originalUsernameRef.current = updates.username;
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
      // The login email lives on auth.users only — profiles has no email column.
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

  // Unified Perfil save — replaces the three scattered save buttons with one
  // "Guardar cambios". Each underlying handler guards internally, so calling
  // both is safe even when only one group of fields changed.
  const composedName = composeFullName(nameParts);
  const namesOk = areNamePartsValid(nameParts);
  const emailDirty = !!(memberEmail.trim() && memberEmail !== originalEmailRef.current);
  const infoDirty = (
    composedName !== originalNameRef.current ||
    (memberUsername.trim() && memberUsername !== originalUsernameRef.current) ||
    normalizePhone(memberPhone) !== normalizePhone(originalPhoneRef.current) ||
    (memberStartedAt || '') !== (originalStartedAtRef.current || '')
  );
  const profileDirty = emailDirty || infoDirty;
  const profileSaving = infoSaving || emailSaving;

  const handleSaveProfile = async () => {
    if (infoDirty) await handleSaveInfo();
    if (emailDirty) await handleSaveEmail();
  };

  const resetProfileEdits = () => {
    setNameParts(splitFullName(originalNameRef.current || ''));
    setMemberUsername(originalUsernameRef.current || '');
    setMemberEmail(originalEmailRef.current || '');
    setMemberPhone(originalPhoneRef.current || '');
    setMemberStartedAt(originalStartedAtRef.current || '');
  };

  const handleExportMember = async () => {
    setExportingMember(true);
    try {
      await exportSelectedMembersCSV([member.id]);
      logAdminAction('export_member', 'member', member.id);
    } catch (err) {
      logger.error('Member export failed:', err);
      showToast?.(t('admin.members.bulkExportError', { defaultValue: 'Failed to export members. Please try again.' }), 'error');
    }
    setExportingMember(false);
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
      setResetError(err.message || t('admin.memberDetail.resetGenerateFailed', 'Failed to generate reset code.'));
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

  const handleConfirmStatusAction = async (maybeSurveyData = null) => {
    if (!pendingAction) return;
    // Guard against being called as an onClick handler — React passes a
    // SyntheticEvent we must ignore. Only treat as survey data if it
    // looks like our payload (has a string `category`).
    const surveyData = maybeSurveyData && typeof maybeSurveyData.category === 'string'
      ? maybeSurveyData
      : null;
    setStatusSaving(true);
    setStatusConflict(false);
    const nextStatus = statusActionMap[pendingAction].next;
    const oldStatus = memberStatus;
    const now = new Date().toISOString();

    // For cancellations, the survey's structured category replaces the
    // free-text reason. Keep a short summary in membership_status_reason
    // for the existing status timeline; the full payload lives in
    // cancellation_reasons (inserted below).
    const reasonForProfile = surveyData
      ? surveyData.category
      : (statusReason || null);

    // Optimistic locking: only update if the record hasn't been modified since we loaded it
    let query = supabase.from('profiles').update({
      membership_status: nextStatus,
      membership_status_updated_at: now,
      membership_status_reason: reasonForProfile,
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

    // Cancellation exit survey: write structured reason row.
    // Failure here is non-fatal — the status change already succeeded.
    if (surveyData && nextStatus === 'cancelled') {
      const memberSince = member.membership_started_at || member.created_at;
      const tenureDays = memberSince
        ? Math.max(0, Math.floor((Date.now() - new Date(memberSince).getTime()) / 86400000))
        : 0;
      try {
        const { error: surveyError } = await supabase.from('cancellation_reasons').insert({
          profile_id: member.id,
          gym_id: gymId,
          category: surveyData.category,
          details_text: surveyData.details_text,
          would_return_if: surveyData.would_return_if,
          tenure_days: tenureDays,
          recorded_by: adminId,
        });
        if (surveyError) throw surveyError;
        posthog?.capture('admin_cancellation_logged', { category: surveyData.category });
      } catch (err) {
        logger.error('Failed to log cancellation reason:', err);
        showToast?.(t('admin.cancellationSurvey.logFailed', { defaultValue: 'Cancellation saved, but exit survey failed to record.' }), 'warning');
      }
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

  const handleConfirmDelete = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setDeleteError(t('admin.memberDetail.deleteTypeMismatch', { defaultValue: 'Type DELETE to confirm.' }));
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      const { error } = await supabase.rpc('admin_delete_gym_member', { p_user_id: member.id });
      if (error) throw error;
      logAdminAction('delete_account', 'member', member.id, { name: member.full_name });
      posthog?.capture('admin_member_deleted');
      showToast(t('admin.memberDetail.deleteSuccess', { defaultValue: 'Account permanently deleted.' }), 'success');
      onStatusChanged?.(member.id, 'deleted');
      onClose?.();
    } catch (err) {
      logger.error('Member delete failed:', err);
      setDeleteError(err?.message || t('admin.memberDetail.deleteFailed', { defaultValue: 'Failed to delete member.' }));
      setDeleting(false);
    }
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
    if (churnRowId) {
      const { error: churnUpdateError } = await supabase.from('churn_risk_scores').update({ followup_sent_at: now }).eq('id', churnRowId);
      if (churnUpdateError) {
        logger.error('Failed to record followup_sent_at on churn_risk_scores', churnUpdateError);
      }
    }
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

  const daysInactive = member.daysInactive ?? null; // null = no gym activity on record
  const neverActive = member.neverActive ?? false;
  const tone = riskTone(risk.tier);

  const TABS = [
    { key: 'perfil',    label: t('admin.memberDetail.tabPerfil', { defaultValue: 'Profile' }),  icon: User },
    { key: 'cuenta',    label: t('admin.memberDetail.tabCuenta', { defaultValue: 'Account' }),   icon: Shield },
    { key: 'actividad', label: t('admin.memberDetail.tabActivity', 'Activity'),                  icon: Activity },
    { key: 'referidos', label: t('admin.referral.memberReferrals'),                              icon: Share2 },
    { key: 'avanzado',  label: t('admin.memberDetail.tabAvanzado', { defaultValue: 'Advanced' }), icon: AlertTriangle, danger: true },
  ];

  // Save-button label/state shared by the Perfil SaveBar.
  const profileSaved = infoSaved || emailSaved;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center px-4 overflow-y-auto pt-[calc(56px+env(safe-area-inset-top)+12px)] pb-[calc(80px+env(safe-area-inset-bottom)+12px)] md:py-6"
      style={{ background: 'rgba(24,22,18,0.46)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="member-detail-title"
        className="w-full max-w-[540px] max-h-[min(90vh,100%)] flex flex-col overflow-hidden my-auto rounded-2xl"
        style={{ background: 'var(--color-admin-sidebar)', border: '1px solid var(--color-admin-border)', boxShadow: 'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-4 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
          <Avatar name={member.full_name} size="lg" src={checkinUrl} />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span id="member-detail-title" className="font-bold text-[16px] truncate" style={{ fontFamily: 'var(--admin-font-display)', color: 'var(--color-admin-text)' }}>{member.full_name}</span>
              <StatusBadge status={memberStatus} />
            </div>
            <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-admin-text-muted)' }}>
              {member.username ? `@${member.username} · ` : ''}{t('admin.members.joined', 'joined')} {format(new Date(member.created_at), 'MMM yyyy', dateFnsLocale)}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('admin.memberDetail.closeAria', 'Close member detail')}
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)', border: '1px solid var(--color-admin-border)' }}>
            <X size={15} />
          </button>
        </div>

        {/* ── Risk strip (actionable) ────────────────────────── */}
        <div className="flex items-stretch gap-3 px-4 py-3 flex-shrink-0" style={{ background: 'var(--color-admin-panel)', borderBottom: '1px solid var(--color-admin-border)' }}>
          <div className="flex flex-col justify-center gap-1.5 px-3 py-2 rounded-xl flex-shrink-0" style={{ background: tone.soft, minWidth: 156 }}>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <AlertTriangle size={13} style={{ color: tone.ink }} />
              <span className="font-bold text-[12px]" style={{ color: tone.ink, fontFamily: 'var(--admin-font-display)' }}>
                {t(`admin.members.riskTier.${risk.tier}`, risk.label)}
              </span>
              {member.state !== 'insufficient_data' && member.state !== 'paused' && (
                <span className="ml-auto font-extrabold text-[13px]" style={{ color: tone.ink }}>{member.score}%</span>
              )}
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: `color-mix(in srgb, ${tone.bar} 22%, transparent)` }}>
              <div style={{ width: `${Math.min(100, Math.max(0, member.score))}%`, height: '100%', background: tone.bar }} />
            </div>
            {isFollowupCandidate && (
              <button onClick={() => setTab('actividad')}
                className="mt-0.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-[10.5px] font-bold transition-colors"
                style={{ height: 25, background: 'var(--color-admin-sidebar)', border: '1px solid var(--color-admin-border)', color: tone.ink }}>
                <Send size={11} /> {t('admin.memberDetail.sendFollowup', 'Send Follow-up')}
              </button>
            )}
          </div>
          <div className="flex-1 flex items-center min-w-0">
            <MStatPip value={daysInactive == null ? '—' : `${daysInactive}d`} label={neverActive ? t('admin.memberDetail.noActivity', 'No visits') : t('admin.memberDetail.inactive', 'Inactive')} />
            <div className="w-px self-stretch my-1.5" style={{ background: 'var(--color-admin-border)' }} />
            <MStatPip value={member.recentWorkouts ?? 0} label={t('admin.memberDetail.workouts14d', { defaultValue: 'Workouts · 14d' })} />
            <div className="w-px self-stretch my-1.5" style={{ background: 'var(--color-admin-border)' }} />
            <MStatPip value={challenges} label={t('admin.memberDetail.challenges', 'Challenges')} />
          </div>
        </div>

        {/* ── Tab bar ────────────────────────────────────────── */}
        <div className="flex gap-1 px-3 flex-shrink-0 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid var(--color-admin-border)' }} role="tablist">
          {TABS.map(tb => {
            const on = tb.key === tab;
            const Icon = tb.icon;
            return (
              <button key={tb.key} role="tab" aria-selected={on} onClick={() => setTab(tb.key)}
                className="relative inline-flex items-center gap-1.5 px-2.5 py-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors"
                style={{ color: on ? 'var(--color-accent)' : 'var(--color-admin-text-sub)', fontWeight: on ? 800 : 600 }}>
                {Icon && <Icon size={14} style={{ color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }} />}
                {tb.label}
                {tb.danger && <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--color-danger)' }} />}
                {on && <span className="absolute left-2 right-2 -bottom-px h-[2.5px] rounded-full" style={{ background: 'var(--color-accent)' }} />}
              </button>
            );
          })}
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : (
            <>
              {/* ════════ PERFIL ════════ */}
              {tab === 'perfil' && (
                <div className="space-y-5">
                  <div>
                    <MSecLabel icon={User}>{t('admin.memberDetail.contactInfo', { defaultValue: 'Contact information' })}</MSecLabel>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <MField label={<>{t('admin.nameFields.firstName', 'First name')} <span style={{ color: 'var(--color-danger)' }}>*</span></>}>
                          <MInput value={nameParts.first} onChange={e => setNameParts(p => ({ ...p, first: e.target.value }))} maxLength={40}
                            invalid={!!(nameParts.first || '').trim() && !isValidNamePart(nameParts.first)} />
                        </MField>
                        <MField label={t('admin.nameFields.middleName', 'Middle name')}>
                          <MInput value={nameParts.middle} onChange={e => setNameParts(p => ({ ...p, middle: e.target.value }))} maxLength={40}
                            invalid={!!(nameParts.middle || '').trim() && !isValidNamePart(nameParts.middle)} />
                        </MField>
                        <MField label={<>{t('admin.nameFields.lastName', 'Last name')} <span style={{ color: 'var(--color-danger)' }}>*</span></>}>
                          <MInput value={nameParts.last} onChange={e => setNameParts(p => ({ ...p, last: e.target.value }))} maxLength={40}
                            invalid={!!(nameParts.last || '').trim() && !isValidNamePart(nameParts.last)} />
                        </MField>
                        <MField label={t('admin.nameFields.secondLastName', 'Second last name')}>
                          <MInput value={nameParts.second} onChange={e => setNameParts(p => ({ ...p, second: e.target.value }))} maxLength={40}
                            invalid={!!(nameParts.second || '').trim() && !isValidNamePart(nameParts.second)} />
                        </MField>
                      </div>
                      {!namesOk && (
                        <p className="text-[10.5px] -mt-1" style={{ color: 'var(--color-danger-ink)' }}>
                          {t('admin.nameFields.nameInvalid', 'Names can only contain letters, spaces, hyphens and apostrophes.')}
                        </p>
                      )}
                      <MField label={t('admin.memberDetail.username', 'Username')}>
                        <MInput value={memberUsername} onChange={e => setMemberUsername(e.target.value)} prefix="@" maxLength={40} />
                      </MField>
                      <MField label={t('admin.memberDetail.email', 'Email')}>
                        <MInput type="email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} autoComplete="off" />
                      </MField>
                      <div className="grid grid-cols-2 gap-3">
                        <MField label={t('admin.memberDetail.phoneNumber', 'Phone Number')}>
                          <PhoneInput value={memberPhone} onChange={setMemberPhone} placeholder="555 123 4567" ariaLabel={t('admin.memberDetail.phoneNumber', 'Phone Number')} />
                        </MField>
                        <MField label={t('admin.memberDetail.membershipStartedAt', 'Gym join date')}>
                          <input type="date" value={memberStartedAt} onChange={e => setMemberStartedAt(e.target.value)} max={new Date().toISOString().slice(0, 10)}
                            className="w-full rounded-lg px-3 text-[13px] outline-none"
                            style={{ height: 38, background: 'var(--color-admin-sidebar)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
                        </MField>
                      </div>
                      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--color-admin-text-muted)' }}>
                        {t('admin.memberDetail.membershipStartedAtHelp', 'Set this to the member\'s actual gym join date if they joined before installing the app. Overrides the 90-day onboarding risk window for tenure-based churn scoring.')}
                      </p>
                    </div>
                  </div>

                  {/* Origin / invite */}
                  <div>
                    <MSecLabel icon={Link2}>{t('admin.memberDetail.origin', { defaultValue: 'Origin' })}</MSecLabel>
                    {(() => {
                      const hasLoggedIn = !!member.is_onboarded;
                      const pill = hasLoggedIn
                        ? { cls: 'admin-pill--good', label: t('admin.memberDetail.alreadyRegistered', 'Already Registered') }
                        : { cls: 'admin-pill--warn', label: memberInvite ? t('admin.memberDetail.pendingRegistration', 'Pending — Not yet logged in') : t('admin.memberDetail.notRegistered', 'Not Registered') };
                      return (
                        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                          <div className="min-w-0 flex-1">
                            {memberInvite ? (
                              <>
                                <p className="text-[13px] font-mono font-bold" style={{ color: 'var(--color-accent)' }}>{memberInvite.invite_code}</p>
                                <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>
                                  {memberInvite.used_at
                                    ? `${t('admin.memberDetail.registeredOn', 'Registered')} ${format(new Date(memberInvite.used_at), 'MMM d, yyyy', dateFnsLocale)}`
                                    : `${t('admin.memberDetail.createdOn', 'Created')} ${format(new Date(memberInvite.created_at), 'MMM d, yyyy', dateFnsLocale)}`}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
                                  {hasLoggedIn ? t('admin.memberDetail.directSignup', 'Direct signup') : t('admin.memberDetail.profileCreated', 'Profile created by admin')}
                                </p>
                                <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.noInviteUsed', 'No invite code was used')}</p>
                              </>
                            )}
                          </div>
                          {memberInvite && (
                            <button onClick={() => { navigator.clipboard.writeText(memberInvite.invite_code).catch(() => {}); setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
                              style={btnTone('ghost')}>
                              {inviteCopied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
                              {inviteCopied ? t('admin.memberDetail.copied', 'Copied') : t('admin.memberDetail.copy', 'Copy')}
                            </button>
                          )}
                          <span className={`admin-pill ${pill.cls} flex-shrink-0`}>{pill.label}</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ════════ CUENTA ════════ */}
              {tab === 'cuenta' && (
                <div className="space-y-5">
                  {/* Membership */}
                  <div>
                    <MSecLabel icon={UserCheck}>{t('admin.memberDetail.membership', 'Membership')}</MSecLabel>
                    {(() => {
                      const b = STATUS_BANNER[memberStatus] ?? STATUS_BANNER.active;
                      return (
                        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-3" style={{ background: b.soft }}>
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: b.dot }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-bold" style={{ color: b.ink }}>{t(`admin.statusLabels.${memberStatus}`, memberStatus)}</p>
                            {memberStatusUpdatedAt && (
                              <p className="text-[10.5px] mt-0.5" style={{ color: b.ink, opacity: 0.75 }}>
                                {t('admin.memberDetail.sinceDate', { date: format(new Date(memberStatusUpdatedAt), 'MMM d, yyyy', dateFnsLocale), defaultValue: 'Since {{date}}' })}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap gap-2">
                      {getStatusActions(memberStatus).map(action => {
                        const cfg = statusActionMap[action];
                        return (
                          <button key={action} onClick={() => {
                            setPendingAction(action);
                            setStatusConflict(false);
                            if (action === 'cancel') { setSaveStepOpen(true); } else { setShowStatusConfirm(true); }
                          }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors"
                            style={btnTone(cfg.tone)}>
                            {action === 'ban' || action === 'cancel' ? <UserX size={12} /> : action === 'freeze' ? <Ban size={12} /> : <UserCheck size={12} />}
                            {t(`admin.memberDetail.statusActions.${action}`, { defaultValue: cfg.label })}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Access & check-in — photo + external ID + QR grouped */}
                  <div>
                    <MSecLabel icon={QrCode}>{t('admin.memberDetail.accessCheckin', { defaultValue: 'Access & check-in' })}</MSecLabel>
                    <div className="space-y-3">
                      <div className="rounded-xl p-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                        <CheckinPhotoEditor
                          subjectId={member.id}
                          path={checkinPath}
                          onChange={setCheckinPath}
                          theme={{ accent: 'var(--color-accent)', surface: 'var(--color-admin-sidebar)', border: 'var(--color-admin-border)', text: 'var(--color-admin-text)', textSub: 'var(--color-admin-text-sub)', danger: 'var(--color-danger)', badgeBorder: 'var(--color-admin-sidebar)' }}
                          labels={{ photo: t('checkinPhoto.title', 'Check-in photo'), hint: t('checkinPhoto.hint', 'Staff only — used to verify identity at check-in.'), add: t('checkinPhoto.add', 'Add photo'), replace: t('checkinPhoto.replace', 'Replace'), remove: t('checkinPhoto.remove', 'Remove') }}
                        />
                      </div>
                      <MField label={t('admin.memberDetail.externalId', 'External ID')} hint={t('admin.memberDetail.externalIdDesc', "The code from your gym's existing system (e.g. keypad code, barcode number)")}
                        action={
                          <button onClick={handleSaveExternalId} disabled={externalIdSaving || externalId === originalExternalIdRef.current}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-40" style={{ color: externalIdSaved ? 'var(--color-success)' : 'var(--color-accent)' }}>
                            {externalIdSaved ? <Check size={11} /> : <Save size={11} />} {externalIdSaving ? t('admin.memberDetail.saving', 'Saving...') : externalIdSaved ? t('admin.memberDetail.saved', 'Saved!') : t('admin.memberDetail.save', 'Save')}
                          </button>
                        }>
                        <MInput value={externalId} onChange={e => setExternalId(e.target.value)} placeholder={t('admin.memberDetail.externalIdPlaceholder', 'e.g. 4821 or MBR-0042')} mono />
                      </MField>
                      {member.qr_code_payload && (
                        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: 'var(--color-admin-text)' }}>
                          <QrCode size={18} style={{ color: '#fff' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.55)' }}>{t('admin.memberDetail.currentQrPayload', 'Current QR payload')}</p>
                            <p className="text-[14px] font-mono font-bold truncate" style={{ color: '#fff', letterSpacing: '0.08em' }}>{member.qr_code_payload}</p>
                          </div>
                          <button onClick={() => navigator.clipboard.writeText(member.qr_code_payload).catch(() => {})}
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)' }}>
                            <Copy size={14} style={{ color: '#fff' }} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Security — password reset */}
                  <div>
                    <MSecLabel icon={KeyRound}>{t('admin.memberDetail.security', { defaultValue: 'Security' })}</MSecLabel>
                    <div className="rounded-xl p-3 space-y-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                      {resetCode ? (
                        <>
                          <p className="text-[12px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.memberDetail.showCode', 'Show this code to the member:')}</p>
                          <div className="flex items-center justify-center py-3">
                            <span className="text-[34px] font-mono font-bold tracking-[0.3em] select-all" style={{ color: 'var(--color-accent)' }}>{String(resetCode).padStart(6, '0')}</span>
                          </div>
                          <p className="text-[11px] text-center" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.codeExpires', 'Code expires in 30 minutes')}</p>
                          <p className="text-[11px] text-center leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.resetCodeHowto', { defaultValue: 'Member: open the app → “Forgot password” → “Have a code?” → enter it with a new password.' })}</p>
                          <div className="flex gap-2">
                            <button onClick={handleCopyCode} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold" style={btnTone('soft')}>
                              {codeCopied ? <><Check size={12} /> {t('admin.memberDetail.copied', 'Copied!')}</> : <><Copy size={12} /> {t('admin.memberDetail.copyCode', 'Copy Code')}</>}
                            </button>
                            <button onClick={() => { setResetCode(null); setResetError(''); }} className="flex-1 py-2 rounded-lg text-[12px] font-semibold" style={btnTone('ghost')}>
                              {t('admin.memberDetail.done', 'Done')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
                            <KeyRound size={16} style={{ color: 'var(--color-accent)' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.memberDetail.passwordReset', 'Password Reset')}</p>
                            <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.generateResetDesc', 'Generate a one-time 6-digit code the member can use to set a new password.')}</p>
                          </div>
                          <button onClick={handleGenerateResetCode} disabled={resetLoading}
                            className="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold flex-shrink-0 disabled:opacity-40" style={btnTone('soft')}>
                            {resetLoading ? t('admin.memberDetail.generating', 'Generating…') : t('admin.memberDetail.generate', { defaultValue: 'Generate' })}
                          </button>
                        </div>
                      )}
                      {resetError && (
                        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--color-danger-soft)' }}>
                          <p className="text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{resetError}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ════════ ACTIVIDAD ════════ */}
              {tab === 'actividad' && (
                <div className="space-y-5">
                  <div>
                    <MSecLabel icon={Activity}>{t('admin.memberDetail.recentActivity', { defaultValue: 'Recent activity' })}</MSecLabel>
                    {(sessions.length === 0 && prs.length === 0) ? (
                      <p className="text-[13px] text-center py-6" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.noActivity', 'No activity yet')}</p>
                    ) : (
                      <div className="space-y-4">
                        {/* Workouts */}
                        {sessions.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-admin-text-sub)' }}><Dumbbell size={12} /> {t('admin.memberDetail.tabWorkouts', 'Workouts')}</p>
                            <div className="space-y-2">
                              {(showAllWorkouts ? sessions : sessions.slice(0, 3)).map(s => (
                                <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-xl" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{s.name || t('admin.memberDetail.workout', 'Workout')}</p>
                                    <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{format(new Date(s.started_at), 'MMM d, yyyy', dateFnsLocale)}</p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    {s.total_volume_lbs > 0 && <p className="text-[12px] font-semibold" style={{ color: 'var(--color-admin-text-sub)' }}>{Math.round(s.total_volume_lbs).toLocaleString()} lbs</p>}
                                    {s.duration_seconds > 0 && <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{Math.floor(s.duration_seconds / 60)}m</p>}
                                  </div>
                                </div>
                              ))}
                              {sessions.length > 3 && (
                                <button onClick={() => setShowAllWorkouts(v => !v)}
                                  className="w-full py-2 text-[12px] font-semibold rounded-xl" style={showAllWorkouts ? btnTone('ghost') : btnTone('soft')}>
                                  {showAllWorkouts ? t('admin.memberDetail.showLess', 'Show less') : t('admin.memberDetail.seeMore', { count: sessions.length - 3, defaultValue: 'See {{count}} more' })}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {/* PRs */}
                        {prs.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-admin-text-sub)' }}><Trophy size={12} /> {t('admin.memberDetail.tabPRs', 'PRs')}</p>
                            <div className="space-y-2">
                              {prs.map((pr, i) => (
                                <div key={`${pr.exercise_id}-${pr.achieved_at || i}`} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: i < 3 ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-admin-sidebar)' }}>
                                    <Trophy size={13} style={{ color: i < 3 ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{pr.exercises?.name ?? pr.exercise_id}</p>
                                    {pr.achieved_at && <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{format(new Date(pr.achieved_at), 'MMM d, yyyy', dateFnsLocale)}</p>}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>{pr.weight_lbs} lbs × {pr.reps}</p>
                                    {pr.estimated_1rm > 0 && <p className="text-[10px]" style={{ color: 'var(--color-admin-text-muted)' }}>{Math.round(pr.estimated_1rm)} lbs {t('admin.memberDetail.est1RM', 'est. 1RM')}</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Churn follow-up */}
                  {isFollowupCandidate && (
                    <div>
                      <MSecLabel icon={Send}>{t('admin.memberDetail.sendFollowup', 'Send Follow-up')}</MSecLabel>
                      <div className="rounded-xl p-3 space-y-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                        {followupSentAt ? (
                          <div className="space-y-3">
                            <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.followupSent', 'Follow-up sent')} <span className="font-medium" style={{ color: 'var(--color-admin-text-sub)' }}>{format(new Date(followupSentAt), 'MMM d, yyyy', dateFnsLocale)}</span></p>
                            <div>
                              <p className="text-[11px] mb-2" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.outcome', 'Outcome')}</p>
                              {followupOutcome ? (
                                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={btnTone(outcomeConfig[followupOutcome]?.tone)}>
                                  {t(outcomeConfig[followupOutcome]?.labelKey, outcomeConfig[followupOutcome]?.label)}
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {Object.entries(outcomeConfig).map(([key, cfg]) => (
                                    <button key={key} onClick={() => handleSetOutcome(key)} disabled={outcomeSaving}
                                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full disabled:opacity-40" style={btnTone(cfg.tone)}>
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
                              className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none resize-none"
                              style={{ background: 'var(--color-admin-sidebar)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)', lineHeight: 1.5 }} />
                            <button onClick={handleSendFollowup} disabled={followupSending || !followupMsg.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg disabled:opacity-40" style={btnTone('soft')}>
                              <Send size={12} /> {followupSending ? t('admin.memberDetail.sendingFollowup', 'Sending…') : t('admin.memberDetail.sendFollowup', 'Send Follow-up')}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Admin note */}
                  <div>
                    <MSecLabel icon={FileText}>{t('admin.memberDetail.adminNote', 'Admin Note')}</MSecLabel>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={t('admin.memberDetail.adminNotePlaceholder', 'e.g. Reached out Jan 5 — no response. At risk of churning.')}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none"
                      style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
                    <div className="flex justify-end mt-2">
                      <button onClick={handleSaveNote} disabled={noteSaving || note === (member.admin_note ?? '')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg disabled:opacity-40" style={btnTone('soft')}>
                        <Save size={12} /> {noteSaving ? t('admin.memberDetail.saving', 'Saving…') : t('admin.memberDetail.saveNote', 'Save Note')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ════════ REFERIDOS ════════ */}
              {tab === 'referidos' && (
                <div className="space-y-4">
                  {referralCode && (
                    <div className="rounded-xl p-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                      <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.referral.referralCode')}</p>
                      <p className="text-[14px] font-mono font-bold" style={{ color: 'var(--color-accent)' }}>{referralCode}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                      <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--color-admin-text)' }}>{referralCount}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.referral.peopleReferred')}</p>
                    </div>
                    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                      <p className="text-[18px] font-bold tabular-nums" style={{ color: 'var(--color-success)' }}>{referrals.filter(r => r.status === 'completed').length}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.referral.completed')}</p>
                    </div>
                  </div>
                  <div>
                    <MSecLabel icon={Share2}>{t('admin.referral.referredList')}</MSecLabel>
                    {referrals.length === 0 ? (
                      <p className="text-[13px] text-center py-6" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.referral.noReferralsMember')}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {referrals.map(ref => {
                          const tones = { pending: 'warn', completed: 'good', expired: 'ghost' };
                          const labels = { pending: t('admin.referral.statusPending'), completed: t('admin.referral.statusCompleted'), expired: t('admin.referral.statusExpired') };
                          return (
                            <div key={ref.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{ref.profiles?.full_name || t('admin.memberDetail.unknownReferrer', 'Unknown')}</p>
                                <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{format(new Date(ref.created_at), 'MMM d, yyyy', dateFnsLocale)}</p>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={btnTone(tones[ref.status] || 'warn')}>
                                {labels[ref.status] || ref.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ════════ AVANZADO ════════ */}
              {tab === 'avanzado' && (
                <div className="space-y-4">
                  {/* Export */}
                  <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
                    <Download size={16} style={{ color: 'var(--color-admin-text-sub)' }} />
                    <p className="flex-1 text-[11.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.memberDetail.exportMemberData', { defaultValue: 'Export all of this member\'s data' })}</p>
                    <button onClick={handleExportMember} disabled={exportingMember} className="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold flex-shrink-0 disabled:opacity-40" style={btnTone('ghost')}>
                      {exportingMember ? t('admin.members.exporting', 'Exporting…') : t('admin.members.export', 'Export')}
                    </button>
                  </div>

                  {/* Danger zone */}
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-admin-border))' }}>
                    <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: 'var(--color-danger-soft)' }}>
                      <AlertTriangle size={13} style={{ color: 'var(--color-danger-ink)' }} />
                      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.09em]" style={{ color: 'var(--color-danger-ink)', fontFamily: 'var(--admin-font-display)' }}>{t('admin.memberDetail.dangerZone', { defaultValue: 'Danger Zone' })}</span>
                    </div>
                    <div className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.memberDetail.deleteAccount', { defaultValue: 'Delete Account' })}</p>
                          <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.memberDetail.deleteAccountHint', { defaultValue: 'Permanently removes this member and all their workouts, PRs, photos, and messages from your gym. Cannot be undone.' })}</p>
                        </div>
                        <button onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); setDeleteError(''); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold flex-shrink-0" style={btnTone('dangerSolid')}>
                          <Trash2 size={12} /> {t('admin.memberDetail.delete', { defaultValue: 'Delete' })}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Perfil SaveBar (footer) ────────────────────────── */}
        {!loading && tab === 'perfil' && (
          <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-admin-border)', background: 'var(--color-admin-sidebar)' }}>
            <span className="text-[11px]" style={{ color: profileSaved ? 'var(--color-success-ink)' : 'var(--color-admin-text-muted)' }}>
              {profileSaved ? t('admin.memberDetail.saved', 'Saved!') : (profileDirty ? t('admin.memberDetail.unsavedChanges', { defaultValue: 'Unsaved changes' }) : '')}
            </span>
            <div className="flex-1" />
            <button onClick={resetProfileEdits} disabled={!profileDirty || profileSaving} className="px-3.5 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-40" style={btnTone('ghost')}>
              {tc('cancel')}
            </button>
            <button onClick={handleSaveProfile} disabled={!profileDirty || profileSaving || !namesOk} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-bold disabled:opacity-40" style={btnTone('primary')}>
              <Check size={13} /> {profileSaving ? t('admin.memberDetail.saving', 'Saving…') : t('admin.memberDetail.saveChanges', { defaultValue: 'Save changes' })}
            </button>
          </div>
        )}

        {/* Save-step modal — opens BEFORE the cancellation survey so the
            owner has a real save conversation first. */}
        <CancellationSaveStep
          isOpen={saveStepOpen}
          onClose={() => { setSaveStepOpen(false); setPendingAction(null); }}
          member={member}
          onProceedToCancel={() => {
            setSaveStepOpen(false);
            // Hand off to the existing exit-survey modal.
            setShowStatusConfirm(true);
          }}
          onSaved={() => {
            setSaveStepOpen(false);
            setPendingAction(null);
            showToast(t('admin.cancellationSave.savedToast', { defaultValue: 'Nice save — cancellation skipped.' }), 'success');
          }}
        />

        {/* Cancellation exit survey (Hormozi-style) — replaces the generic
            confirm modal for the 'cancel' action so we capture structured
            reasons that feed the retention orchestrator. */}
        <CancellationSurveyModal
          isOpen={showStatusConfirm && pendingAction === 'cancel'}
          onClose={() => { setShowStatusConfirm(false); setPendingAction(null); setStatusReason(''); setStatusConflict(false); }}
          onConfirm={handleConfirmStatusAction}
          memberName={member.full_name}
          saving={statusSaving}
          conflict={statusConflict}
          priorCancellations={priorCancellations}
        />

        {/* Status action confirmation modal — freeze / deactivate / ban / reactivate / unban */}
        <AdminModal
          isOpen={showStatusConfirm && !!pendingAction && pendingAction !== 'cancel'}
          onClose={() => { setShowStatusConfirm(false); setPendingAction(null); setStatusReason(''); setStatusConflict(false); }}
          title={t('admin.memberDetail.confirmStatusTitle', { defaultValue: 'Confirm Action' })}
          titleIcon={AlertTriangle}
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setShowStatusConfirm(false); setPendingAction(null); setStatusReason(''); setStatusConflict(false); }}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap" style={btnTone('ghost')}
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleConfirmStatusAction}
                disabled={statusSaving}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap disabled:opacity-40" style={btnTone('dangerSolid')}
              >
                {statusSaving ? tc('saving', { defaultValue: 'Saving...' }) : tc('confirm')}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[12px] text-center" style={{ color: 'var(--color-admin-text-sub)' }}>
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
              className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
              style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
            />
            {statusConflict && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--color-warning-soft)' }}>
                <AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} className="flex-shrink-0" />
                <p className="text-[11px]" style={{ color: 'var(--color-warning-ink)' }}>
                  {t('admin.memberDetail.statusConflict', { defaultValue: 'This member was modified by another admin. The status has been refreshed. Please review and try again.' })}
                </p>
              </div>
            )}
          </div>
        </AdminModal>

        {/* Permanent delete confirmation modal */}
        <AdminModal
          isOpen={showDeleteModal}
          onClose={() => { if (!deleting) { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteError(''); } }}
          title={t('admin.memberDetail.deleteAccountTitle', { defaultValue: 'Delete Account' })}
          titleIcon={Trash2}
          size="sm"
          footer={
            <>
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteError(''); }}
                disabled={deleting}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap disabled:opacity-40" style={btnTone('ghost')}
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold whitespace-nowrap disabled:opacity-40" style={btnTone('dangerSolid')}
              >
                {deleting
                  ? t('admin.memberDetail.deleting', { defaultValue: 'Deleting…' })
                  : t('admin.memberDetail.deletePermanently', { defaultValue: 'Delete Permanently' })}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: 'var(--color-danger-soft)' }}>
              <AlertTriangle size={14} style={{ color: 'var(--color-danger-ink)' }} className="flex-shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-danger-ink)' }}>
                {t('admin.memberDetail.deleteWarning', {
                  name: member.full_name,
                  defaultValue: 'This permanently deletes {{name}} and all their workouts, PRs, body metrics, photos, messages, check-ins, and activity. This action cannot be undone.',
                })}
              </p>
            </div>
            <p className="text-[12px] text-center" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.memberDetail.deleteTypePrompt', { defaultValue: 'Type DELETE to confirm.' })}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              autoFocus
              autoComplete="off"
              placeholder="DELETE"
              aria-label={t('admin.memberDetail.deleteTypePrompt', { defaultValue: 'Type DELETE to confirm.' })}
              className="w-full rounded-lg px-3 py-2 text-[12px] outline-none font-mono tracking-widest text-center"
              style={{ background: 'var(--color-admin-panel)', border: '1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-admin-border))', color: 'var(--color-admin-text)' }}
            />
            {deleteError && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--color-danger-soft)' }}>
                <AlertTriangle size={14} style={{ color: 'var(--color-danger-ink)' }} className="flex-shrink-0" />
                <p className="text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{deleteError}</p>
              </div>
            )}
          </div>
        </AdminModal>
      </div>
    </div>
  );
}
