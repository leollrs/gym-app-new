// src/components/BlockUserModal.jsx
//
// Center-aligned confirm modal: "Block @username?" + Confirm/Cancel.
//
// Center-aligned mid-page — never bottom-sheet (per user UI rules).
// Wrapper structure mirrors NPSSurveyModal.jsx / ReportContentModal.jsx.

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Ban } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { blockUser } from '../lib/moderation';

const FONT_DISPLAY = "'Archivo', 'Familjen Grotesk', system-ui, sans-serif";
const FONT_BODY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";

export default function BlockUserModal({
  isOpen,
  onClose,
  targetUserId,
  username,        // raw username, no @
  fullName,        // optional fall-back display name
  onBlocked,
}) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSubmitting(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const handle = username
    ? `@${username}`
    : (fullName || t('moderation.unknownUser', { defaultValue: 'this user' }));

  const handleConfirm = useCallback(async () => {
    if (!targetUserId || submitting) return;
    setSubmitting(true);
    const { error } = await blockUser(targetUserId);
    setSubmitting(false);
    if (error) {
      showToast(t('moderation.block.error', { defaultValue: 'Could not block user. Please try again.' }), 'error');
      return;
    }
    showToast(
      t('moderation.block.success', {
        defaultValue: 'Blocked {{name}}',
        name: username ? `@${username}` : (fullName || ''),
      }),
      'success'
    );
    onBlocked?.(targetUserId);
    onClose?.();
  }, [targetUserId, submitting, username, fullName, showToast, t, onBlocked, onClose]);

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
          aria-label={t('moderation.block.title', { defaultValue: 'Block user' })}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!submitting ? onClose : undefined}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-[400px] rounded-[22px] overflow-hidden"
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
                <Ban size={20} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="text-[16px] font-bold leading-tight"
                  style={{ color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: -0.2 }}
                >
                  {t('moderation.block.titleWithHandle', {
                    defaultValue: 'Block {{handle}}?',
                    handle,
                  })}
                </h3>
                <p
                  className="text-[13px] mt-1.5 leading-snug"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('moderation.block.body', {
                    defaultValue: "You won't see their posts, comments, or messages, and they won't be able to message you. You can unblock anytime in Settings.",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={!submitting ? onClose : undefined}
                aria-label={t('moderation.block.cancel', { defaultValue: 'Cancel' })}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.06]"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                <X size={18} />
              </button>
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
                {t('moderation.block.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 py-3 rounded-[14px] text-[14px] font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgb(220,38,38)' }}
              >
                {submitting
                  ? t('moderation.block.submitting', { defaultValue: 'Blocking…' })
                  : t('moderation.block.confirm', { defaultValue: 'Block' })}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
