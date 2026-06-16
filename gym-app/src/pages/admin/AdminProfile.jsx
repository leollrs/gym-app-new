import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, Mail, Shield, Camera, Save, Key, Clock, Activity,
  Calendar, ChevronRight, LogOut, CheckCircle, AlertTriangle, Pencil, X, Repeat, Sparkles,
} from 'lucide-react';
import ViewSwitcherModal from '../../components/ViewSwitcherModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow, startOfWeek } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import logger from '../../lib/logger';
import {
  AdminPageShell, AdminCard, StatCard,
  FadeIn, CardSkeleton, SectionLabel,
} from '../../components/admin';
import AvatarPicker from '../../components/AvatarPicker';
import UserAvatar from '../../components/UserAvatar';
import { ROLE_PILL_CLASS, ACTION_PILL_CLASS } from '../../lib/admin/profileHelpers';
import { validateImageFile } from '../../lib/validateImage';
import { stripExif } from '../../lib/stripExif';
import DeleteAccountModal from './components/DeleteAccountModal';
import { startAdminTour } from '../../components/admin/AdminTour';

export default function AdminProfile() {
  const navigate = useNavigate();
  const { profile, user, gymName, signOut, refreshProfile, patchProfile, availableRoles } = useAuth();
  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const locale = i18n.language === 'es' ? esLocale : undefined;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(profile?.full_name || '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const currentAvatar = {
    type: profile?.avatar_type || (profile?.avatar_url ? 'photo' : 'color'),
    value: profile?.avatar_value || '#6366F1',
  };

  // Mirrors the member-side avatar flow (Profile.jsx): the `avatars` bucket +
  // the real avatar_type/avatar_value/avatar_url columns. The previous admin
  // version wrote to nonexistent avatar_color/avatar_design columns and the
  // wrong bucket, so every save silently failed.
  const handleAvatarSave = async ({ type, value, file }) => {
    setUploading(true);
    try {
      if (type === 'photo' && file) {
        // Validate via magic bytes (MIME can be spoofed), strip EXIF + downscale.
        const validation = await validateImageFile(file);
        if (!validation.valid) { showToast(validation.error, 'error'); setUploading(false); return; }
        const cleanFile = await stripExif(file, { maxDimension: 256, quality: 0.85 });
        // Key must be <uid>/<file> so foldername[1] === auth.uid() (avatars
        // bucket INSERT RLS). Unique timestamp doubles as a cache-buster.
        const path = `${profile.id}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, cleanFile, { upsert: true, contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        const { error } = await supabase.from('profiles')
          .update({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null })
          .eq('id', profile.id);
        if (error) throw error;
        patchProfile?.({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null });
      } else {
        // Color or design — store type + value.
        const { error } = await supabase.from('profiles')
          .update({ avatar_type: type, avatar_value: value })
          .eq('id', profile.id);
        if (error) throw error;
        patchProfile?.({ avatar_type: type, avatar_value: value });
      }
      queryClient.invalidateQueries({ queryKey: adminKeys.overview(profile.gym_id) });
      await refreshProfile();
      showToast(t('admin.profile.avatarUpdated', 'Avatar updated'), 'success');
      setShowAvatarPicker(false);
    } catch (err) {
      logger.error('Avatar save failed', err);
      showToast(err.message || t('admin.profile.avatarError', 'Failed to update avatar'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const gymId = profile?.gym_id;

  // ── Recent audit log entries for this admin ──
  const { data: recentActivity, isLoading: activityLoading } = useQuery({
    queryKey: adminKeys.profile ? adminKeys.profile(gymId, profile?.id) : ['admin', 'profile', gymId, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_audit_log')
        .select('id, action, entity_type, entity_id, details, created_at')
        .eq('gym_id', gymId)
        .eq('actor_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId && !!profile?.id,
  });

  // ── Stats: actions THIS WEEK, member count, plus authoritative created_at ──
  const { data: stats } = useQuery({
    queryKey: ['admin', 'profile-stats', gymId, profile?.id],
    queryFn: async () => {
      // Monday 00:00 of the current week. The "Actions" KPI is scoped to this
      // week — the all-time count grew unboundedly large and wasn't useful.
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
      const [actionsRes, membersRes, profileRes] = await Promise.all([
        supabase.from('admin_audit_log').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('actor_id', profile.id).gte('created_at', weekStart),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('role', 'member'),
        supabase.from('profiles').select('created_at').eq('id', profile.id).maybeSingle(),
      ]);
      return {
        weeklyActions: actionsRes.count || 0,
        memberCount: membersRes.count || 0,
        createdAt: profileRes.data?.created_at || profile.created_at || null,
      };
    },
    enabled: !!gymId && !!profile?.id,
  });

  // ── Update profile mutation ──
  const updateProfileMutation = useMutation({
    mutationFn: async ({ full_name }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name })
        .eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      showToast(t('admin.profile.updateSuccess', 'Profile updated'), 'success');
      setEditing(false);
    },
    onError: (err) => {
      logger.error('Profile update failed', err);
      showToast(t('admin.profile.updateError', 'Failed to update profile'), 'error');
    },
  });

  // (Avatar upload is now handled inline by handleAvatarSave above via the
  // AvatarPicker component — the legacy file-input flow was removed when
  // the picker was introduced.)

  // ── Password change ──
  const handlePasswordChange = async () => {
    if (passwords.new.length < 8 || !/[A-Z]/.test(passwords.new) || !/[a-z]/.test(passwords.new) || !/[0-9]/.test(passwords.new)) {
      showToast(t('admin.profile.passwordTooWeak', 'Password must be 8+ characters with uppercase, lowercase, and a number'), 'error');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      showToast(t('admin.profile.passwordMismatch', 'Passwords do not match'), 'error');
      return;
    }
    try {
      // Always pull email from the live auth session (not stale profile.email)
      const { data: authData } = await supabase.auth.getUser();
      const liveEmail = authData?.user?.email;
      if (!liveEmail) throw new Error('No active session');

      // Verify current password before allowing change
      const { error: reAuthError } = await supabase.auth.signInWithPassword({
        email: liveEmail,
        password: passwords.current,
      });
      if (reAuthError) {
        showToast(t('admin.profile.currentPasswordWrong', 'Current password is incorrect'), 'error');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: passwords.new });
      if (error) throw error;
      showToast(t('admin.profile.passwordChanged', 'Password changed successfully. Please sign in again.'), 'success');
      setChangingPassword(false);
      setPasswords({ current: '', new: '', confirm: '' });
      // Force a fresh session with the new password.
      await supabase.auth.signOut();
    } catch (err) {
      logger.error('Password change failed', err);
      showToast(err.message || t('admin.profile.passwordError', 'Failed to change password'), 'error');
    }
  };

  const roleLabel = profile?.role === 'super_admin'
    ? t('admin.profile.roles.superAdmin', 'Super Admin')
    : profile?.role === 'admin'
      ? t('admin.profile.roles.admin', 'Admin')
      : profile?.role === 'trainer'
        ? t('admin.profile.roles.trainer', 'Trainer')
        : profile?.role === 'member'
          ? t('admin.profile.roles.member', 'Member')
          : profile?.role;
  const rolePillClass = ROLE_PILL_CLASS[profile?.role] || 'admin-pill admin-pill--outline';
  // created_at falls back to the dedicated query so the card never shows "—"
  // when get_auth_context omits the column.
  const createdAt = stats?.createdAt || profile?.created_at || null;
  const memberSince = createdAt
    ? format(new Date(createdAt), 'MMM d, yyyy', { locale })
    : '—';

  return (
    <AdminPageShell size="narrow">
      <div className="space-y-5 sm:space-y-6">
        {/* ── HERO ─────────────────────────────────────────────── */}
        <FadeIn>
          <AdminCard className="p-0 overflow-hidden">
            {/* Cover with subtle radial highlight + top-right action row */}
            <div
              className="relative h-36 sm:h-44"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 50%, #000) 100%)',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0,
                  background:
                    'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.18), transparent 55%)',
                }}
              />
              {/* Cover icon row — Switch view only (when multi-role).
                  Settings is already accessible from the main nav, so the
                  cover-level shortcut was pure decoration. */}
              {hasMultipleViews && (
                <div className="absolute top-3 right-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowViewSwitcher(true)}
                    aria-label={tc('viewSwitcher.title', 'Switch view')}
                    title={tc('viewSwitcher.title', 'Switch view')}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                    style={{
                      background: 'rgba(255,255,255,0.22)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      color: '#fff',
                    }}
                  >
                    <Repeat className="w-4 h-4" strokeWidth={2.2} />
                  </button>
                </div>
              )}
            </div>

            {/* Identity row — avatar overlaps cover, name+role+meta to the right.
                Negative margin lives on the avatar wrapper ONLY so the name
                stays below the cover gradient (previously the row-level
                -mt-14/16 + items-end pulled the name's TOP up into the cover,
                making the colored band visually cover the start of the name). */}
            <div className="px-5 sm:px-6 pb-5 sm:pb-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5">
                {/* Avatar — pulled up into the cover via its own negative margin */}
                <div className="relative shrink-0 -mt-14 sm:-mt-16">
                  <div
                    className="rounded-3xl overflow-hidden border-4 shadow-xl"
                    style={{ borderColor: 'var(--color-bg-card)', width: 112, height: 112 }}
                  >
                    <UserAvatar
                      user={profile}
                      size={104}
                      rounded="3xl"
                    />
                  </div>
                  <button
                    onClick={() => setShowAvatarPicker(true)}
                    disabled={uploading}
                    aria-label={t('admin.profile.changeAvatar', 'Change avatar')}
                    className="absolute -bottom-1 -right-1 p-2 rounded-full shadow-lg transition-transform duration-200 hover:scale-110"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Name + role + meta */}
                <div className="flex-1 min-w-0 sm:pb-2">
                  {editing ? (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={t('admin.profile.fullName', 'Full name')}
                        className="flex-1 min-w-0 text-xl sm:text-2xl font-bold rounded-lg px-3 py-1.5 border transition-colors"
                        style={{
                          background: 'var(--color-bg-input, var(--color-bg-elevated))',
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => updateProfileMutation.mutate({ full_name: editName })}
                        disabled={updateProfileMutation.isPending || !editName.trim()}
                        aria-label={t('admin.profile.saveName', 'Save name')}
                        className="p-2 rounded-lg transition-colors hover:bg-emerald-500/10"
                        style={{ color: 'var(--color-success)' }}
                      >
                        <CheckCircle className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => { setEditing(false); setEditName(profile?.full_name || ''); }}
                        aria-label={t('admin.profile.cancelEdit', 'Cancel editing')}
                        className="p-2 rounded-lg transition-colors hover:bg-red-500/10"
                        style={{ color: 'var(--color-danger)' }}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h1
                        className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {profile?.full_name || '—'}
                      </h1>
                      <button
                        onClick={() => { setEditing(true); setEditName(profile?.full_name || ''); }}
                        aria-label={t('admin.profile.editName', 'Edit name')}
                        className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className={`${rolePillClass} inline-flex items-center gap-1.5`}>
                      <Shield className="w-3 h-3" />
                      {roleLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      <Mail className="w-3 h-3" />
                      <span className="truncate max-w-[220px]">{user?.email || profile?.email || '—'}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                      <Calendar className="w-3 h-3" />
                      {t('admin.profile.memberSince', 'Member since')} <span className="admin-mono">{memberSince}</span>
                    </span>
                  </div>
                </div>

              </div>
            </div>
          </AdminCard>
        </FadeIn>

        {/* ── 2-STAT STRIP ─────────────────────────────────────────
            Trimmed from 4 to 2: kept Actions + Members (real activity).
            Days-as-admin was vanity; Last sign-in already lives in the
            Security card below — no need to surface it twice. */}
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label={t('admin.profile.totalActions', 'Actions')}
              sub={t('admin.profile.thisWeek', 'This week')}
              value={stats?.weeklyActions ?? '—'}
              icon={Activity}
              borderColor="var(--color-info)"
            />
            <StatCard
              label={t('admin.profile.membersManaged', 'Members')}
              value={stats?.memberCount ?? '—'}
              icon={User}
              borderColor="var(--color-success)"
              onClick={() => navigate('/admin/members')}
            />
          </div>
        </FadeIn>

        {/* ── TWO-COLUMN: (Security + Account) | Recent Activity ──
            Security sits top-left, Account directly beneath it (same width),
            and Recent Activity spans both rows on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
          {/* Security section — left column, row 1 */}
          <FadeIn delay={0.1} className="lg:col-start-1 lg:row-start-1">
            <SectionLabel>{t('admin.profile.security', 'Security')}</SectionLabel>
            <AdminCard className="p-4 sm:p-5">
              <div className="space-y-4">
                {/* Email row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'var(--color-bg-elevated)' }}>
                      <Mail className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {t('admin.profile.email', 'Email')}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {user?.email || '—'}
                      </p>
                    </div>
                  </div>
                  <span className="admin-pill admin-pill--good inline-flex items-center gap-1.5 flex-shrink-0">
                    <CheckCircle className="w-3 h-3" />
                    {t('admin.profile.verified', 'Verified')}
                  </span>
                </div>

                <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }} />

                {/* Password row */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'var(--color-bg-elevated)' }}>
                        <Key className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                          {t('admin.profile.password', 'Password')}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                          {t('admin.profile.passwordHint', 'Last changed — unknown')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setChangingPassword(!changingPassword)}
                      className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        color: 'var(--color-accent)',
                        background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      }}
                    >
                      {changingPassword ? t('admin.profile.cancel', 'Cancel') : t('admin.profile.change', 'Change')}
                    </button>
                  </div>

                  {changingPassword && (
                    <div className="mt-4 ml-0 sm:ml-11 space-y-3">
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder={t('admin.profile.currentPassword', 'Current password')}
                        aria-label={t('admin.profile.currentPassword', 'Current password')}
                        value={passwords.current}
                        onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors"
                        style={{
                          background: 'var(--color-bg-input, var(--color-bg-elevated))',
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder={t('admin.profile.newPassword', 'New password')}
                        aria-label={t('admin.profile.newPassword', 'New password')}
                        value={passwords.new}
                        onChange={(e) => setPasswords(p => ({ ...p, new: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors"
                        style={{
                          background: 'var(--color-bg-input, var(--color-bg-elevated))',
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                      <input
                        type="password"
                        placeholder={t('admin.profile.confirmPassword', 'Confirm password')}
                        aria-label={t('admin.profile.confirmPassword', 'Confirm password')}
                        value={passwords.confirm}
                        onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border text-sm transition-colors"
                        style={{
                          background: 'var(--color-bg-input, var(--color-bg-elevated))',
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                      />
                      <button
                        onClick={handlePasswordChange}
                        disabled={!passwords.current || !passwords.new || !passwords.confirm}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:opacity-40 disabled:pointer-events-none"
                        style={{
                          background: 'var(--color-accent)',
                          color: 'var(--color-text-on-accent, #fff)',
                        }}
                      >
                        <Save className="w-3.5 h-3.5" />
                        {t('admin.profile.updatePassword', 'Update Password')}
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }} />

                {/* Last sign in */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'var(--color-bg-elevated)' }}>
                      <Clock className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {t('admin.profile.lastSignIn', 'Last Sign In')}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {user?.last_sign_in_at
                          ? formatDistanceToNow(new Date(user.last_sign_in_at), { addSuffix: true, locale })
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </AdminCard>
          </FadeIn>

          {/* Recent activity — right column, spans both rows */}
          <FadeIn delay={0.2} className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <SectionLabel>{t('admin.profile.recentActivity', 'Recent Activity')}</SectionLabel>
            <AdminCard className="p-4 sm:p-5">
              {activityLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-8 h-8 rounded-lg" style={{ background: 'var(--color-bg-elevated)' }} />
                      <div className="flex-1">
                        <div className="h-3 rounded w-2/3 mb-1.5" style={{ background: 'var(--color-bg-elevated)' }} />
                        <div className="h-2.5 rounded w-1/3" style={{ background: 'var(--color-bg-elevated)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !recentActivity?.length ? (
                <div className="text-center py-8">
                  <Activity className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-text-subtle)', opacity: 0.5 }} />
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.profile.noActivity', 'No recent activity')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentActivity.map((entry) => {
                    const actionPill = ACTION_PILL_CLASS[entry.action] || 'admin-pill admin-pill--outline';
                    const actionLabel = t(`admin.profile.actions.${entry.action}`, { defaultValue: entry.action?.replace(/_/g, ' ') });
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-lg transition-colors duration-200"
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div className={`${actionPill} !p-1.5 flex items-center justify-center`}>
                          <Activity className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium capitalize truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {actionLabel}
                          </p>
                          {entry.details?.name && (
                            <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                              {entry.details.name}
                            </p>
                          )}
                        </div>
                        <span className="admin-mono text-xs whitespace-nowrap" style={{ color: 'var(--color-text-subtle)' }}>
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </AdminCard>
          </FadeIn>

        {/* ── ACCOUNT — left column, row 2 (directly under Security) ── */}
        <FadeIn delay={0.25} className="lg:col-start-1 lg:row-start-2">
          <SectionLabel>{t('admin.profile.account', 'Account')}</SectionLabel>
          <AdminCard className="p-0 overflow-hidden">
            {/* "Show welcome guide" — relaunches the page-by-page product tour
                (AdminTour, mounted in AdminLayout). Bounces to the overview and
                replays every stop so the owner can rediscover what each page
                does and why it matters. */}
            <button
              onClick={() => {
                navigate('/admin');
                startAdminTour();
              }}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-3">
                <span
                  className="p-2 rounded-xl flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)' }}
                >
                  <Sparkles className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('admin.overview.welcomeBtnShowAgain', 'Show welcome guide')}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.profile.welcomeBtnSub', 'Re-read the retention thesis and first-week actions')}
                  </span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-subtle)' }} />
            </button>

            <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

            <button
              onClick={signOut}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-white/[0.04]"
            >
              <span className="flex items-center gap-3">
                <span
                  className="p-2 rounded-xl flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)', color: 'var(--color-danger)' }}
                >
                  <LogOut className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {tc('adminNav.signOut', 'Sign out')}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.profile.signOutSub', 'You can come back anytime')}
                  </span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-subtle)' }} />
            </button>

            <div style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-red-500/[0.05]"
            >
              <span className="flex items-center gap-3">
                <span
                  className="p-2 rounded-xl flex-shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)', color: 'var(--color-danger)' }}
                >
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>
                    {t('admin.profile.deleteAccount', 'Delete account')}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.profile.deleteAccountSub', 'Permanent — all your data will be removed')}
                  </span>
                </span>
              </span>
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-subtle)' }} />
            </button>
          </AdminCard>
        </FadeIn>
        </div>
      </div>

      {/* Delete account confirmation */}
      <DeleteAccountModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        gymId={profile?.gym_id}
        signOut={signOut}
      />

      {/* Avatar Picker */}
      <AvatarPicker
        isOpen={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        currentAvatar={currentAvatar}
        user={profile}
        onSave={handleAvatarSave}
        uploading={uploading}
      />

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
    </AdminPageShell>
  );
}
