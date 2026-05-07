// src/components/ReportContentModal.jsx
//
// Center-aligned modal for reporting a piece of UGC (post, comment, message,
// or profile). Routes through src/lib/moderation.js into the existing
// content_reports table that AdminModeration.jsx already reads.
//
// Center-aligned mid-page — never bottom-sheet (per user UI rules).
// Modal wrapper structure mirrors NPSSurveyModal.jsx (the reference
// center-aligned pattern in this codebase).

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import { X, AlertTriangle, ShieldCheck, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { reportContent, REPORT_REASONS } from '../lib/moderation';

const FONT_DISPLAY = "'Archivo', 'Familjen Grotesk', system-ui, sans-serif";
const FONT_BODY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";

// Subject noun used in the title — matches existing i18n contentNoun keys.
const NOUN_KEY = {
  post: 'post',
  activity: 'post',
  feed_item: 'post',
  comment: 'comment',
  message: 'message',
  dm: 'message',
  profile: 'profile',
  user: 'profile',
};

export default function ReportContentModal({
  isOpen,
  onClose,
  contentType = 'post',
  contentId,
  targetUserId,
  onReported,
}) {
  const { t } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setSelected(null);
    setDetails('');
    setSubmitting(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const noun = t(`moderation.contentNoun.${NOUN_KEY[contentType] || 'post'}`, {
    defaultValue: NOUN_KEY[contentType] || 'post',
  });

  const handleSubmit = useCallback(async () => {
    if (!selected || submitting || !contentId) return;
    setSubmitting(true);
    const { error, alreadyReported } = await reportContent({
      type: contentType,
      id: contentId,
      reason: selected,
      details,
      gymId: profile?.gym_id,
      targetUserId,
    });
    setSubmitting(false);

    if (error) {
      showToast(t('moderation.report.error', { defaultValue: 'Could not submit report. Please try again.' }), 'error');
      return;
    }
    if (alreadyReported) {
      showToast(t('moderation.report.alreadyReported', { defaultValue: 'You have already reported this.' }), 'info');
    } else {
      showToast(t('moderation.report.success', { defaultValue: 'Report submitted — our team will review within 24 hours.' }), 'success');
    }
    onReported?.(contentId);
    onClose?.();
  }, [selected, submitting, contentId, contentType, details, profile?.gym_id, targetUserId, showToast, t, onReported, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={t('moderation.report.title', { defaultValue: 'Report content' })}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!submitting ? onClose : undefined}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-[440px] rounded-[22px] overflow-hidden"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.16))',
              boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 12px 36px rgba(15,20,25,0.18)',
              fontFamily: FONT_BODY,
            }}
            initial={{ y: 32, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
          >
            {/* Header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-3">
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: 40, height: 40, borderRadius: 14,
                  background: 'rgba(239,68,68,0.14)',
                }}
              >
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="text-[16px] font-bold leading-tight"
                  style={{ color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: -0.2 }}
                >
                  {t('moderation.report.titleNoun', {
                    defaultValue: 'Report this {{noun}}',
                    noun,
                  })}
                </h3>
                <p
                  className="text-[12.5px] mt-1"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('moderation.report.subtitle', {
                    defaultValue: 'Tell us why. Reports are anonymous to the author.',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={!submitting ? onClose : undefined}
                aria-label={t('moderation.report.cancel', { defaultValue: 'Cancel' })}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.06]"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Reason picker (radio buttons) */}
            <fieldset
              className="px-5 pb-3 flex flex-col gap-2 max-h-[42vh] overflow-y-auto"
              aria-label={t('moderation.report.reasonLegend', { defaultValue: 'Reason' })}
            >
              <legend className="sr-only">
                {t('moderation.report.reasonLegend', { defaultValue: 'Reason' })}
              </legend>
              {REPORT_REASONS.map(reason => {
                const isSel = selected === reason;
                return (
                  <label
                    key={reason}
                    className="flex items-center gap-3 px-4 py-3 rounded-[14px] cursor-pointer transition-all"
                    style={isSel ? {
                      background: 'rgba(239,68,68,0.12)',
                      border: '1px solid rgba(239,68,68,0.4)',
                      color: 'var(--color-text-primary)',
                    } : {
                      background: 'var(--color-bg-secondary, rgba(127,127,127,0.04))',
                      border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={reason}
                      checked={isSel}
                      onChange={() => setSelected(reason)}
                      disabled={submitting}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 rounded-full"
                      style={{
                        width: 16, height: 16,
                        border: `2px solid ${isSel ? 'rgb(239,68,68)' : 'var(--color-border, rgba(127,127,127,0.4))'}`,
                        background: isSel ? 'rgb(239,68,68)' : 'transparent',
                        boxShadow: isSel ? 'inset 0 0 0 3px var(--color-bg-card)' : 'none',
                      }}
                    />
                    <span className="text-[14px] font-semibold">
                      {t(`moderation.report.reasons.${reason}`, { defaultValue: reason })}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {/* Optional details */}
            <div className="px-5 pb-2">
              <label
                htmlFor="report-details"
                className="block text-[11px] font-bold uppercase tracking-[0.08em] mb-1.5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('moderation.report.detailsLabel', { defaultValue: 'Add details' })}
                <span
                  className="ml-1 normal-case tracking-normal font-medium"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  ({t('moderation.report.optional', { defaultValue: 'optional' })})
                </span>
              </label>
              <textarea
                id="report-details"
                value={details}
                onChange={e => setDetails(e.target.value)}
                disabled={submitting}
                maxLength={500}
                rows={3}
                placeholder={t('moderation.report.detailsPlaceholder', {
                  defaultValue: 'Anything else our team should know?',
                })}
                className="w-full resize-none rounded-[14px] px-3.5 py-2.5 text-[13.5px] outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.04))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))',
                  color: 'var(--color-text-primary)',
                  fontFamily: FONT_BODY,
                }}
              />
            </div>

            {/* Compliance copy */}
            <div className="px-5 pb-3">
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-[12px]"
                style={{
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.04))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.10))',
                }}
              >
                <ShieldCheck size={14} style={{ color: 'var(--color-accent)', marginTop: 2, flexShrink: 0 }} />
                <p className="text-[11.5px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                  {t('moderation.report.complianceShort', {
                    defaultValue: 'Reports are reviewed within 24 hours.',
                  })}
                </p>
              </div>
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-[12px] mt-2"
                style={{
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.04))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.10))',
                }}
              >
                <Mail size={14} style={{ color: 'var(--color-accent)', marginTop: 2, flexShrink: 0 }} />
                <p className="text-[11.5px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
                  <Trans
                    i18nKey="moderation.report.abuseEmailFooter"
                    ns="pages"
                    defaults="For urgent abuse reports, email <1>abuse@tugympr.com</1>"
                    components={{
                      1: (
                        <a
                          href="mailto:abuse@tugympr.com"
                          style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
                        >
                          abuse@tugympr.com
                        </a>
                      ),
                    }}
                  />
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-5 pb-5 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 py-3 rounded-[14px] text-[14px] font-semibold transition-colors disabled:opacity-40"
                style={{
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.08))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))',
                }}
              >
                {t('moderation.report.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!selected || submitting}
                className="flex-1 py-3 rounded-[14px] text-[14px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgb(220,38,38)' }}
              >
                {submitting
                  ? t('moderation.report.submitting', { defaultValue: 'Submitting…' })
                  : t('moderation.report.submit', { defaultValue: 'Submit report' })}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
