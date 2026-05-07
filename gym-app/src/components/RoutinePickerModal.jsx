import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Dumbbell, MinusCircle, Check, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const RoutinePickerModal = ({ open, onClose, dayOfWeek, routines = [], currentRoutineId, onSelect, onClear }) => {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();

  const startEmptySession = () => {
    onClose();
    navigate('/session/empty');
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const dayName = t(`routinePicker.days.${dayOfWeek}`, '');

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60]"
            style={{
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="routine-picker-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="fixed bottom-0 left-0 right-0 z-[61] max-h-[80vh] flex flex-col"
            style={{
              background: 'var(--color-bg-card)',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
              boxShadow: '0 -20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
              fontFamily: FONT_BODY,
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <div
                style={{
                  width: 44, height: 5, borderRadius: 999,
                  background: 'var(--color-border-subtle, rgba(255,255,255,0.14))',
                }}
              />
            </div>

            {/* Header */}
            <div
              className="flex items-start justify-between px-6 pt-4 pb-5"
              style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))' }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="uppercase"
                  style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.16em',
                    color: 'var(--color-accent)',
                  }}
                >
                  {t('routinePicker.assignWorkout', 'Assign workout')}
                </p>
                <p
                  id="routine-picker-title"
                  className="truncate"
                  style={{
                    fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 900,
                    letterSpacing: -0.6, marginTop: 4, lineHeight: 1.05,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {dayName}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center transition-transform active:scale-90"
                style={{
                  width: 38, height: 38, borderRadius: 19,
                  background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
                  border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                  color: 'var(--color-text-primary)',
                }}
                aria-label={t('routinePicker.close', 'Close')}
              >
                <X size={17} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4 space-y-2.5">
              {/* Empty workout — always available, regardless of saved routines */}
              <button
                type="button"
                onClick={startEmptySession}
                className="w-full flex items-center gap-3.5 transition-all active:scale-[0.985] focus:outline-none"
                style={{
                  padding: '14px 16px',
                  borderRadius: 18,
                  background: 'color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-hover))',
                  border: '1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                  textAlign: 'left',
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 44, height: 44, borderRadius: 14,
                    background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
                  }}
                >
                  <Sparkles size={18} strokeWidth={2.4} style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    style={{
                      fontFamily: FONT_DISPLAY, fontSize: 15.5, fontWeight: 800,
                      letterSpacing: -0.2, color: 'var(--color-text-primary)', lineHeight: 1.15,
                    }}
                  >
                    {t('routinePicker.emptyWorkoutTitle', 'Empty workout')}
                  </p>
                  <p
                    className="mt-1"
                    style={{
                      fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                      color: 'var(--color-accent)', textTransform: 'uppercase',
                    }}
                  >
                    {t('routinePicker.emptyWorkoutHint', 'Start fresh — add exercises as you go')}
                  </p>
                </div>
              </button>

              {routines.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.06))' }}
                  >
                    <Dumbbell size={22} style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                  <p
                    style={{
                      fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 800,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {t('routinePicker.noRoutinesAvailable', 'No routines yet')}
                  </p>
                  <p
                    className="mt-1.5"
                    style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}
                  >
                    {t('routinePicker.noRoutinesHint', 'Create one from the Workouts tab.')}
                  </p>
                </div>
              ) : (
                <>
                  {routines.map(r => {
                    const isSelected = r.id === currentRoutineId;
                    const label = r.name.replace('Auto: ', '').replace(/ [AB]$/, '');
                    const exerciseCount = r.routine_exercises?.length ?? r.exerciseCount ?? 0;

                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => { onSelect(r.id); onClose(); }}
                        className="w-full flex items-center gap-3.5 transition-all active:scale-[0.985] focus:outline-none"
                        style={{
                          padding: '14px 16px',
                          borderRadius: 18,
                          background: isSelected
                            ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-hover))'
                            : 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                          border: isSelected
                            ? '1.5px solid color-mix(in srgb, var(--color-accent) 50%, transparent)'
                            : '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
                          textAlign: 'left',
                        }}
                      >
                        <div
                          className="flex items-center justify-center shrink-0"
                          style={{
                            width: 44, height: 44, borderRadius: 14,
                            background: isSelected
                              ? 'color-mix(in srgb, var(--color-accent) 22%, transparent)'
                              : 'var(--color-bg-card, rgba(255,255,255,0.05))',
                            border: isSelected
                              ? 'none'
                              : '1px solid var(--color-border-subtle, rgba(255,255,255,0.04))',
                          }}
                        >
                          <Dumbbell
                            size={18}
                            strokeWidth={2.4}
                            style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className="truncate"
                            style={{
                              fontFamily: FONT_DISPLAY,
                              fontSize: 15.5, fontWeight: 800,
                              letterSpacing: -0.2,
                              color: 'var(--color-text-primary)',
                              lineHeight: 1.15,
                            }}
                          >
                            {label}
                          </p>
                          <p
                            className="mt-1"
                            style={{
                              fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                              color: 'var(--color-text-muted)',
                              textTransform: 'uppercase',
                            }}
                          >
                            {t('routinePicker.exercises_count', { count: exerciseCount })}
                          </p>
                        </div>
                        {isSelected && (
                          <div
                            className="flex items-center justify-center shrink-0"
                            style={{
                              width: 24, height: 24, borderRadius: 12,
                              background: 'var(--color-accent)',
                              color: 'var(--color-bg-card, #0A0D10)',
                            }}
                          >
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {currentRoutineId && (
                    <button
                      type="button"
                      onClick={() => { onClear(); onClose(); }}
                      className="w-full flex items-center gap-3.5 transition-all active:scale-[0.985] focus:outline-none"
                      style={{
                        padding: '14px 16px',
                        borderRadius: 18,
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px dashed rgba(239, 68, 68, 0.32)',
                        marginTop: 10,
                        textAlign: 'left',
                      }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{
                          width: 44, height: 44, borderRadius: 14,
                          background: 'rgba(239, 68, 68, 0.14)',
                        }}
                      >
                        <MinusCircle size={18} strokeWidth={2.4} style={{ color: '#EF4444' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          style={{
                            fontFamily: FONT_DISPLAY, fontSize: 15.5, fontWeight: 800,
                            letterSpacing: -0.2, color: '#F87171', lineHeight: 1.15,
                          }}
                        >
                          {t('routinePicker.restDay', 'Make it a rest day')}
                        </p>
                        <p
                          className="mt-1"
                          style={{
                            fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4,
                            color: 'rgba(248, 113, 113, 0.7)', textTransform: 'uppercase',
                          }}
                        >
                          {t('routinePicker.removeWorkoutFrom', { day: dayName, defaultValue: `Remove from ${dayName}` })}
                        </p>
                      </div>
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default RoutinePickerModal;
