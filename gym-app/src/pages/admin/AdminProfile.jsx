import { useState, useRef } from 'react';
import {
  User, Mail, Shield, Camera, Save, Key, Clock, Activity,
  Calendar, ChevronRight, LogOut, CheckCircle, AlertTriangle, Pencil, X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { validateImageFile } from '../../lib/validateImage';
import logger from '../../lib/logger';
import {
  PageHeader, AdminPageShell, AdminCard, StatCard,
  FadeIn, CardSkeleton, SectionLabel,
} from '../../components/admin';
import AvatarPicker from '../../components/AvatarPicker';
import UserAvatar from '../../components/UserAvatar';

const ROLE_LABELS = {
  super_admin: { en: 'Super Admin', es: 'Super Admin' },
  admin:       { en: 'Admin',       es: 'Administrador' },
  trainer:     { en: 'Trainer',     es: 'Entrenador' },
};

const ROLE_COLORS = {
  super_admin: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  admin:       'text-blue-400 bg-blue-500/10 border-blue-500/20',
  trainer:     'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

const ACTION_COLORS = {
  member_invited:          'text-blue-400 bg-blue-500/10',
  member_deleted:          'text-red-400 bg-red-500/10',
  role_changed:            'text-amber-400 bg-amber-500/10',
  setting_updated:         'text-amber-400 bg-amber-500/10',
  challenge_created:       'text-emerald-400 bg-emerald-500/10',
  announcement_published:  'text-emerald-400 bg-emerald-500/10',
  class_created:           'text-blue-400 bg-blue-500/10',
  program_created:         'text-emerald-400 bg-emerald-500/10',
  store_item_created:      'text-purple-400 bg-purple-500/10',
  trainer_added:           'text-blue-400 bg-blue-500/10',
  trainer_demoted:         'text-red-400 bg-red-500/10',
  moderation_action:       'text-red-400 bg-red-500/10',
};

// ── Compress avatar image ────────────────────────────────────────────────────
async function compressAvatar(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height); height = maxSize;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('compress failed')), 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export default function AdminProfile() {
  const { profile, user, gymName, signOut, refreshProfile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const locale = i18n.language === 'es' ? esLocale : undefined;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(profile?.full_name || '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [uploading, setUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  const currentAvatar = profile?.avatar_url
    ? { type: 'photo', value: profile.avatar_url }
    : profile?.avatar_color
      ? { type: 'color', value: profile.avatar_color }
      : profile?.avatar_design
        ? { type: 'design', value: profile.avatar_design }
        : { type: 'color', value: '#6366F1' };

  const handleAvatarSave = async ({ type, value, file }) => {
    setUploading(true);
    try {
      if (type === 'photo' && file) {
        const compressed = await compressAvatar(file);
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `avatars/${profile.id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, compressed, { upsert: true });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(path);
        const { error } = await supabase.from('profiles').update({
          avatar_url: urlData.publicUrl + '?v=' + Date.now(),
          avatar_color: null, avatar_design: null,
        }).eq('id', profile.id);
        if (error) throw error;
      } else if (type === 'color') {
        const { error } = await supabase.from('profiles').update({
          avatar_color: value, avatar_design: null, avatar_url: null,
        }).eq('id', profile.id);
        if (error) throw error;
      } else if (type === 'design') {
        const { error } = await supabase.from('profiles').update({
          avatar_design: value, avatar_color: null, avatar_url: null,
        }).eq('id', profile.id);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: adminKeys.overview(profile.gym_id) });
      await refreshProfile();
      showToast(t('admin.profile.avatarUpdated', 'Avatar actualizado'), 'success');
      setShowAvatarPicker(false);
    } catch (err) {
      logger.error('Avatar save failed', err);
      showToast(err.message || t('admin.profile.avatarError', 'Error al actualizar avatar'), 'error');
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

  // ── Stats: total actions by this admin ──
  const { data: stats } = useQuery({
    queryKey: ['admin', 'profile-stats', gymId, profile?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('admin_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('actor_id', profile.id);
      if (error) throw error;
      return { totalActions: count || 0 };
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

  // ── Avatar upload ──
  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = await validateImageFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    setUploading(true);
    try {
      const compressed = await compressAvatar(file);
      const ext = 'jpg';
      const path = `avatars/${profile.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl + '?v=' + Date.now() })
        .eq('id', profile.id);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['admin'] });
      showToast(t('admin.profile.avatarUpdated', 'Avatar updated'), 'success');
    } catch (err) {
      logger.error('Avatar upload failed', err);
      showToast(t('admin.profile.avatarError', 'Failed to upload avatar'), 'error');
    } finally {
      setUploading(false);
    }
  };

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
      // Verify current password before allowing change
      const { error: reAuthError } = await supabase.auth.signInWithPassword({
        email: profile.email || (await supabase.auth.getUser()).data.user?.email,
        password: passwords.current,
      });
      if (reAuthError) {
        showToast(t('admin.profile.currentPasswordWrong', 'Current password is incorrect'), 'error');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: passwords.new });
      if (error) throw error;
      showToast(t('admin.profile.passwordChanged', 'Password changed successfully'), 'success');
      setChangingPassword(false);
      setPasswords({ current: '', new: '', confirm: '' });
    } catch (err) {
      logger.error('Password change failed', err);
      showToast(err.message || t('admin.profile.passwordError', 'Failed to change password'), 'error');
    }
  };

  const roleBadge = ROLE_LABELS[profile?.role] || { en: profile?.role, es: profile?.role };
  const roleColor = ROLE_COLORS[profile?.role] || 'text-gray-400 bg-gray-500/10 border-gray-500/20';
  const memberSince = profile?.created_at
    ? format(new Date(profile.created_at), 'MMM d, yyyy', { locale })
    : '—';

  return (
    <AdminPageShell size="narrow">
      <PageHeader
        title={t('admin.profile.title', 'My Profile')}
        subtitle={t('admin.profile.subtitle', 'Manage your admin account')}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* ── LEFT COLUMN: Profile card ── */}
        <FadeIn className="lg:col-span-1">
          <AdminCard className="p-0 overflow-hidden">
            {/* Header gradient */}
            <div className="h-24 relative" style={{ background: 'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 60%, #000) 100%)' }}>
              <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
                <div className="relative group">
                  <div className="rounded-2xl overflow-hidden border-4 shadow-xl"
                       style={{ borderColor: 'var(--color-bg-card)', width: 96, height: 96 }}>
                    <UserAvatar
                      user={{
                        ...profile,
                        avatar_type: profile?.avatar_url ? 'photo' : profile?.avatar_design ? 'design' : 'color',
                        avatar_value: profile?.avatar_url || profile?.avatar_design || profile?.avatar_color || '#6366F1',
                      }}
                      size={88}
                      rounded="2xl"
                    />
                  </div>
                  <button
                    onClick={() => setShowAvatarPicker(true)}
                    disabled={uploading}
                    aria-label={t('admin.profile.changeAvatar', 'Change avatar')}
                    className="absolute -bottom-1 -right-1 p-1.5 rounded-full shadow-lg transition-all duration-200 hover:scale-110"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Profile info */}
            <div className="pt-16 pb-6 px-6 text-center">
              {editing ? (
                <div className="flex items-center gap-2 justify-center mb-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label={t('admin.profile.fullName', 'Full name')}
                    className="text-lg font-bold text-center rounded-lg px-3 py-1.5 border transition-colors"
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
                    className="p-1.5 rounded-lg transition-colors hover:bg-emerald-500/10"
                    style={{ color: 'var(--color-success)' }}
                  >
                    <CheckCircle className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditName(profile?.full_name || ''); }}
                    aria-label={t('admin.profile.cancelEdit', 'Cancel editing')}
                    className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                    style={{ color: 'var(--color-danger)' }}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 mb-2">
                  <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {profile?.full_name || '—'}
                  </h2>
                  <button
                    onClick={() => { setEditing(true); setEditName(profile?.full_name || ''); }}
                    aria-label={t('admin.profile.editName', 'Edit name')}
                    className="p-1 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-center gap-1.5 mb-3" style={{ color: 'var(--color-text-muted)' }}>
                <Mail className="w-3.5 h-3.5" />
                <span className="text-sm">{user?.email || profile?.email || '—'}</span>
              </div>

              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${roleColor}`}>
                <Shield className="w-3 h-3" />
                {i18n.language === 'es' ? roleBadge.es : roleBadge.en}
              </span>

              <div className="mt-4 pt-4 flex items-center justify-center gap-1.5 text-xs"
                   style={{ borderTop: '1px solid var(--color-border-subtle)', color: 'var(--color-text-subtle)' }}>
                <Calendar className="w-3 h-3" />
                {t('admin.profile.memberSince', 'Member since')} {memberSince}
              </div>
            </div>
          </AdminCard>

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <StatCard
              label={t('admin.profile.totalActions', 'Actions')}
              value={stats?.totalActions ?? '—'}
              icon={Activity}
            />
            <StatCard
              label={t('admin.profile.gymName', 'Gym')}
              value={gymName || '—'}
              icon={User}
              small
            />
          </div>
        </FadeIn>

        {/* ── RIGHT COLUMN: Security + Activity ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Security section */}
          <FadeIn delay={0.1}>
            <SectionLabel>{t('admin.profile.security', 'Security')}</SectionLabel>
            <AdminCard className="p-5">
              <div className="space-y-4">
                {/* Email row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl" style={{ background: 'var(--color-bg-elevated)' }}>
                      <Mail className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {t('admin.profile.email', 'Email')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {user?.email || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                       style={{ background: 'var(--color-success)', color: '#fff', opacity: 0.9 }}>
                    <CheckCircle className="w-3 h-3" />
                    {t('admin.profile.verified', 'Verified')}
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid var(--color-border-subtle)' }} />

                {/* Password row */}
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl" style={{ background: 'var(--color-bg-elevated)' }}>
                        <Key className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                          {t('admin.profile.password', 'Password')}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {t('admin.profile.passwordHint', 'Last changed — unknown')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setChangingPassword(!changingPassword)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        color: 'var(--color-accent)',
                        background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      }}
                    >
                      {changingPassword ? t('admin.profile.cancel', 'Cancel') : t('admin.profile.change', 'Change')}
                    </button>
                  </div>

                  {changingPassword && (
                    <div className="mt-4 ml-11 space-y-3">
                      <input
                        type="password"
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
                        disabled={!passwords.new || !passwords.confirm}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl" style={{ background: 'var(--color-bg-elevated)' }}>
                      <Clock className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {t('admin.profile.lastSignIn', 'Last Sign In')}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
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

          {/* Recent activity */}
          <FadeIn delay={0.2}>
            <SectionLabel>{t('admin.profile.recentActivity', 'Recent Activity')}</SectionLabel>
            <AdminCard className="p-5">
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
                    const actionColor = ACTION_COLORS[entry.action] || 'text-gray-400 bg-gray-500/10';
                    const actionLabel = entry.action?.replace(/_/g, ' ');
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-lg transition-colors duration-200"
                        style={{ '--hover-bg': 'var(--color-bg-elevated)' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div className={`p-1.5 rounded-lg ${actionColor}`}>
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
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-subtle)' }}>
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </AdminCard>
          </FadeIn>

          {/* Sign out */}
          <FadeIn delay={0.3}>
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-[1.01] w-full justify-center"
              style={{
                color: 'var(--color-danger)',
                background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-danger) 15%, transparent)',
              }}
            >
              <LogOut className="w-4 h-4" />
              {tc('adminNav.signOut', 'Sign out')}
            </button>

            {/* Delete account */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold transition-colors mt-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <AlertTriangle className="w-4 h-4" />
              {t('admin.profile.deleteAccount', 'Delete Account')}
            </button>
          </FadeIn>
        </div>
      </div>

      {/* Delete account confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
            onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={18} style={{ color: '#EF4444' }} />
                <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.profile.deleteAccount', 'Delete Account')}</h3>
              </div>
              <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.profile.deleteWarning', 'This action is permanent. All your data will be deleted and cannot be undone.')}
              </p>
              <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.profile.deleteTypeConfirm', 'Type DELETE to confirm:')}
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder="ELIMINAR"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none mb-4"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
              />
              <div className="flex gap-3">
                <button onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                  {t('admin.profile.cancel', 'Cancel')}
                </button>
                <button
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      // Guard: prevent last admin from deleting their account
                      const { count } = await supabase
                        .from('profiles')
                        .select('id', { count: 'exact', head: true })
                        .eq('gym_id', profile.gym_id)
                        .eq('role', 'admin');
                      if (count != null && count <= 1) {
                        showToast(tc('lastAdminCannotDelete'), 'error');
                        setDeleting(false);
                        return;
                      }
                      await supabase.rpc('delete_own_account');
                      await signOut();
                    } catch (err) {
                      logger.error('Account deletion failed', err);
                      showToast(err.message || 'Error', 'error');
                      setDeleting(false);
                    }
                  }}
                  disabled={deleteInput.toLowerCase() !== 'eliminar' || deleting}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
                  style={{ backgroundColor: '#EF4444', color: '#fff' }}>
                  {deleting ? t('admin.profile.deleting', 'Deleting...') : t('admin.profile.deleteConfirmBtn', 'Delete Account')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Avatar Picker */}
      <AvatarPicker
        isOpen={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        currentAvatar={currentAvatar}
        user={profile}
        onSave={handleAvatarSave}
        uploading={uploading}
      />
    </AdminPageShell>
  );
}
