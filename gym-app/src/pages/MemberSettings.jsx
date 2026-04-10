import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Settings, Heart, ChevronRight, Trash2, AlertTriangle, Bell, Shield, FileText, Globe, Check, Eye, EyeOff, Download, Loader2, Trophy, Ban, UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation, Trans } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { exportWorkoutHistory, exportPersonalRecords, exportBodyMetrics } from '../lib/exportData';
import { usePostHog } from '@posthog/react';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function MemberSettings() {
  const navigate = useNavigate();
  const { deleteAccount, user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const posthog = usePostHog();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(profile?.leaderboard_visible ?? true);
  const { showToast } = useToast();
  const [exporting, setExporting] = useState({ workouts: false, prs: false, body: false });
  const [blockedList, setBlockedList] = useState([]);
  const [loadingBlocked, setLoadingBlocked] = useState(true);
  const [unblocking, setUnblocking] = useState(null);

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

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl border-b border-white/[0.06]" style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <h1 className="text-[22px] font-bold truncate">{t('settings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto space-y-4">
        {/* General */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.general')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {[
              { label: t('settings.notificationPreferences'), icon: Bell, to: '/notification-settings' },
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

        {/* Integrations */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: 'var(--color-text-subtle)' }}>{t('settings.integrations')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/health-sync')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Heart size={16} className="text-[#D4AF37]" />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.healthIntegration')}</span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </button>
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
                setLeaderboardVisible(newVal);
                if (user?.id) {
                  await supabase.from('profiles').update({ leaderboard_visible: newVal }).eq('id', user.id);
                }
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
                          <img src={block.profiles.avatar_url} alt={block.profiles?.full_name ? `${block.profiles.full_name} avatar` : 'User avatar'} className="w-8 h-8 rounded-full object-cover" />
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
            <a
              href="https://tugympr.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Shield size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.privacyPolicy')}</span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </a>
            <a
              href="https://tugympr.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <FileText size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.termsOfService')}</span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </a>
          </div>
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
    </div>
  );
}
