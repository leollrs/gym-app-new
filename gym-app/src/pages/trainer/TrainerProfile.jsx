import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, LogOut, Bell,
  Edit2, Check, X, Loader2, Camera, Mail, Shield, Trash2, AlertTriangle,
  Phone, Award, FileText, Clock, Plus,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { validateImageFile } from '../../lib/validateImage';
import { stripExif } from '../../lib/stripExif';
import UserAvatar from '../../components/UserAvatar';
import AvatarPicker from '../../components/AvatarPicker';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function TrainerProfile() {
  const navigate = useNavigate();
  const { user, profile, signOut, refreshProfile, patchProfile, deleteAccount, gymName } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation(['pages', 'common']);

  // Edit state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState({ full_name: '', username: '' });
  const [savingName, setSavingName] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Personal info state
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({
    phone_number: '',
    specialties: [],
    bio: '',
    years_of_experience: '',
  });
  const [newSpecialty, setNewSpecialty] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

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

  // Sync personal info from profile
  useEffect(() => {
    if (profile) {
      setInfoDraft({
        phone_number: profile.phone_number || '',
        specialties: Array.isArray(profile.specialties) ? profile.specialties : [],
        bio: profile.bio || '',
        years_of_experience: profile.years_of_experience != null ? String(profile.years_of_experience) : '',
      });
    }
  }, [profile?.phone_number, profile?.specialties, profile?.bio, profile?.years_of_experience]);

  // ── Avatar save (from AvatarPicker) ──────────────────────────────────────
  const handleAvatarSave = async ({ type, value, file }) => {
    setUploadingAvatar(true);
    try {
      if (type === 'photo' && file) {
        const validation = await validateImageFile(file);
        if (!validation.valid) {
          showToast(validation.error, 'error');
          setUploadingAvatar(false);
          return;
        }

        // Strip EXIF metadata (GPS, device info) before uploading
        const cleanFile = await stripExif(file);
        const path = `${user.id}/${Date.now()}.jpg`;

        const { error: storageErr } = await supabase.storage
          .from('avatars')
          .upload(path, cleanFile, { upsert: true, contentType: 'image/jpeg' });
        if (storageErr) throw storageErr;

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(path);

        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null })
          .eq('id', user.id);
        if (updateErr) throw updateErr;

        patchProfile({ avatar_url: urlData.publicUrl, avatar_type: 'photo', avatar_value: null });
      } else {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ avatar_type: type, avatar_value: value })
          .eq('id', user.id);
        if (updateErr) throw updateErr;

        patchProfile({ avatar_type: type, avatar_value: value });
      }

      setAvatarPickerOpen(false);
      showToast(t('pages:profile.avatarUpdated', 'Avatar updated'), 'success');
      refreshProfile();
    } catch (err) {
      showToast(t('pages:trainerProfile.avatarUploadError', 'Failed to upload avatar'), 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ── Save personal info ──────────────────────────────────────────────────────
  const startEditingInfo = () => {
    setInfoDraft({
      phone_number: profile?.phone_number || '',
      specialties: Array.isArray(profile?.specialties) ? [...profile.specialties] : [],
      bio: profile?.bio || '',
      years_of_experience: profile?.years_of_experience != null ? String(profile.years_of_experience) : '',
    });
    setNewSpecialty('');
    setEditingInfo(true);
  };

  const addSpecialty = () => {
    const trimmed = newSpecialty.trim();
    if (trimmed && !infoDraft.specialties.includes(trimmed)) {
      setInfoDraft(d => ({ ...d, specialties: [...d.specialties, trimmed] }));
    }
    setNewSpecialty('');
  };

  const removeSpecialty = (idx) => {
    setInfoDraft(d => ({ ...d, specialties: d.specialties.filter((_, i) => i !== idx) }));
  };

  const savePersonalInfo = async () => {
    setSavingInfo(true);
    try {
      const updates = {};
      const phone = infoDraft.phone_number.trim();
      if (phone !== (profile?.phone_number || '')) updates.phone_number = phone || null;
      const specs = infoDraft.specialties.filter(s => s.trim());
      const currentSpecs = Array.isArray(profile?.specialties) ? profile.specialties : [];
      if (JSON.stringify(specs) !== JSON.stringify(currentSpecs)) updates.specialties = specs;
      const bio = infoDraft.bio.trim();
      if (bio !== (profile?.bio || '')) updates.bio = bio || null;
      const yoe = infoDraft.years_of_experience.trim();
      const yoeNum = yoe ? parseInt(yoe, 10) : null;
      if (yoeNum !== (profile?.years_of_experience ?? null)) updates.years_of_experience = yoeNum;

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
        if (error) throw error;
        await refreshProfile();
        showToast(t('pages:trainerProfile.personalInfoSaved', 'Personal info updated'), 'success');
      }
      setEditingInfo(false);
    } catch (err) {
      showToast(err.message || t('pages:trainerProfile.personalInfoSaveError', 'Failed to save personal info'), 'error');
    } finally {
      setSavingInfo(false);
    }
  };

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
    <div className="min-h-screen pb-28 md:pb-12 overflow-x-hidden" style={{ background: 'var(--color-bg-primary)' }}>
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
          <div className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-4 sm:py-5">
            {/* Avatar */}
            <button
              onClick={() => setAvatarPickerOpen(true)}
              disabled={uploadingAvatar}
              className="relative flex-shrink-0 group"
            >
              <UserAvatar user={profile} size={64} />
              <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                {uploadingAvatar ? (
                  <Loader2 size={20} className="text-white animate-spin" />
                ) : (
                  <Camera size={20} className="text-white" />
                )}
              </div>
              {/* Always-visible camera badge */}
              <div
                className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full flex items-center justify-center border-2 shadow-sm"
                style={{ background: 'var(--color-accent)', borderColor: 'var(--color-bg-card)' }}
              >
                {uploadingAvatar ? (
                  <Loader2 size={11} className="text-white animate-spin" />
                ) : (
                  <Camera size={11} className="text-white" />
                )}
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
                    <button onClick={startEditingName} className="flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-lg" style={{ color: 'var(--color-text-muted)' }}>
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
                      className="flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg text-[13px] font-semibold transition-colors"
                      style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                    >
                      {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {t('common:save', 'Save')}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-lg text-[13px] font-semibold transition-colors"
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
            <div className="flex flex-col items-center py-3.5 min-w-0">
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>{clientCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerProfile.clients', 'Clients')}
              </p>
            </div>
            <div className="flex flex-col items-center py-3.5 border-x min-w-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>{sessionCount}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {t('trainerProfile.sessions', 'Sessions')}
              </p>
            </div>
            <div className="flex flex-col items-center py-3.5 min-w-0 overflow-hidden">
              <p className="text-[18px] font-black" style={{ color: 'var(--color-accent)' }}>
                {profile?.email ? <Mail size={18} /> : '—'}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wider truncate w-full text-center px-1.5" style={{ color: 'var(--color-text-muted)' }}>
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
                className="w-full flex items-center justify-between px-4 sm:px-5 py-4 min-h-[48px] text-left transition-colors"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Bell size={16} className="flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[14px] font-semibold truncate">{t('settings.notificationPreferences', 'Notification Preferences')}</span>
                </div>
                <ChevronRight size={16} className="flex-shrink-0 ml-2" style={{ color: 'var(--color-text-subtle)' }} />
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
                    className="w-full flex items-center justify-between px-4 sm:px-5 py-4 min-h-[48px] text-left transition-colors"
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

        {/* ── Personal Info ── */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-subtle)' }}>
              {t('trainerProfile.personalInfo', 'Personal Info')}
            </h3>
            {!editingInfo && (
              <button
                type="button"
                onClick={startEditingInfo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{ color: 'var(--color-accent)' }}
              >
                <Edit2 size={12} />
                {t('common:edit', 'Edit')}
              </button>
            )}
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }}>
            {!editingInfo ? (
              /* ── Read-only view ── */
              <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                {/* Phone */}
                <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                  <Phone size={15} className="flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('trainerProfile.phoneNumber', 'Phone')}
                    </p>
                    <p className="text-[14px] truncate" style={{ color: profile?.phone_number ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                      {profile?.phone_number || t('trainerProfile.notSet', 'Not set')}
                    </p>
                  </div>
                </div>
                {/* Specialties */}
                <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5">
                  <Award size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-subtle)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('trainerProfile.specialties', 'Specialties')}
                    </p>
                    {Array.isArray(profile?.specialties) && profile.specialties.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {profile.specialties.map((s, i) => (
                          <span
                            key={i}
                            className="inline-block px-2.5 py-1 rounded-lg text-[12px] font-medium"
                            style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>
                        {t('trainerProfile.notSet', 'Not set')}
                      </p>
                    )}
                  </div>
                </div>
                {/* Bio */}
                <div className="flex items-start gap-3 px-4 sm:px-5 py-3.5">
                  <FileText size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-subtle)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('trainerProfile.bio', 'Bio')}
                    </p>
                    <p className="text-[14px] whitespace-pre-line" style={{ color: profile?.bio ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                      {profile?.bio || t('trainerProfile.notSet', 'Not set')}
                    </p>
                  </div>
                </div>
                {/* Years of experience */}
                <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                  <Clock size={15} className="flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('trainerProfile.yearsOfExperience', 'Experience')}
                    </p>
                    <p className="text-[14px]" style={{ color: profile?.years_of_experience != null ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                      {profile?.years_of_experience != null
                        ? t('trainerProfile.yearsCount', '{{count}} years', { count: profile.years_of_experience })
                        : t('trainerProfile.notSet', 'Not set')}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Edit mode ── */
              <div className="px-4 sm:px-5 py-4 space-y-4">
                {/* Phone */}
                <div>
                  <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('trainerProfile.phoneNumber', 'Phone')}
                  </label>
                  <input
                    type="tel"
                    value={infoDraft.phone_number}
                    onChange={e => setInfoDraft(d => ({ ...d, phone_number: e.target.value }))}
                    placeholder={t('trainerProfile.phonePlaceholder', '+1 555 123 4567')}
                    className="w-full rounded-lg px-3 py-2.5 text-[14px] border outline-none focus:ring-2"
                    style={{
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  />
                </div>
                {/* Specialties */}
                <div>
                  <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('trainerProfile.specialties', 'Specialties')}
                  </label>
                  {infoDraft.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {infoDraft.specialties.map((s, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium"
                          style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' }}
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() => removeSpecialty(i)}
                            className="ml-0.5 hover:opacity-70"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSpecialty}
                      onChange={e => setNewSpecialty(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpecialty(); } }}
                      placeholder={t('trainerProfile.specialtyPlaceholder', 'e.g. CrossFit L2, Yoga...')}
                      className="flex-1 rounded-lg px-3 py-2.5 text-[14px] border outline-none focus:ring-2"
                      style={{
                        background: 'var(--color-bg-input)',
                        color: 'var(--color-text-primary)',
                        borderColor: 'var(--color-border-subtle)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={addSpecialty}
                      disabled={!newSpecialty.trim()}
                      className="flex items-center justify-center w-10 h-10 rounded-lg border transition-colors disabled:opacity-30"
                      style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-accent)' }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                {/* Bio */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[12px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('trainerProfile.bio', 'Bio')}
                    </label>
                    <span className="text-[11px]" style={{ color: infoDraft.bio.length > 200 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                      {infoDraft.bio.length}/200
                    </span>
                  </div>
                  <textarea
                    value={infoDraft.bio}
                    onChange={e => { if (e.target.value.length <= 200) setInfoDraft(d => ({ ...d, bio: e.target.value })); }}
                    placeholder={t('trainerProfile.bioPlaceholder', 'Tell clients about yourself...')}
                    rows={3}
                    className="w-full rounded-lg px-3 py-2.5 text-[14px] border outline-none focus:ring-2 resize-none"
                    style={{
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  />
                </div>
                {/* Years of experience */}
                <div>
                  <label className="text-[12px] font-semibold mb-1.5 block" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('trainerProfile.yearsOfExperience', 'Experience')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={infoDraft.years_of_experience}
                    onChange={e => setInfoDraft(d => ({ ...d, years_of_experience: e.target.value }))}
                    placeholder={t('trainerProfile.yearsPlaceholder', 'Years')}
                    className="w-32 rounded-lg px-3 py-2.5 text-[14px] border outline-none focus:ring-2"
                    style={{
                      background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)',
                      borderColor: 'var(--color-border-subtle)',
                    }}
                  />
                </div>
                {/* Save / Cancel */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={savePersonalInfo}
                    disabled={savingInfo}
                    className="flex items-center gap-1.5 px-5 py-2.5 min-h-[44px] rounded-xl text-[13px] font-semibold transition-colors"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
                  >
                    {savingInfo ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {savingInfo ? t('common:saving', 'Saving...') : t('common:save', 'Save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingInfo(false)}
                    className="flex items-center gap-1 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-semibold transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    <X size={14} /> {t('common:cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Actions: constrained width on desktop ── */}
        <div className="max-w-md space-y-5">
          {/* ── Sign out ── */}
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 py-4 min-h-[48px] rounded-2xl border transition-colors"
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
                className="w-full flex items-center justify-center gap-2 py-4 min-h-[48px] rounded-2xl border transition-colors hover:bg-red-500/5"
                style={{ borderColor: 'rgba(217, 72, 72, 0.3)', color: '#EF4444' }}
              >
                <Trash2 size={16} />
                <span className="text-[14px] font-semibold">{t('settings.deleteAccount', 'Delete Account')}</span>
              </button>
            ) : (
              <div className="rounded-2xl border p-3.5 sm:p-5" style={{ background: 'var(--color-bg-card)', borderColor: 'rgba(217, 72, 72, 0.3)' }}>
                <div className="flex items-start gap-2.5 sm:gap-3 mb-4">
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
                    className="flex-1 flex items-center justify-center gap-2 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] transition-all disabled:opacity-30"
                    style={{ background: '#EF4444', color: 'white' }}
                  >
                    {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    {deleting ? t('common:deleting', 'Deleting...') : t('settings.confirmDelete', 'Delete My Account')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                    className="px-5 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] transition-colors"
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
      <AvatarPicker
        isOpen={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        currentAvatar={{ type: profile?.avatar_type || 'color', value: profile?.avatar_value || '#6366F1' }}
        user={profile}
        onSave={handleAvatarSave}
        uploading={uploadingAvatar}
      />
    </div>
  );
}
