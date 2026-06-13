import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronRight, Bell, Lock, HelpCircle, LogOut,
  Globe, Trash2, AlertTriangle, Loader2, Check, X, Repeat, KeyRound,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import i18n from 'i18next';
import ViewSwitcherModal from '../../components/ViewSwitcherModal';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TIconButton, TPrimaryButton } from './components/designPrimitives';
import TrainerAutomations from './components/TrainerAutomations';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

// eslint-disable-next-line no-unused-vars
function SettingsRow({ Icon, label, sub, onClick, danger, isFirst }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '12px 14px',
        background: 'transparent', textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        minHeight: 56, border: 'none',
        borderTop: isFirst ? 'none' : `1px solid ${TT.border}`,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
        background: danger ? TT.hotSoft : TT.surface2,
        color: danger ? TT.hot : TT.textSub,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: danger ? TT.hot : TT.text }}>
          {label}
        </div>
        {sub && <div style={{ fontSize: 10.5, color: TT.textSub, marginTop: 1 }}>{sub}</div>}
      </div>
      {onClick && <ChevronRight size={14} style={{ color: TT.textMute, flexShrink: 0 }} />}
    </button>
  );
}

// ── Change password modal ──
// Trainers previously had NO way to change their password from inside the
// app (member side has one). Routes through supabase.auth.updateUser.
function ChangePasswordModal({ open, onClose }) {
  const { t } = useTranslation(['pages', 'common']);
  const { showToast } = useToast();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const tooShort = pw1.length > 0 && pw1.length < 8;
  const mismatch = pw2.length > 0 && pw1 !== pw2;
  const valid = pw1.length >= 8 && pw1 === pw2;

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    fontSize: 13.5, border: `1px solid ${TT.borderSolid}`,
    background: TT.surface, color: TT.text, outline: 'none',
    fontFamily: 'inherit',
  };
  const labelStyle = {
    fontSize: 11.5, fontWeight: 800, color: TT.textSub,
    letterSpacing: 0.4, textTransform: 'uppercase',
    marginBottom: 6, display: 'block',
  };

  const close = () => {
    setPw1(''); setPw2('');
    onClose();
  };

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setSaving(false);
    if (error) {
      logger.error('TrainerSettings password change failed', error);
      showToast(
        error.message || t('pages:trainerSettings.passwordUpdateFailed', "Couldn't update password"),
        'error',
      );
      return;
    }
    showToast(t('pages:trainerSettings.passwordUpdated', 'Password updated'), 'success');
    close();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 420,
          boxShadow: TT.shadowLg, overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${TT.border}`,
        }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
            color: TT.text, letterSpacing: -0.3,
          }}>
            {t('pages:trainerSettings.changePassword', 'Change password')}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('common:close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999,
              border: 'none', background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>{t('pages:trainerSettings.newPassword', 'New password')}</label>
            <input
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoComplete="new-password"
              maxLength={72}
              style={inputStyle}
            />
            <div style={{ fontSize: 10.5, color: tooShort ? TT.hot : TT.textSub, marginTop: 4 }}>
              {t('pages:trainerSettings.passwordMin', 'At least 8 characters.')}
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('pages:trainerSettings.confirmPassword', 'Confirm new password')}</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoComplete="new-password"
              maxLength={72}
              style={inputStyle}
            />
            {mismatch && (
              <div style={{ fontSize: 10.5, color: TT.hot, marginTop: 4 }}>
                {t('pages:trainerSettings.passwordMismatch', "Passwords don't match.")}
              </div>
            )}
          </div>
        </div>
        <div style={{
          padding: '12px 16px', borderTop: `1px solid ${TT.border}`,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={close}
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'transparent', color: TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common:cancel', 'Cancel')}
          </button>
          <TPrimaryButton onClick={submit} disabled={!valid || saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={2.4} />}
            {saving ? t('common:saving', 'Saving...') : t('common:save', 'Save')}
          </TPrimaryButton>
        </div>
      </div>
    </div>
  );
}

export default function TrainerSettings() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { profile, signOut, deleteAccount, availableRoles } = useAuth();
  const { showToast } = useToast();

  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;

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
      logger.error('TrainerSettings deleteAccount failed', err);
      showToast(t('pages:settings.failedToDelete', 'Failed to delete account'), 'error');
      setDeleting(false);
    }
  };

  const handleLanguageChange = async (code) => {
    i18n.changeLanguage(code);
    setShowLanguagePicker(false);
    if (profile?.id) {
      const { error } = await supabase.from('profiles').update({ preferred_language: code }).eq('id', profile.id);
      if (error) showToast?.(t('common:somethingWentWrong', 'Something went wrong'), 'error');
    }
  };

  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      {/* Header */}
      <div className="max-w-3xl mx-auto" style={{ padding: '12px 16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <TIconButton
          ariaLabel={t('common:back', 'Back')}
          onClick={() => navigate(-1)}
          size={36}
        >
          <ChevronLeft size={18} style={{ color: TT.text }} />
        </TIconButton>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TEyebrow>{t('pages:trainerSettings.eyebrow', 'Account')}</TEyebrow>
          <TPageTitle style={{ fontSize: 24 }}>
            {t('pages:trainerSettings.title', 'Settings')}
          </TPageTitle>
        </div>
      </div>

      {/* Switch view (only when user has multiple roles) */}
      {hasMultipleViews && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{
            fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
            color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
          }}>
            {t('common:viewSwitcher.eyebrow', 'Switch view')}
          </div>
          <TCard padded={0}>
            <SettingsRow
              isFirst
              Icon={Repeat}
              label={t('common:viewSwitcher.title', 'Choose your experience')}
              sub={t('common:viewSwitcher.help', 'Your data and identity stay the same — only the layout changes.')}
              onClick={() => setShowViewSwitcher(true)}
            />
          </TCard>
        </div>
      )}

      {/* Notifications + Privacy + Help */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerSettings.preferences', 'Preferences')}
        </div>
        <TCard padded={0}>
          <SettingsRow
            isFirst
            Icon={Bell}
            label={t('pages:trainerProfile.account.notifications', 'Notifications')}
            sub={t('pages:trainerSettings.notificationsSub', 'Push, email, and reminders')}
            onClick={() => navigate('/trainer/notification-settings')}
          />
          <SettingsRow
            Icon={Lock}
            label={t('pages:trainerProfile.account.privacy', 'Privacy')}
            sub={t('pages:trainerSettings.privacySub', 'Profile visibility and data')}
            onClick={() => navigate('/trainer/privacy')}
          />
          <SettingsRow
            Icon={KeyRound}
            label={t('pages:trainerSettings.changePassword', 'Change password')}
            sub={t('pages:trainerSettings.changePasswordSub', 'Update your sign-in password')}
            onClick={() => setShowPasswordModal(true)}
          />
          <SettingsRow
            Icon={Globe}
            label={t('pages:trainerSettings.language', 'Language')}
            sub={`${currentLang.flag} ${currentLang.label}`}
            onClick={() => setShowLanguagePicker(s => !s)}
          />
          <SettingsRow
            Icon={HelpCircle}
            label={t('pages:trainerProfile.account.help', 'Help & support')}
            sub={t('pages:trainerSettings.helpSub', 'Docs, FAQs, contact support')}
            onClick={() => navigate('/trainer/help')}
          />
        </TCard>
      </div>

      {/* Inline language picker */}
      {showLanguagePicker && (
        <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
              color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>
              {t('pages:trainerSettings.chooseLanguage', 'Choose language')}
            </div>
            <TIconButton
              ariaLabel={t('common:close', 'Close')}
              onClick={() => setShowLanguagePicker(false)}
              size={32}
            >
              <X size={14} />
            </TIconButton>
          </div>
          <TCard padded={0}>
            {LANGUAGES.map((lang, i) => {
              const active = i18n.language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleLanguageChange(lang.code)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px', minHeight: 56,
                    background: 'transparent', textAlign: 'left',
                    border: 'none',
                    borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 18 }}>{lang.flag}</div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: TT.text }}>{lang.label}</div>
                  {active && <Check size={16} style={{ color: TT.accent }} />}
                </button>
              );
            })}
          </TCard>
        </div>
      )}

      {/* Automations (#7) — retention/progress autoflows */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <TrainerAutomations />
      </div>

      {/* Sign out */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 14px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.textSub, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerSettings.session', 'Session')}
        </div>
        <TCard padded={0}>
          <SettingsRow
            isFirst
            Icon={LogOut}
            label={t('pages:trainerProfile.account.signOut', 'Sign out')}
            sub={t('pages:trainerSettings.signOutSub', 'You can come back anytime')}
            onClick={handleSignOut}
          />
        </TCard>
      </div>

      {/* Danger zone */}
      <div className="max-w-3xl mx-auto" style={{ padding: '0 16px 24px' }}>
        <div style={{
          fontFamily: TFont.display, fontSize: 13, fontWeight: 800,
          color: TT.hot, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {t('pages:trainerProfile.settings.dangerZone', 'Danger zone')}
        </div>
        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              width: '100%', padding: '14px', borderRadius: 14,
              background: TT.surface, border: `1px solid ${TT.hotSoft}`,
              color: TT.hot, fontSize: 13, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer', minHeight: 48,
            }}
          >
            <Trash2 size={15} strokeWidth={2.2} />
            {t('pages:trainerProfile.settings.deleteAccount', 'Delete account')}
          </button>
        ) : (
          <TCard padded={16} style={{ borderColor: TT.hot }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ color: TT.hot, flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: TT.text }}>
                  {t('pages:trainerProfile.settings.deleteAccount', 'Delete account')}
                </div>
                <div style={{ fontSize: 12.5, color: TT.textSub, lineHeight: 1.5, marginTop: 4 }}>
                  {t('pages:settings.deleteWarning', 'This action is permanent and cannot be undone. All your data, including client assignments and session history, will be permanently deleted.')}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TT.textSub, marginBottom: 4 }}>
              {t('pages:trainerProfile.typeDeleteToConfirm', 'Type DELETE to confirm:')}
            </div>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value.toUpperCase())}
              placeholder="DELETE"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                fontFamily: TFont.mono, fontSize: 13.5,
                border: `1px solid ${deleteInput === 'DELETE' ? TT.hot : TT.borderSolid}`,
                background: TT.surface, color: TT.text, outline: 'none',
                marginBottom: 10,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || deleting}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12,
                  background: TT.hot, color: '#fff',
                  border: 'none', fontSize: 13, fontWeight: 800,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  cursor: deleteInput === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                  opacity: deleteInput === 'DELETE' && !deleting ? 1 : 0.4,
                  minHeight: 44,
                }}
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting
                  ? t('common:deleting', 'Deleting...')
                  : t('pages:settings.confirmDelete', 'Delete My Account')}
              </button>
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12,
                  background: TT.surface2, color: TT.textSub,
                  border: 'none', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', minHeight: 44,
                }}
              >
                {t('common:cancel', 'Cancel')}
              </button>
            </div>
          </TCard>
        )}
      </div>

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
      <ChangePasswordModal open={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </div>
  );
}
