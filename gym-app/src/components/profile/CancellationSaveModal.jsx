// src/components/profile/CancellationSaveModal.jsx
//
// Member-facing "Before you go" save attempt — shown when a member taps
// "Cancel my membership" from Settings. Three outcomes, all of which write
// a row to cancellation_save_attempts (migration 0408):
//
//   • "I'll stay for now"            → outcome='stayed', no side effect
//   • "Pause my membership instead"  → outcome='paused', parent freezes
//   • "Cancel anyway"                → outcome='proceeded_to_cancel',
//                                       parent runs the existing cancel
//                                       flow afterwards.
//
// Tone: warm, no pressure, no fabricated offers. The thesis is that owner
// attention is the product — so this modal collects intent + reason and
// hands the decision back to the member. It does NOT promise discounts,
// free months, or anything the gym hasn't approved.
//
// Center-aligned wrapper mirrors BlockUserModal / ReportContentModal.
// AES-locked tenant boundary: profile_id + gym_id come from useAuth(),
// and RLS on the table re-validates both server-side.
//
// Reference: gym-app/src/pages/admin/components/CancellationSurveyModal.jsx
// (when it lands — admin-side has the same reason categories, flipped to a
// post-mortem tone. This is the pre-mortem.)

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Heart, PauseCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import logger from '../../lib/logger';

const FONT_DISPLAY = "'Archivo', 'Familjen Grotesk', system-ui, sans-serif";
const FONT_BODY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";

// Mirrors the admin exit-survey buckets and the cancellation_reason_category
// enum (migration 0408). Order is the order shown to the member — most
// addressable buckets first so the eye doesn't land on "health" before
// "financial".
const REASONS = ['moved', 'financial', 'time', 'no_results', 'experience', 'health'];

const NOTE_MAX = 300;

