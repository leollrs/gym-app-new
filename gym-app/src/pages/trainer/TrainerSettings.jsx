import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronRight, Bell, Lock, HelpCircle, LogOut,
  Globe, Trash2, AlertTriangle, Loader2, Check, X, Repeat,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';
import i18n from 'i18next';
import ViewSwitcherModal from '../../components/ViewSwitcherModal';
import { TT, TFont } from './components/designTokens';
import { TCard, TEyebrow, TPageTitle, TIconButton } from './components/designPrimitives';
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

export default function TrainerSettings() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { profile, signOut, deleteAccount, availableRoles } = useAuth();
  const { showToast } = useToast();

  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
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
    </div>
  );
}
