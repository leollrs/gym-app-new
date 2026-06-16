// SupersetPickerModal.jsx
//
// Center-aligned picker opened by the "Superset" quick button in the active
// session. The user picks which existing routine exercise to pair with the
// current one, or chooses "Add new exercise" which closes the picker and
// hands the flow off to the standard AddExercise modal in `pickerMode='superset'`
// so the newly-added exercise gets auto-grouped with the current one.

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Plus, Link2 } from 'lucide-react';
import { useScrollLock } from '../hooks/useScrollLock';

export default function SupersetPickerModal({
  open,
  onClose,
  currentExerciseId,
  exercises,
  onPickExisting,
  onAddNew,
}) {
  const { t, i18n } = useTranslation('pages');

  // Lock background page scroll while the picker is open.
  useScrollLock(open);

  const candidates = useMemo(() => {
    if (!Array.isArray(exercises)) return [];
    return exercises.filter((ex) => ex.id !== currentExerciseId && !ex.groupId);
  }, [exercises, currentExerciseId]);

  if (!open) return null;

  const exName = (ex) => (i18n.language === 'es' && ex.name_es ? ex.name_es : ex.name);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('activeSession.supersetPickerTitle', { defaultValue: 'Superset with…' })}
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
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
            <div
              className="text-[10px] font-extrabold uppercase tracking-[0.14em] flex items-center gap-1.5"
              style={{ color: '#A99CFF' }}
            >
              <Link2 size={12} />
              {t('activeSession.supersetPickerEyebrow', { defaultValue: 'Superset' })}
            </div>
            <div className="mt-1 text-[16px] font-extrabold" style={{ color: 'var(--color-text-primary)' }}>
              {t('activeSession.supersetPickerTitle', { defaultValue: 'Pair with…' })}
            </div>
            <div className="mt-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('activeSession.supersetPickerSubtitle', { defaultValue: 'Pick an exercise to alternate with — or add a new one.' })}
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

        {/* List */}
        <div className="px-3 pb-3 flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('activeSession.supersetPickerEmpty', {
                defaultValue: 'No other exercises available — add a new one below.',
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {candidates.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => onPickExisting(ex.id)}
                  className="flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-all"
                  style={{
                    background: 'var(--color-surface-hover, rgba(255,255,255,0.04))',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <span
                    className="text-[14px] font-bold flex-1 min-w-0 truncate"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {exName(ex)}
                  </span>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-subtle)' }}
                  >
                    {ex.targetSets} × {ex.targetReps}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add-new CTA */}
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border-subtle)' }}
        >
          <button
            type="button"
            onClick={onAddNew}
            className="w-full rounded-xl py-3 text-[13px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-2"
            style={{
              background: 'rgba(109, 95, 219, 0.18)',
              color: '#A99CFF',
              border: '1px solid rgba(109, 95, 219, 0.32)',
            }}
          >
            <Plus size={14} strokeWidth={2.6} />
            {t('activeSession.supersetPickerAddNew', { defaultValue: 'Add a new exercise' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
