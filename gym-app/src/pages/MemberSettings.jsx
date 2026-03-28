import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Settings, Heart, ChevronRight, Trash2, AlertTriangle, Bell, Shield, FileText, Globe, Check, Eye, EyeOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

export default function MemberSettings() {
  const navigate = useNavigate();
  const { deleteAccount, user, profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(profile?.leaderboard_visible ?? true);

  return (
    <div className="min-h-screen bg-[#05070B] text-[#E5E7EB] pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#05070B]/90 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06]"
          >
            <ArrowLeft size={18} className="text-[#9CA3AF]" />
          </button>
          <h1 className="text-[28px] font-bold">{t('settings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-[680px] md:max-w-4xl mx-auto space-y-4">
        {/* General */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.general')}</h3>
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
                  <item.icon size={16} className="text-[#6B7280]" />
                  <span className="text-[14px] font-semibold text-[#E5E7EB]">{item.label}</span>
                </div>
                <ChevronRight size={16} className="text-[#6B7280]" />
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.language')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                type="button"
                onClick={async () => {
                  i18n.changeLanguage(lang.code);
                  if (user?.id) {
                    await supabase.from('profiles').update({ preferred_language: lang.code }).eq('id', user.id);
                  }
                }}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[18px]">{lang.flag}</span>
                  <span className="text-[14px] font-semibold text-[#E5E7EB]">{lang.label}</span>
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
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.integrations')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/health-sync')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Heart size={16} className="text-[#D4AF37]" />
                <span className="text-[14px] font-semibold text-[#E5E7EB]">{t('settings.healthIntegration')}</span>
              </div>
              <ChevronRight size={16} className="text-[#6B7280]" />
            </button>
          </div>
        </div>

        {/* Privacy */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settingsPrivacy.privacy')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <button
              type="button"
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
                {leaderboardVisible ? <Eye size={16} className="text-[#6B7280]" /> : <EyeOff size={16} className="text-[#6B7280]" />}
                <div>
                  <span className="text-[14px] font-semibold text-[#E5E7EB]">{t('settingsPrivacy.showOnLeaderboards')}</span>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{t('settingsPrivacy.showOnLeaderboardsDesc')}</p>
                </div>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative ${leaderboardVisible ? 'bg-[#10B981]' : 'bg-[#374151]'}`}>
                <div className={`w-4.5 h-4.5 rounded-full bg-white absolute top-[3px] transition-transform ${leaderboardVisible ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
              </div>
            </button>
          </div>
        </div>

        {/* Legal */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.legal')}</h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            <a
              href="https://tugympr.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Shield size={16} className="text-[#6B7280]" />
                <span className="text-[14px] font-semibold text-[#E5E7EB]">{t('settings.privacyPolicy')}</span>
              </div>
              <ChevronRight size={16} className="text-[#6B7280]" />
            </a>
            <a
              href="https://tugympr.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <FileText size={16} className="text-[#6B7280]" />
                <span className="text-[14px] font-semibold text-[#E5E7EB]">{t('settings.termsOfService')}</span>
              </div>
              <ChevronRight size={16} className="text-[#6B7280]" />
            </a>
          </div>
        </div>

        {/* Danger zone */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.dangerZone')}</h3>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl bg-black/60 px-4">
          <div className="w-full max-w-[400px] rounded-2xl p-6 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('settings.deleteAccount')}</h3>
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('settings.thisCannotBeUndone')}</p>
              </div>
            </div>
            <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }} dangerouslySetInnerHTML={{ __html: t('settings.deleteConfirmMessage') }} />
            <input
              type="text"
              value={deleteText}
              onChange={e => setDeleteText(e.target.value)}
              placeholder={t('settings.typeDelete')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              className="w-full px-4 py-3 rounded-xl text-[14px] mb-4 focus:outline-none"
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
                        alert(err.message || 'Failed to delete account');
                      }
                    }}
                    className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold transition-all"
                    style={{
                      backgroundColor: canDelete ? '#DC2626' : 'var(--color-bg-secondary)',
                      color: canDelete ? '#FFFFFF' : 'var(--color-text-subtle)',
                      border: canDelete ? '1px solid #DC2626' : '1px solid var(--color-border-default)',
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
