import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Settings, Heart, ChevronRight, Trash2, AlertTriangle, Bell, Shield, FileText, Globe, Check, Eye, EyeOff, Download, Loader2, Trophy, Ban, UserX, User, Repeat, HelpCircle, Sparkles, Camera as CameraIcon, MapPin,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ViewSwitcherModal from '../components/ViewSwitcherModal';
import { useTranslation, Trans } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { exportWorkoutHistory, exportPersonalRecords, exportBodyMetrics } from '../lib/exportData';
import { usePostHog } from '@posthog/react';
import { format as formatDate } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { getConsentStatus, revokeAIConsent, recordAIConsent } from '../lib/aiConsent';
import AIConsentDialog from '../components/AIConsentDialog';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { checkPermission, ensurePermission } from '../lib/devicePermissions';
import PermissionExplainerModal from '../components/PermissionExplainerModal';

// Inline row used in the Permissions section. Shows current status and
// triggers the explain → request → fallback-to-settings flow.
const PermissionRow = ({ icon: Icon, label, status, onClick }) => {
  const { t } = useTranslation('pages');
  const statusLabel = status === 'granted' ? t('settings.permGranted', 'Allowed')
    : status === 'denied' ? t('settings.permDenied', 'Denied')
    : status === 'unsupported' ? t('settings.permUnsupported', 'N/A')
    : t('settings.permPrompt', 'Tap to allow');
  const statusColor = status === 'granted' ? '#10B981'
    : status === 'denied' ? '#F97316'
    : 'var(--color-text-subtle)';
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && <Icon size={16} style={{ color: 'var(--color-text-subtle)' }} />}
        <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: statusColor, letterSpacing: 0.4 }}>
          {statusLabel}
        </span>
        <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
      </div>
    </button>
  );
};

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function MemberSettings() {
  const navigate = useNavigate();
  const { deleteAccount, user, profile, availableRoles, refreshProfile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);
  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;
  const [leaderboardVisible, setLeaderboardVisible] = useState(profile?.leaderboard_visible ?? true);
  const { showToast } = useToast();
  const [exporting, setExporting] = useState({ workouts: false, prs: false, body: false });
  const [blockedList, setBlockedList] = useState([]);
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [unblocking, setUnblocking] = useState(null);

  // ── AI Photo Analysis consent (GDPR Art. 7(3) revocation) ──
  // Local mirror of consent state. We re-read from localStorage on mount and
  // after each toggle so the row reflects the latest state without a full
  // page refresh.
  const [aiConsentState, setAiConsentState] = useState(() => getConsentStatus());
  const [aiConsentBusy, setAiConsentBusy] = useState(null); // 'body-analysis'|'food-analysis'|'menu-analysis'|null
  const [aiConsentDialogFeature, setAiConsentDialogFeature] = useState(null);

  const handleRevokeAIConsent = useCallback(async (feature) => {
    setAiConsentBusy(feature);
    try {
      await revokeAIConsent(feature);
      setAiConsentState(getConsentStatus());
      posthog?.capture('ai_consent_revoked', { feature });
      showToast(t('settingsPrivacy.consentNotGranted'), 'success');
    } catch (err) {
      showToast(err?.message || t('settingsPrivacy.failedToRevoke', 'Failed to revoke consent'), 'error');
    } finally {
      setAiConsentBusy(null);
    }
  }, [posthog, showToast, t]);

  const handleGrantAIConsent = useCallback(async () => {
    const feature = aiConsentDialogFeature;
    if (!feature) return;
    setAiConsentBusy(feature);
    setAiConsentDialogFeature(null);
    try {
      await recordAIConsent(feature);
      setAiConsentState(getConsentStatus());
      posthog?.capture('ai_consent_granted', { feature, source: 'settings' });
      showToast(t('settingsPrivacy.consentGranted', 'Consent granted'), 'success');
    } catch (err) {
      showToast(err?.message || t('settingsPrivacy.failedToGrant', 'Failed to grant consent'), 'error');
    } finally {
      setAiConsentBusy(null);
    }
  }, [aiConsentDialogFeature, posthog, showToast, t]);

  const formatConsentDate = useCallback((ts) => {
    if (!ts) return '';
    const localeObj = i18n.language?.startsWith('es') ? esLocale : undefined;
    try {
      return formatDate(new Date(ts), 'PP', { locale: localeObj });
    } catch {
      return '';
    }
  }, [i18n.language]);

  useEffect(() => {
    document.title = t('settings.title');
  }, [t]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('blocked_users')
      .select('id, blocked_id, created_at, profiles:blocked_id(full_name, avatar_url)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBlockedList(data ?? []);
        setLoadingBlocked(false);
      });
  }, [user?.id]);

  const handleUnblock = useCallback(async (blockId, blockedId) => {
    setUnblocking(blockedId);
    await supabase.from('blocked_users').delete().eq('id', blockId);
    setBlockedList(prev => prev.filter(b => b.id !== blockId));
    showToast(t('social.unblockUser'), 'success');
    setUnblocking(null);
  }, [showToast, t]);

  // ── Device permissions (notifications, camera, location, health) ──
  const [permStatuses, setPermStatuses] = useState({
    notifications: 'prompt', camera: 'prompt', location: 'prompt', health: 'prompt',
  });
  const [permExplainerType, setPermExplainerType] = useState(null);
  const explainerResolverRef = useRef(null);

  const refreshPermissions = useCallback(async () => {
    const types = ['notifications', 'camera', 'location', 'health'];
    try {
      const results = await Promise.all(types.map((tp) => checkPermission(tp).catch(() => 'prompt')));
      setPermStatuses(types.reduce((acc, tp, i) => ({ ...acc, [tp]: results[i] }), {}));
    } catch (err) {
      console.warn('[Settings] refreshPermissions failed', err);
    }
  }, []);

  useEffect(() => {
    refreshPermissions();
    let handle = null;
    let cancelled = false;
    Promise.resolve()
      .then(() => CapApp.addListener?.('appStateChange', ({ isActive }) => { if (isActive) refreshPermissions(); }))
      .then((sub) => { if (cancelled) sub?.remove?.(); else handle = sub; })
      .catch(() => {});
    return () => { cancelled = true; try { handle?.remove?.(); } catch {} };
  }, [refreshPermissions]);

  const openExplainer = useCallback((type) => new Promise((resolve) => {
    explainerResolverRef.current = resolve;
    setPermExplainerType(type);
  }), []);

  const handleExplainerAgree = useCallback(() => {
    const resolve = explainerResolverRef.current;
    explainerResolverRef.current = null;
    setPermExplainerType(null);
    resolve?.(true);
  }, []);

  const handleExplainerCancel = useCallback(() => {
    const resolve = explainerResolverRef.current;
    explainerResolverRef.current = null;
    setPermExplainerType(null);
    resolve?.(false);
  }, []);

  const handlePermissionTap = useCallback(async (type) => {
    let result = null;
    try {
      result = await ensurePermission(type, ({ type: tp }) => openExplainer(tp));
    } catch (err) {
      console.warn('[Settings] permission tap failed', type, err);
    }
    // HealthKit: once iOS has a stored "denied", it never re-shows the picker.
    // Deep-link to iOS Settings so the user can flip it back on. We can't
    // jump directly to Privacy → Health, but app-settings: is the next-best.
    if (type === 'health' && result === 'denied') {
      showToast(t('settings.healthOpenSettings', 'Enable in iOS Settings → Privacy & Security → Health → TuGymPR'), 'info');
      try { await CapApp.openUrl({ url: 'app-settings:' }); } catch {}
    }
    refreshPermissions();
  }, [openExplainer, refreshPermissions, showToast, t]);

  // Deep-link into the OS settings app for the current app. We can't grant
  // permissions from JS once a user has denied them — only iOS/Android
  // settings can. On web this is a no-op with toast.
  const openAppSettings = useCallback(async () => {
    try {
      const platform = Capacitor.getPlatform();
      if (platform === 'ios') {
        await CapApp.openUrl({ url: 'app-settings:' });
      } else if (platform === 'android') {
        // Best-effort: open the app's settings page via package: scheme.
        await CapApp.openUrl({ url: 'package:com.tugympr.app' });
      } else {
        showToast(t('settings.openSettingsFailed'), 'error');
      }
    } catch (err) {
      console.error('[Settings] openAppSettings failed:', err);
      showToast(t('settings.openSettingsFailed'), 'error');
    }
  }, [showToast, t]);

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl border-b border-white/[0.06]" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('settings.goBack', 'Go back')}
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <h1 className="text-[22px] font-bold truncate">{t('settings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto space-y-4">
        {/* Switch view (only when user has multiple roles) */}
        {hasMultipleViews && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
              {t('common:viewSwitcher.eyebrow', 'Switch view')}
            </h3>
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowViewSwitcher(true)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Repeat size={16} style={{ color: 'var(--color-accent)' }} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('common:viewSwitcher.title', 'Choose your experience')}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('common:viewSwitcher.help', 'Your data and identity stay the same — only the layout changes.')}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            </div>
          </div>
        )}

        {/* General */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.general')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {[
              { label: t('settings.personalInfo', 'Personal info'), icon: User, to: '/personal-info' },
              { label: t('settings.notificationPreferences'), icon: Bell, to: '/notification-settings' },
              { label: t('settings.helpAndSupport', 'Help & Support'), icon: HelpCircle, to: '/support' },
            ].map(item => (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
              >
                <div className="flex items-center gap-3">
                  <item.icon size={16} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{item.label}</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.language')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                type="button"
                onClick={async () => {
                  i18n.changeLanguage(lang.code);
                  posthog?.capture('language_changed', { new_language: lang.code });
                  if (user?.id) {
                    await supabase.from('profiles').update({ preferred_language: lang.code }).eq('id', user.id);
                  }
                }}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">{lang.flag}</span>
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{lang.label}</span>
                </div>
                {i18n.language?.startsWith(lang.code) && (
                  <Check size={16} className="text-[#D4AF37]" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Privacy */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settingsPrivacy.privacy')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <button
              type="button"
              aria-pressed={leaderboardVisible}
              onClick={async () => {
                const newVal = !leaderboardVisible;
                const prev = leaderboardVisible;
                setLeaderboardVisible(newVal);
                if (!user?.id) return;
                const { error } = await supabase
                  .from('profiles')
                  .update({ leaderboard_visible: newVal })
                  .eq('id', user.id);
                if (error) {
                  console.error('[Settings] leaderboard_visible update failed:', error);
                  setLeaderboardVisible(prev); // revert optimistic toggle
                  showToast(t('settingsPrivacy.toggleFailed', { defaultValue: 'Could not save. Try again.' }), 'error');
                  return;
                }
                // Refresh the profile context so other pages pick up the new value.
                try { await refreshProfile?.(); } catch { /* noop */ }
                showToast(t('settingsPrivacy.saved', { defaultValue: 'Saved' }), 'success');
              }}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                {leaderboardVisible ? <Eye size={16} style={{ color: 'var(--color-text-subtle)' }} /> : <EyeOff size={16} style={{ color: 'var(--color-text-subtle)' }} />}
                <div>
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settingsPrivacy.showOnLeaderboards')}</span>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('settingsPrivacy.showOnLeaderboardsDesc')}</p>
                </div>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative ${leaderboardVisible ? 'bg-[#10B981]' : 'bg-[#374151]'}`}>
                <div className={`w-4.5 h-4.5 rounded-full bg-white absolute top-[3px] transition-transform ${leaderboardVisible ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
              </div>
            </button>
          </div>
        </div>

        {/* AI Photo Analysis (consent management — GDPR Art. 7(3)) */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('settingsPrivacy.aiPhotoAnalysis')}
          </h3>
          <p className="text-[12px] mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('settingsPrivacy.aiPhotoAnalysisDesc')}
          </p>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {[
              { feature: 'body-analysis', field: 'body', label: t('settingsPrivacy.bodyPhotos') },
              { feature: 'food-analysis', field: 'food', label: t('settingsPrivacy.foodPhotos') },
              { feature: 'menu-analysis', field: 'menu', label: t('settingsPrivacy.menuPhotos') },
            ].map(({ feature, field, label }) => {
              const status = aiConsentState[field] || { consented: false, timestamp: null };
              const busy = aiConsentBusy === feature;
              const onLabel = status.timestamp
                ? t('settingsPrivacy.consentGrantedOn', { date: formatConsentDate(status.timestamp) })
                : t('settingsPrivacy.consentNotGranted');
              return (
                <button
                  key={feature}
                  type="button"
                  aria-pressed={status.consented}
                  disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    if (status.consented) handleRevokeAIConsent(feature);
                    else setAiConsentDialogFeature(feature);
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Sparkles size={16} style={{ color: 'var(--color-text-subtle)' }} />
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{label}</div>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                        {status.consented ? onLabel : t('settingsPrivacy.consentNotGranted')}
                      </p>
                    </div>
                  </div>
                  {busy ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
                  ) : (
                    <div className={`w-10 h-6 rounded-full transition-colors relative ${status.consented ? 'bg-[#10B981]' : 'bg-[#374151]'}`}>
                      <div className={`w-4.5 h-4.5 rounded-full bg-white absolute top-[3px] transition-transform ${status.consented ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('settingsPrivacy.aiToggleHint')}
          </p>
        </div>

        {/* Blocked Users */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('social.blockedUsers')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            {loadingBlocked ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={18} className="text-[#D4AF37] animate-spin" />
              </div>
            ) : blockedList.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-4">
                <Ban size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>{t('social.noBlockedUsers')}</span>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {blockedList.map(block => (
                  <div key={block.id} className="flex items-center justify-between px-5 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center flex-shrink-0">
                        {block.profiles?.avatar_url ? (
                          <img src={block.profiles.avatar_url} alt={block.profiles?.full_name ? t('profile.userAvatarName', { name: block.profiles.full_name, defaultValue: '{{name}} avatar' }) : t('profile.userAvatar', 'User avatar')} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <UserX size={14} style={{ color: 'var(--color-text-subtle)' }} />
                        )}
                      </div>
                      <span className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {block.profiles?.full_name ?? t('social.unknownUser')}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={unblocking === block.blocked_id}
                      onClick={() => handleUnblock(block.id, block.blocked_id)}
                      aria-label={t('social.unblockUser')}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-white/[0.1] hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {unblocking === block.blocked_id ? <Loader2 size={12} className="animate-spin" /> : t('social.unblockUser')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Export My Data */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.exportMyData')}</h3>
          <p className="text-[12px] mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.exportDescription')}</p>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {[
              { key: 'workouts', label: t('settings.exportWorkoutHistory'), icon: FileText, fn: exportWorkoutHistory },
              { key: 'prs', label: t('settings.exportPersonalRecords'), icon: Trophy, fn: exportPersonalRecords },
              { key: 'body', label: t('settings.exportBodyMetrics'), icon: Download, fn: exportBodyMetrics },
            ].map(item => (
              <button
                key={item.key}
                type="button"
                disabled={exporting[item.key]}
                onClick={async () => {
                  setExporting(prev => ({ ...prev, [item.key]: true }));
                  try {
                    await item.fn(user.id);
                    posthog?.capture('data_exported', { export_type: item.key });
                    showToast(t('settings.exportSuccess'), 'success');
                  } catch (err) {
                    showToast(t('settings.exportError'), 'error');
                  } finally {
                    setExporting(prev => ({ ...prev, [item.key]: false }));
                  }
                }}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200 disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <item.icon size={16} className="text-[#D4AF37]" />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{item.label}</span>
                </div>
                {exporting[item.key]
                  ? <Loader2 size={16} className="text-[#D4AF37] animate-spin" />
                  : <Download size={16} style={{ color: 'var(--color-text-subtle)' }} />
                }
              </button>
            ))}
          </div>
        </div>

        {/* Legal */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.legal')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            <button
              type="button"
              onClick={() => navigate('/legal/privacy')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Shield size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.privacyPolicy')}</span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/legal/terms')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <FileText size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.termsOfService')}</span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </button>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <Shield size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                <div>
                  <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                    {t('settingsPrivacy.ccpaTitle')}
                  </p>
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('settingsPrivacy.ccpaBody')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Permissions */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('settings.permissions')}
          </h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            <PermissionRow
              icon={Bell}
              label={t('settings.permNotifications')}
              status={permStatuses.notifications}
              onClick={() => handlePermissionTap('notifications')}
            />
            <PermissionRow
              icon={Heart}
              label={t('settings.permHealth')}
              status={permStatuses.health}
              onClick={() => handlePermissionTap('health')}
            />
            <PermissionRow
              icon={CameraIcon}
              label={t('settings.permCamera')}
              status={permStatuses.camera}
              onClick={() => handlePermissionTap('camera')}
            />
            <PermissionRow
              icon={MapPin}
              label={t('settings.permLocation')}
              status={permStatuses.location}
              onClick={() => handlePermissionTap('location')}
            />
          </div>
          <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--color-text-subtle)' }}>
            {t('settings.permissionsHint')}
          </p>
        </div>

        {/* Danger zone */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.dangerZone')}</h3>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-500/20 text-red-400 text-[14px] font-semibold hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={15} /> {t('settings.deleteAccount')}
          </button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl bg-black/60 px-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-[400px] rounded-2xl p-6 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 id="delete-account-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.deleteAccount')}</h3>
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('settings.thisCannotBeUndone')}</p>
              </div>
            </div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
              <Trans i18nKey="settings.deleteConfirmMessage" ns="pages" components={{ 1: <strong /> }} />
            </p>
            <input
              type="text"
              value={deleteText}
              onChange={e => setDeleteText(e.target.value)}
              placeholder={t('settings.typeDelete')}
              aria-label={t('settings.typeDelete')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              id="delete-confirm-input"
              className="w-full px-4 py-3 rounded-xl text-[14px] mb-4 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); }}
                className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' }}
              >
                {t('settings.cancel')}
              </button>
              {(() => {
                const canDelete = ['delete', 'eliminar'].includes(deleteText.trim().toLowerCase());
                return (
                  <button
                    type="button"
                    disabled={!canDelete || deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await deleteAccount();
                      } catch (err) {
                        setDeleting(false);
                        alert(err.message || t('settings.failedToDelete'));
                      }
                    }}
                    className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold transition-all"
                    style={{
                      backgroundColor: canDelete ? 'var(--color-danger)' : 'var(--color-bg-secondary)',
                      color: canDelete ? '#FFFFFF' : 'var(--color-text-subtle)',
                      border: canDelete ? '1px solid var(--color-danger)' : '1px solid var(--color-border-default)',
                      opacity: deleting ? 0.6 : 1,
                    }}
                  >
                    {deleting ? t('settings.deleting') : t('settings.deleteForever')}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
      <AIConsentDialog
        open={!!aiConsentDialogFeature}
        featureName={aiConsentDialogFeature || 'body-analysis'}
        onAgree={handleGrantAIConsent}
        onCancel={() => setAiConsentDialogFeature(null)}
      />
      <PermissionExplainerModal
        open={!!permExplainerType}
        type={permExplainerType}
        onAgree={handleExplainerAgree}
        onCancel={handleExplainerCancel}
      />
    </div>
  );
}
