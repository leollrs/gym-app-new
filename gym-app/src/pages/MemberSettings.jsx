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
    <div className="min-h-screen bg-[#05070B] text-[#E5E7EB] pb-32 overscroll-none overflow-y-auto" style={{ overscrollBehavior: 'none' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#05070B]/90 backdrop-blur-2xl border-b border-white/6">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.06] border border-white/10"
          >
            <ArrowLeft size={18} className="text-[#9CA3AF]" />
          </button>
          <h1 className="text-[18px] font-bold">{t('settings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-lg mx-auto space-y-4">
        {/* General */}
        <div>
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">{t('settings.general')}</h3>
          <div className="rounded-2xl bg-[#0F172A] border border-white/8 overflow-hidden divide-y divide-white/6">
            {[
              { label: t('settings.notificationPreferences'), icon: Bell, to: '/notifications' },
            ].map(item => (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
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
          <div className="rounded-2xl bg-[#0F172A] border border-white/8 overflow-hidden divide-y divide-white/6">
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
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
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
          <div className="rounded-2xl bg-[#0F172A] border border-white/8 overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/health-sync')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
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
          <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3 px-1">Privacy</h3>
          <div className="rounded-2xl bg-[#0F172A] border border-white/8 overflow-hidden">
            <button
              type="button"
              onClick={async () => {
                const newVal = !leaderboardVisible;
                setLeaderboardVisible(newVal);
                if (user?.id) {
                  await supabase.from('profiles').update({ leaderboard_visible: newVal }).eq('id', user.id);
                }
              }}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
            >
              <div className="flex items-center gap-3">
                {leaderboardVisible ? <Eye size={16} className="text-[#6B7280]" /> : <EyeOff size={16} className="text-[#6B7280]" />}
                <div>
                  <span className="text-[14px] font-semibold text-[#E5E7EB]">Show me on leaderboards</span>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">When off, you won't appear on any public leaderboard</p>
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
          <div className="rounded-2xl bg-[#0F172A] border border-white/8 overflow-hidden divide-y divide-white/6">
            <a
              href="https://tugympr.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
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
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.03] transition-all"
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-[400px] rounded-2xl bg-[#0F172A] border border-white/10 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div>
                <h3 className="text-[16px] font-bold text-[#E5E7EB]">{t('settings.deleteAccount')}</h3>
                <p className="text-[12px] text-[#6B7280]">{t('settings.thisCannotBeUndone')}</p>
              </div>
            </div>
            <p className="text-[13px] text-[#9CA3AF] mb-4">
              All your data will be permanently deleted. Type <strong className="text-red-400">DELETE</strong> to confirm.
            </p>
            <input
              type="text"
              value={deleteText}
              onChange={e => setDeleteText(e.target.value)}
              placeholder={t('settings.typeDelete')}
              className="w-full px-4 py-3 rounded-xl bg-[#0A0D14] border border-white/10 text-[#E5E7EB] text-[14px] mb-4 focus:outline-none focus:border-red-500/50"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setDeleteText(''); }}
                className="flex-1 py-3 rounded-xl bg-white/[0.06] border border-white/10 text-[#9CA3AF] text-[14px] font-semibold"
              >
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                disabled={deleteText !== 'DELETE' || deleting}
                onClick={async () => {
                  setDeleting(true);
                  await deleteAccount();
                }}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? t('settings.deleting') : t('settings.deleteForever')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