export default function CancellationSaveModal({
  isOpen,
  onClose,
  onPause,    // parent: flip membership_status to 'frozen'
  onProceed,  // parent: run the existing cancellation flow
}) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();

  const [reasonHint, setReasonHint] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset state every time the modal opens. We do NOT pre-fill from any
  // prior attempt — each open is a fresh decision.
  useEffect(() => {
    if (!isOpen) return;
    setReasonHint(null);
    setNote('');
    setSubmitting(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const reasonOptions = useMemo(() => REASONS.map((key) => ({
    key,
    label: t(`admin.cancellationSurvey.reasons.${key}`, {
      defaultValue: key,
    }),
  })), [t]);

  // Single write path: every CTA funnels through here so the save-attempt
  // row gets written exactly once per modal close. We intentionally do
  // NOT block the parent callback on the INSERT — analytics integrity
  // matters less than not stranding the member on the modal if the
  // network is bad. Errors are logged for ops visibility.
  const recordOutcome = useCallback(async (outcome) => {
    if (!user?.id || !profile?.gym_id) {
      logger.warn('[CancellationSaveModal] missing user.id or profile.gym_id; skipping insert', {
        hasUser: !!user?.id, hasGym: !!profile?.gym_id,
      });
      return;
    }
    const payload = {
      profile_id: user.id,
      gym_id: profile.gym_id,
      outcome,
      reason_hint: reasonHint || null,
      note: note?.trim() ? note.trim().slice(0, NOTE_MAX) : null,
    };
    const { error } = await supabase
      .from('cancellation_save_attempts')
      .insert(payload);
    if (error) {
      logger.error('[CancellationSaveModal] insert failed', error);
    }
  }, [user?.id, profile?.gym_id, reasonHint, note]);

  const handleStay = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    await recordOutcome('stayed');
    showToast(
      t('cancellation.saveModal.savedToast', {
        defaultValue: 'Glad you\'re staying. We\'re here when you need us.',
      }),
      'success'
    );
    setSubmitting(false);
    onClose?.();
  }, [submitting, recordOutcome, showToast, t, onClose]);

  const handlePause = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    await recordOutcome('paused');
    setSubmitting(false);
    onClose?.();
    // Parent owns the actual status flip so we don't double-mutate state.
    onPause?.();
  }, [submitting, recordOutcome, onClose, onPause]);

  const handleProceed = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    await recordOutcome('proceeded_to_cancel');
    setSubmitting(false);
    onClose?.();
    onProceed?.();
  }, [submitting, recordOutcome, onClose, onProceed]);

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
          aria-labelledby="cancel-save-title"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!submitting ? onClose : undefined}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-[440px] rounded-[22px] overflow-hidden max-h-[92vh] overflow-y-auto"
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
            <div className="flex flex-col items-center text-center gap-3 px-6 pt-6 pb-3 relative">
              <button
                type="button"
                onClick={!submitting ? onClose : undefined}
                aria-label={t('settings.cancel', { defaultValue: 'Close' })}
                className="absolute right-3 top-3 w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.06]"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                <X size={18} />
              </button>

              <div
                className="flex items-center justify-center"
                style={{
                  width: 48, height: 48, borderRadius: 16,
                  background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
                }}
              >
                <Heart size={22} style={{ color: 'var(--color-accent)' }} />
              </div>

              <h3
                id="cancel-save-title"
                className="text-[20px] font-bold leading-tight"
                style={{ color: 'var(--color-text-primary)', fontFamily: FONT_DISPLAY, letterSpacing: -0.3 }}
              >
                {t('cancellation.saveModal.title', { defaultValue: 'Before you go' })}
              </h3>
              <p
                className="text-[13px] leading-snug max-w-[360px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('cancellation.saveModal.intro', {
                  defaultValue: "Cancelling will end your membership and remove your access. Mind telling us what's going on?",
                })}
              </p>
            </div>

            {/* Reasons */}
            <div className="px-6 pt-2 pb-3">
              <div
                className="text-[11px] font-semibold uppercase tracking-widest mb-2"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {t('cancellation.saveModal.reasonsLabel', { defaultValue: 'What\'s the main reason?' })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {reasonOptions.map(({ key, label }) => {
                  const selected = reasonHint === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setReasonHint(selected ? null : key)}
                      aria-pressed={selected}
                      disabled={submitting}
                      className="px-3 py-2.5 rounded-[12px] text-[13px] font-semibold transition-colors disabled:opacity-50 text-left"
                      style={{
                        background: selected
                          ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)'
                          : 'var(--color-bg-secondary, rgba(127,127,127,0.08))',
                        border: `1px solid ${selected
                          ? 'var(--color-accent)'
                          : 'var(--color-border-subtle, rgba(127,127,127,0.12))'}`,
                        color: selected
                          ? 'var(--color-accent)'
                          : 'var(--color-text-primary)',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note */}
            <div className="px-6 pb-4">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                placeholder={t('cancellation.saveModal.notePlaceholder', {
                  defaultValue: 'Anything else we should know? (Optional)',
                })}
                maxLength={NOTE_MAX}
                rows={3}
                disabled={submitting}
                className="w-full rounded-[12px] px-3 py-2.5 text-[13px] resize-none focus:outline-none focus:ring-2"
                style={{
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.08))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.12))',
                  color: 'var(--color-text-primary)',
                  // CSS var fallback for the focus ring color
                  '--tw-ring-color': 'var(--color-accent)',
                }}
              />
              <div
                className="text-[10px] mt-1 text-right tabular-nums"
                style={{ color: 'var(--color-text-subtle)' }}
              >
                {note.length}/{NOTE_MAX}
              </div>
            </div>

            {/* CTAs — stacked, ordered to surface the save path first */}
            <div className="flex flex-col gap-2 px-6 pb-6">
              {/* a) I'll stay — primary save path, accent-colored */}
              <button
                type="button"
                onClick={handleStay}
                disabled={submitting}
                className="w-full py-3 rounded-[14px] text-[14px] font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-on-accent, #000)',
                }}
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Heart size={16} />}
                {t('cancellation.saveModal.ctaStay', { defaultValue: "I'll stay for now" })}
              </button>

              {/* b) Pause — secondary save path */}
              <button
                type="button"
                onClick={handlePause}
                disabled={submitting}
                className="w-full py-3 rounded-[14px] text-[14px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                style={{
                  background: 'var(--color-bg-secondary, rgba(127,127,127,0.08))',
                  border: '1px solid var(--color-border-subtle, rgba(127,127,127,0.16))',
                  color: 'var(--color-text-primary)',
                }}
              >
                <PauseCircle size={16} style={{ color: 'var(--color-text-muted)' }} />
                {t('cancellation.saveModal.ctaPause', { defaultValue: 'Pause my membership instead' })}
              </button>

              {/* c) Cancel anyway — quiet exit. Not destructive-red because the
                  cancel flow itself has its own DELETE-typed confirmation. */}
              <button
                type="button"
                onClick={handleProceed}
                disabled={submitting}
                className="w-full py-2.5 rounded-[14px] text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('cancellation.saveModal.ctaCancel', { defaultValue: 'Cancel anyway' })}
                <ArrowRight size={14} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
