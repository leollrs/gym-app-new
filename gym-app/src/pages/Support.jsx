// Support.jsx
// -----------------------------------------------------------------------------
// In-app Help & Support center. Standard content sub-page (NOT a modal) that
// matches the MemberSettings list-item style. Provides:
//   • a primary contact email
//   • a static FAQ (8 entries)
//   • a Report a problem button that opens the user's mail client with the
//     app version, OS, and user ID prefilled
//   • shortcuts to Privacy / Terms (in-app legal viewer) and Account Deletion
// -----------------------------------------------------------------------------

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Mail,
  HelpCircle,
  Bug,
  Shield,
  FileText,
  Trash2,
  Info,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import packageJson from '../../package.json';

// Default support contact when the gym hasn't configured its own address.
const DEFAULT_SUPPORT_EMAIL = 'support@tugympr.com';

const FAQ_KEYS = [
  { q: 'support.faq.healthSyncQ',     a: 'support.faq.healthSyncA' },
  { q: 'support.faq.savingQ',         a: 'support.faq.savingA' },
  { q: 'support.faq.rewardsQ',        a: 'support.faq.rewardsA' },
  { q: 'support.faq.deleteAccountQ',  a: 'support.faq.deleteAccountA' },
  { q: 'support.faq.dataProtectionQ', a: 'support.faq.dataProtectionA' },
  { q: 'support.faq.progressPhotosQ', a: 'support.faq.progressPhotosA' },
  { q: 'support.faq.reportContentQ',  a: 'support.faq.reportContentA' },
  { q: 'support.faq.pushNotWorkingQ', a: 'support.faq.pushNotWorkingA' },
];

export default function Support() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user, gymConfig } = useAuth();
  const [openIdx, setOpenIdx] = useState(null);

  // Per-gym override for white-label deployments; falls back to TuGymPR default.
  const SUPPORT_EMAIL = gymConfig?.supportEmail || DEFAULT_SUPPORT_EMAIL;

  useEffect(() => {
    document.title = t('support.title');
  }, [t]);

  const appVersion = packageJson?.version || '1.0.0';
  const platform = Capacitor.getPlatform?.() || 'web';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  const reportMailto = useMemo(() => {
    const subject = t('support.reportSubject');
    const lines = [
      t('support.reportBodyIntro'),
      '',
      '',
      '— — —',
      t('support.reportBodyDevice'),
      `App: TuGymPR ${appVersion}`,
      `Platform: ${platform}`,
      `User ID: ${user?.id || 'unknown'}`,
      `User-Agent: ${userAgent}`,
    ];
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
  }, [t, appVersion, platform, user?.id, userAgent, SUPPORT_EMAIL]);

  const emailMailto = `mailto:${SUPPORT_EMAIL}`;

  const toggleFaq = useCallback((idx) => {
    setOpenIdx((cur) => (cur === idx ? null : idx));
  }, []);

  return (
    <div
      className="min-h-screen pb-28 md:pb-12"
      style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
    >
      {/* Header — matches MemberSettings */}
      <div
        className="sticky top-0 z-30 backdrop-blur-2xl border-b border-white/[0.06]"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}
      >
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('settings.goBack', 'Go back')}
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <ArrowLeft size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <h1 className="text-[22px] font-bold truncate">{t('support.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto space-y-5">
        {/* Get help */}
        <div>
          <h3
            className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('support.getHelpHeading')}
          </h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('support.getHelpDescription')}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('support.contactEmailLabel')}
                  </div>
                  <div className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {SUPPORT_EMAIL}
                  </div>
                </div>
                <a
                  href={emailMailto}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
                >
                  <Mail size={14} />
                  {t('support.emailUs')}
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div>
          <h3
            className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('support.faqHeading')}
          </h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            {FAQ_KEYS.map((entry, idx) => {
              const isOpen = openIdx === idx;
              const panelId = `faq-panel-${idx}`;
              const buttonId = `faq-button-${idx}`;
              return (
                <div key={entry.q}>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggleFaq(idx)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#D4AF37]"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-3">
                      <HelpCircle size={16} style={{ color: 'var(--color-text-subtle)' }} className="flex-shrink-0" />
                      <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {t(entry.q)}
                      </span>
                    </div>
                    <ChevronDown
                      size={16}
                      style={{
                        color: 'var(--color-text-subtle)',
                        transition: 'transform 200ms ease',
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                  {isOpen && (
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      className="px-5 pb-4 -mt-1 text-[13px] leading-relaxed"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {t(entry.a)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Report a problem */}
        <div>
          <h3
            className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('support.reportProblemHeading')}
          </h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden">
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('support.reportProblemDescription')}
              </p>
              <a
                href={reportMailto}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border border-white/[0.1] hover:bg-white/[0.06] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <Bug size={14} />
                {t('support.reportButton')}
              </a>
            </div>
          </div>
        </div>

        {/* Privacy & terms / data shortcuts */}
        <div>
          <h3
            className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-1"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('support.legalHeading')}
          </h3>
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.06]">
            <button
              type="button"
              onClick={() => navigate('/legal/privacy')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Shield size={16} style={{ color: 'var(--color-text-subtle)' }} />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('support.openPrivacyPolicy')}
                </span>
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
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('support.openTerms')}
                </span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.06] transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <Trash2 size={16} className="text-red-400" />
                <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {t('support.deleteAccountLink')}
                </span>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
            </button>
          </div>
        </div>

        {/* App version footer */}
        <div className="pt-2 pb-6 text-center">
          <div
            className="inline-flex items-center gap-2 text-[12px]"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <Info size={12} />
            <span>
              {t('support.appVersionHeading')} {appVersion} ({platform})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
