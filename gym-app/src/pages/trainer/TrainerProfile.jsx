import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, LogOut, Bell, Globe,
  Edit2, Check, X, Loader2, Camera, Mail, Shield, Trash2, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import UserAvatar from '../../components/UserAvatar';
import AvatarPicker from '../../components/AvatarPicker';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function TrainerProfile() {
  const navigate = useNavigate();
  const { profile, signOut, refreshProfile, patchProfile, deleteAccount, gymName } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation(['pages', 'common']);

  // Edit state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState({ full_name: '', username: '' });
  const [savingName, setSavingName] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Stats
  const [clientCount, setClientCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('trainer_clients')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', profile.id)
      .eq('is_active', true)
      .then(({ count }) => setClientCount(count || 0));

    supabase
      .from('trainer_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', profile.id)
      .then(({ count }) => setSessionCount(count || 0));
  }, [profile?.id]);

  const handleLanguageChange = (code) => {
    i18n.changeLanguage(code);
    if (profile?.id) {
      supabase.from('profiles').update({ preferred_language: code }).eq('id', profile.id).then(() => {});
    }
  };

  const startEditingName = () => {
    setNameDraft({
      full_name: profile?.full_name || '',
      username: profile?.username || '',
    });
    setEditingName(true);
  };

  const saveName = async () => {
    setSavingName(true);
    const updates = {};
    if (nameDraft.full_name.trim() && nameDraft.full_name !== profile?.full_name) {
      updates.full_name = nameDraft.full_name.trim();
    }
    if (nameDraft.username.trim() && nameDraft.username !== profile?.username) {
      updates.username = nameDraft.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
      if (error) {
        showToast(error.message, 'error');
      } else {
        await refreshProfile();
        showToast(t('pages:profile.saved', 'Profile updated'), 'success');
      }
    }
    setEditingName(false);
    setSavingName(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      showToast(err.message || t('pages:settings.failedToDelete', 'Failed to delete account'), 'error');
      setDeleting(false);
    }
  };

  const displayName = profile?.full_name || profile?.username || t('pages:trainerProfile.trainerBadge', 'Trainer');

  return (
    <div className="min-h-screen pb-4 md:pb-12" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div
        className="sticky top-0 z-30 backdrop-blur-2xl border-b"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 md:px-6 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('pages:trainerProfile.goBack', 'Go back')}
            className="w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-[22px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {t('trainerProfile.title', 'Profile')}
          </h1>
        </div>
      </div>

      <div className="px-4 md:px-6 pt-5 max-w-5xl mx-auto space-y-5">

        {/* ── Profile Card ── */}
        <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-4 px-5 py-5">
            {/* Avatar */}
            <button
              onClick={() => setAvatarPickerOpen(true)}
              className="relative flex-shrink-0 group"
            >
              <UserAvatar user={profile} size={64} />
              <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Camera size={20} className="text-white" />
              </div>
            </button>

            {/* Name / username */}
            <div className="flex-1 min-w-0">
              {!editingName ? (
                <>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {displayName}
                    </h2>
                    <button onClick={startEditingName} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                      <Edit2 size={14} />
                    </button>
                  </div>
                  {profile?.username && (
                    <p className="text-[13px] truncate" style={{ color: 'var(--color-text-muted)' }}>@{profile.username}</p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <Shield size={12} style={{ color: 'var(--color-accent)' }} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                      {t('pages:trainerProfile.trainerBadge', 'Trainer')}
                    </span>
                    {gymName && (
                      <span className="text-[11px] ml-1" style={{ color: 'var(--color-text-muted)' }}>
                        · {gymName}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={nameDraft.full_name}
                    onChange={e => setNameDraft(d => ({ ...d, full_name: e.target.value }))}
                    placeholder={t('pages:profile.fullName', 'Full name')}
                    className="w-full rounded-lg px-3 py-2 text-[14px] border outline-none focus:ring-2"
                    style={{
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  />
                  <input
                    type="text"
                    value={nameDraft.username}
                    onChange={e => setNameDraft(d => ({ ...d, username: e.target.value }))}
                    placeholder={t('pages:profile.username', 'Username')}
                    className="w-full rounded-lg px-3 py-2 text-[14px] border outline-none focus:ring-2"
                    style={{
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveName}
                      disabled={savingName}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors"
                      style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                    >
                      {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {t('common:save', 'Save')}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <X size={14} /> {t('common:cancel', 'Cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
            <div className="flex flex-col items-center py-3.5">
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>{clientCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerProfile.clients', 'Clients')}
              </p>
            </div>
            <div className="flex flex-col items-center py-3.5 border-x" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>{sessionCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerProfile.sessions', 'Sessions')}
              </p>
            </div>
            <div className="flex flex-col items-center py-3.5">
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>
                {profile?.email ? <Mail size={18} /> : '—'}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wider truncate max-w-full px-2" style={{ color: 'var(--color-text-muted)' }}>
                {profile?.email || t('trainerProfile.email', 'Email')}
              </p>
            </div>
          </div>
        </div>

        {/* ── Settings & Language: side-by-side on desktop ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── Settings ── */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('settings.general', 'General')}
            </h3>
            <div className="rounded-2xl border overflow-hidden divide-y" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
              {/* Notification preferences */}
              <button
                type="button"
                onClick={() => navigate('/trainer/notification-settings')}
                className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <div className="flex items-center gap-3">
                  <Bell size={16} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[14px] font-semibold">{t('settings.notificationPreferences', 'Notification Preferences')}</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            </div>
          </div>

          {/* ── Language ── */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('settings.language', 'Language')}
            </h3>
            <div className="rounded-2xl border overflow-hidden divide-y" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
              {LANGUAGES.map(lang => {
                const active = i18n.language === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleLanguageChange(lang.code)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{lang.flag}</span>
                      <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{lang.label}</span>
                    </div>
                    {active && <Check size={16} style={{ color: 'var(--color-accent)' }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Actions: constrained width on desktop ── */}
        <div className="max-w-md space-y-5">
          {/* ── Sign out ── */}
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border transition-colors"
            style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
          >
            <LogOut size={16} />
            <span className="text-[14px] font-semibold">{t('profile.logOut', 'Sign Out')}</span>
          </button>

          {/* ── Delete Account (Apple App Store requirement) ── */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-danger)' }}>
              {t('settings.dangerZone', 'Danger Zone')}
            </h3>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border transition-colors hover:bg-red-500/5"
                style={{ borderColor: 'rgba(217, 72, 72, 0.3)', color: '#EF4444' }}
              >
                <Trash2 size={16} />
                <span className="text-[14px] font-semibold">{t('settings.deleteAccount', 'Delete Account')}</span>
              </button>
            ) : (
              <div className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'rgba(217, 72, 72, 0.3)' }}>
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                      {t('settings.deleteAccount', 'Delete Account')}
                    </h3>
                    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                      {t('settings.deleteWarning', 'This action is permanent and cannot be undone. All your data, including client assignments and session history, will be permanently deleted.')}
                    </p>
                  </div>
                </div>
                <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('pages:trainerProfile.typeDeleteToConfirm', 'Type DELETE to confirm:')}
                </p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value.toUpperCase())}
                  placeholder="DELETE"
                  className="w-full rounded-xl px-4 py-3 text-[14px] font-mono border outline-none focus:ring-2 mb-3"
                  style={{
                    background: 'var(--color-bg-input)',
                    color: 'var(--color-text-primary)',
                    borderColor: deleteInput === 'DELETE' ? 'rgba(217, 72, 72, 0.5)' : 'var(--color-border-subtle)',
                  }}
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleteInput !== 'DELETE' || deleting}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] transition-all disabled:opacity-30"
                    style={{ background: '#EF4444', color: 'white' }}
                  >
                    {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    {deleting ? t('common:deleting', 'Deleting...') : t('settings.confirmDelete', 'Delete My Account')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="px-5 py-3 rounded-xl font-semibold text-[14px] transition-colors"
                    style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-hover)' }}
                  >
                    {t('common:cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Spacer */}
        <div className="h-4 md:h-8" />
      </div>

      {/* Avatar picker modal */}
      {avatarPickerOpen && (
        <AvatarPicker
          currentType={profile?.avatar_type}
          currentValue={profile?.avatar_value}
          onClose={() => setAvatarPickerOpen(false)}
          onSave={async (type, value) => {
            await patchProfile({ avatar_type: type, avatar_value: value });
            setAvatarPickerOpen(false);
            showToast(t('pages:profile.avatarUpdated', 'Avatar updated'), 'success');
          }}
        />
      )}
    </div>
  );
}
