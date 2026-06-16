// WellnessCheckinModal.jsx
//
// One-tap subjective recovery check-in. User drags a slider between 1-10
// (1 = fresh, 10 = smoked). Saved to wellness_checkins (one row per user
// per local calendar date). Replaces the Apple-Watch-only HRV/RHR card in
// ReadinessModal — works for every user.
//
// Triggered:
//   • Inline from ReadinessModal when no check-in exists yet today.
//   • Auto-shown by SessionSummary after a workout finishes.
//   • Surfaced via a 9 AM local notification (see lib/wellnessReminder.js).
//
// Rendered through createPortal so click events don't bubble back to a
// parent modal's backdrop and close it.

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useScrollLock } from '../hooks/useScrollLock';

// Lower soreness → green (recovered), middle → amber, high → red.
const toneFor = (score) => {
  if (score == null) return '#9CA3AF';
  if (score <= 3) return '#10B981'; // emerald
  if (score <= 6) return '#F59E0B'; // amber
  return '#EF4444'; // red
};

const localDateString = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const LOCAL_CACHE_KEY = 'tugympr_wellness_last_checkin';

export default function WellnessCheckinModal({ open, onClose, onSaved }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [score, setScore] = useState(5);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [errorState, setErrorState] = useState(false);

  // Lock background page scroll while the check-in is open.
  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      setScore(5);
      setSaving(false);
      setSavedFlash(false);
      setErrorState(false);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    if (saving || !user?.id || !profile?.gym_id) return;
    setSaving(true);
    setErrorState(false);
    const dateKey = localDateString();
    const row = {
      profile_id: user.id,
      gym_id: profile.gym_id,
      checkin_date: dateKey,
      soreness: score,
    };
    const { error } = await supabase
      .from('wellness_checkins')
      .upsert(row, { onConflict: 'profile_id,checkin_date' });
    if (error) {
      // Save failed (most often: migration 0384 not yet applied, or transient
      // network issue). Cache locally so we don't loop-prompt the user this
      // session, surface a toast, and bail out gracefully.
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ date: dateKey, soreness: score }));
      } catch {}
      setSaving(false);
      setErrorState(true);
      showToast?.(
        t('wellness.errorSave', 'Saved locally — we\'ll sync when reconnected'),
        'info',
      );
      // Still tell the parent so the card updates immediately.
      onSaved?.(row);
      setTimeout(() => onClose?.(), 1500);
      return;
    }
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ date: dateKey, soreness: score }));
    } catch {}
    setSavedFlash(true);
    onSaved?.(row);
    setTimeout(() => onClose?.(), 900);
  }, [score, saving, user?.id, profile?.gym_id, onSaved, onClose, showToast, t]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          // Stop ALL pointer/click events from bubbling beyond this portal —
          // otherwise parent-modal backdrops will close on the same gesture.
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={!saving && !savedFlash ? onClose : undefined}
          />

          {/* Content */}
          <motion.div
            className="relative w-full max-w-md rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-bg-deep)',
              border: '1px solid var(--color-border-subtle)',
            }}
            initial={{ y: 40, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            role="dialog"
            aria-modal="true"
            aria-label={t('wellness.title', 'How sore are you today?')}
            onClick={(e) => e.stopPropagation()}
          >
            {savedFlash ? (
              <div className="p-8 flex flex-col items-center text-center gap-3">
                <CheckCircle2 size={36} style={{ color: '#10B981' }} />
                <p
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('wellness.saved', 'Got it — thanks!')}
                </p>
              </div>
            ) : errorState ? (
              <div className="p-8 flex flex-col items-center text-center gap-3">
                <AlertTriangle size={32} style={{ color: '#F59E0B' }} />
                <p
                  className="text-[14px] font-bold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('wellness.errorTitle', 'Saved offline')}
                </p>
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('wellness.errorBody', 'We couldn\'t reach the server. Your check-in is stored locally.')}
                </p>
              </div>
            ) : (
              <div className="p-5 pb-6">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose?.(); }}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/[0.08] transition-colors"
                  aria-label={t('common.close', 'Close')}
                >
                  <X size={16} style={{ color: 'var(--color-text-muted)' }} />
                </button>

                <p
                  className="text-[11px] font-semibold uppercase tracking-[0.1em] mb-1"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {t('wellness.eyebrow', 'Daily check-in')}
                </p>
                <h2
                  className="text-[18px] font-bold leading-snug pr-8"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('wellness.title', 'How sore are you today?')}
                </h2>
                <p
                  className="text-[12.5px] mt-1.5 leading-relaxed pr-2"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('wellness.subtitle', '1 = fully recovered · 10 = very sore')}
                </p>

                {/* Big value display */}
                <div className="mt-6 flex items-baseline justify-center gap-1">
                  <span
                    className="text-[64px] font-black leading-none tabular-nums transition-colors"
                    style={{
                      color: toneFor(score),
                      fontFamily: '"Archivo", "Familjen Grotesk", system-ui, sans-serif',
                    }}
                  >
                    {score}
                  </span>
                  <span
                    className="text-[18px] font-bold tabular-nums"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    /10
                  </span>
                </div>

                {/* Slider */}
                <div className="mt-4 px-1">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    aria-label={t('wellness.title', 'How sore are you today?')}
                    className="w-full"
                    style={{
                      WebkitAppearance: 'none',
                      appearance: 'none',
                      height: 8,
                      borderRadius: 999,
                      // Visual fill: gradient up to the current value's position.
                      background: `linear-gradient(to right, ${toneFor(score)} 0%, ${toneFor(score)} ${((score - 1) / 9) * 100}%, rgba(255,255,255,0.10) ${((score - 1) / 9) * 100}%, rgba(255,255,255,0.10) 100%)`,
                      outline: 'none',
                    }}
                  />
                  <style>{`
                    input[type="range"]::-webkit-slider-thumb {
                      -webkit-appearance: none;
                      appearance: none;
                      width: 28px;
                      height: 28px;
                      border-radius: 50%;
                      background: #FFFFFF;
                      border: 3px solid ${toneFor(score)};
                      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                      cursor: pointer;
                    }
                    input[type="range"]::-moz-range-thumb {
                      width: 28px;
                      height: 28px;
                      border-radius: 50%;
                      background: #FFFFFF;
                      border: 3px solid ${toneFor(score)};
                      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                      cursor: pointer;
                    }
                  `}</style>
                  <div className="flex justify-between mt-2 px-0.5">
                    <span className="text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                      1 · {t('wellness.scaleLow', 'Fresh')}
                    </span>
                    <span className="text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                      10 · {t('wellness.scaleHigh', 'Very sore')}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClose?.(); }}
                    disabled={saving}
                    className="flex-1 py-3 rounded-xl text-[13px] font-semibold border border-white/10 transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {t('wellness.skip', 'Skip')}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleSave(); }}
                    disabled={saving}
                    className="flex-1 py-3 rounded-xl text-[13px] font-bold transition-opacity disabled:opacity-40"
                    style={{
                      background: 'var(--color-accent)',
                      color: 'var(--color-text-on-accent, #000)',
                    }}
                  >
                    {saving ? t('wellness.saving', 'Saving…') : t('wellness.save', 'Save')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
