// AppendToRoutineModal.jsx
//
// Center-aligned modal that lets the user append an exercise (typically a
// Recovery-modal suggestion for an untrained muscle group) to one of their
// saved routines. The exercise is inserted at the next available position
// inside `routine_exercises`. Multiple appends in a row are batched by
// looking up `MAX(position)` once per submit.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Check, Loader2 } from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';

export default function AppendToRoutineModal({ open, onClose, exercise }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const { routines, loading, refetch } = useRoutines();
  const [selectedId, setSelectedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  if (!open || !exercise) return null;

  const exName = i18n.language === 'es' && exercise.name_es ? exercise.name_es : exercise.name;

  const handleSubmit = async () => {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    try {
      const { data: existing, error: posErr } = await supabase
        .from('routine_exercises')
        .select('position')
        .eq('routine_id', selectedId)
        .order('position', { ascending: false })
        .limit(1);
      if (posErr) throw posErr;
      const nextPos = (existing?.[0]?.position ?? 0) + 1;

      const row = {
        routine_id: selectedId,
        exercise_id: exercise.id,
        position: nextPos,
        target_sets: exercise.defaultSets || 3,
        target_reps: typeof exercise.defaultReps === 'string'
          ? exercise.defaultReps
          : String(exercise.defaultReps ?? '10'),
        rest_seconds: 90,
      };
      const { error: insErr } = await supabase.from('routine_exercises').insert(row);
      if (insErr) throw insErr;

      const target = routines.find((r) => r.id === selectedId);
      showToast(
        t('readinessModal.suggestionAdded', {
          exercise: exName,
          routine: target?.name || '',
          defaultValue: `Added ${exName} to ${target?.name || 'routine'}`,
        }),
        'success'
      );
      refetch();
      onClose();
    } catch (e) {
      showToast(
        t('readinessModal.suggestionAddFailed', { defaultValue: "Couldn't add exercise" }),
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('readinessModal.appendModalTitle', { defaultValue: 'Add to which routine?' })}
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{
        background: 'rgba(10,13,16,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          maxHeight: '80vh',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
              {t('readinessModal.addToRoutine', { defaultValue: 'Add to routine' })}
            </div>
            <div className="mt-1 text-[16px] font-extrabold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {exName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="ml-3 -mt-1 rounded-full p-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Routine list */}
        <div className="px-3 pb-3 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            </div>
          ) : routines.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('readinessModal.noRoutinesYet', { defaultValue: 'No routines yet. Create one first.' })}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {routines.map((r) => {
                const isActive = r.id === selectedId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className="flex items-center justify-between rounded-xl px-4 py-3 text-left transition-all"
                    style={{
                      background: isActive
                        ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-card))'
                        : 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                      border: `1px solid ${isActive ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {r.name}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {t('readinessModal.exerciseCount', {
                          count: r.exerciseCount || 0,
                          defaultValue: `${r.exerciseCount || 0} exercise${(r.exerciseCount || 0) === 1 ? '' : 's'}`,
                        })}
                      </div>
                    </div>
                    {isActive && (
                      <Check size={16} style={{ color: 'var(--color-accent)' }} strokeWidth={2.6} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Submit */}
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border-subtle)' }}
        >
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedId || submitting}
            className="w-full rounded-xl py-3 text-[14px] font-extrabold uppercase tracking-wider transition-all disabled:opacity-40"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent, #0A0D14)',
            }}
          >
            {submitting
              ? t('readinessModal.adding', { defaultValue: 'Adding…' })
              : t('readinessModal.append', { defaultValue: 'Append' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
