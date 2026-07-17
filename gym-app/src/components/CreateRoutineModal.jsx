import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Zap, Trash2, Dumbbell, AlertCircle, Pencil } from 'lucide-react';
import { MUSCLE_GROUPS } from '../data/exercises';
import { getExerciseById } from '../lib/exerciseStore';
import { generateRoutineFromMuscles } from '../lib/workoutGenerator';
import useFocusTrap from '../hooks/useFocusTrap';

const WORKOUT_LENGTHS = [
  { key: 'quick' },
  { key: 'standard' },
  { key: 'long' },
];

const CreateRoutineModal = ({ onClose, onSave, saveLabel }) => {
  const { t } = useTranslation('pages');
  const [name, setName] = useState('');
  const [workoutLength, setWorkoutLength] = useState('standard');
  const [selectedMuscles, setSelectedMuscles] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const focusTrapRef = useFocusTrap(true, onClose);

  // Lock body scroll while modal is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggleMuscle = (m) => {
    setSelectedMuscles(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    );
  };

  const handleAutoGenerate = () => {
    if (selectedMuscles.length === 0) {
      setError(t('createRoutine.selectMuscle'));
      return;
    }
    setError('');
    const generated = generateRoutineFromMuscles(selectedMuscles, workoutLength);
    setExercises(generated);
  };

  const handleRemoveExercise = (index) => {
    setExercises(prev => prev.filter((_, i) => i !== index));
  };

  // Never render raw DB errors to members. supabase-js failures re-thrown by
  // useRoutines carry a PG/PostgREST code (server reject); code-less errors
  // are network-ish ("TypeError: Load failed").
  const friendlySaveError = (err) => {
    console.error('[create routine] save failed:', err);
    const code = String(err?.code || '').trim();
    const isServerReject = /^[0-9A-Z]{5}$/.test(code) || /^PGRST/i.test(code);
    return isServerReject
      ? t('createRoutine.failedToSave')
      : t('progress.body.connectionError', 'No connection — try again when you’re back online.');
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError(t('createRoutine.enterName'));
      return;
    }
    if (trimmed.length > 100) {
      setError(t('createRoutine.nameTooLong', 'Routine name must be 100 characters or less'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({ name: trimmed, exercises });
      // Parent navigates away; no need to call onClose (avoids setState on unmount)
    } catch (err) {
      setError(friendlySaveError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEditManually = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError(t('createRoutine.enterName'));
      return;
    }
    if (trimmed.length > 100) {
      setError(t('createRoutine.nameTooLong', 'Routine name must be 100 characters or less'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({ name: trimmed, exercises: [] });
    } catch (err) {
      setError(friendlySaveError(err));
    } finally {
      setSaving(false);
    }
  };

  const hasExercises = exercises.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
      onClick={onClose}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-routine-title"
        className="w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 28,
          border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
          fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between flex-shrink-0"
          style={{
            padding: '20px 24px 18px',
            borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
          }}
        >
          <div className="min-w-0 flex-1">
            <p
              className="uppercase"
              style={{
                fontSize: 11, fontWeight: 800, letterSpacing: '0.16em',
                color: 'var(--color-accent)',
              }}
            >
              {t('createRoutine.eyebrow', 'New routine')}
            </p>
            <h2
              id="create-routine-title"
              className="truncate"
              style={{
                fontFamily: '"Archivo", "Familjen Grotesk", system-ui',
                fontSize: 24, fontWeight: 900, letterSpacing: -0.5,
                color: 'var(--color-text-primary)',
                marginTop: 4, lineHeight: 1.1,
              }}
            >
              {t('createRoutine.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('createRoutine.ariaCloseDialog', 'Close dialog')}
            className="flex items-center justify-center transition-transform active:scale-90 shrink-0"
            style={{
              width: 38, height: 38, borderRadius: 19,
              background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              color: 'var(--color-text-primary)',
            }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Error notification — near top, prominent */}
        {error && (
          <div className="mx-5 mt-4 mb-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex-shrink-0">
            <AlertCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="flex-1 text-[14px] font-medium text-red-300">{error}</p>
            <button
              onClick={() => setError('')}
              aria-label={t('createRoutine.dismissError', 'Dismiss error')}
              className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400 transition-colors focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-[14px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {t('createRoutine.routineName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              placeholder={t('createRoutine.namePlaceholder')}
              className="w-full rounded-[14px] px-4 py-3 text-[14px] focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-surface-hover)', border: 'none', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Workout length / intensity */}
          <div>
            <label className="block text-[14px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {t('createRoutine.workoutLength')}
            </label>
            <div className="flex gap-2">
              {WORKOUT_LENGTHS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWorkoutLength(key)}
                  className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-3 rounded-full text-[13px] font-semibold transition-all border-2 ${
                    workoutLength === key
                      ? ''
                      : ''
                  }`}
                  style={workoutLength === key
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 40%, transparent)', color: 'var(--color-accent, #2EC4C4)' }
                    : { backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                >
                  <span>{t(`createRoutine.duration.${key}`)}</span>
                  <span className="text-[11px] font-medium opacity-80">{t(`createRoutine.duration.${key}_desc`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Muscle groups for auto-generate */}
          <div>
            <label className="block text-[14px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {t('createRoutine.targetAreas')}
            </label>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_GROUPS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMuscle(m)}
                  aria-pressed={selectedMuscles.includes(m)}
                  aria-label={t(`muscleGroups.${m}`, m)}
                  className="px-3.5 py-2 rounded-full text-[13px] font-semibold transition-all border-2"
                  style={selectedMuscles.includes(m)
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 40%, transparent)', color: 'var(--color-accent, #2EC4C4)' }
                    : { backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                >
                  {t(`muscleGroups.${m}`, m)}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleAutoGenerate}
                disabled={selectedMuscles.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-full text-[13px] font-bold disabled:opacity-50 transition-all text-[var(--color-text-on-accent,#fff)]"
                style={{ backgroundColor: 'var(--color-accent, #2EC4C4)' }}
              >
                <Zap size={16} />
                {t('createRoutine.autoGenerate')}
              </button>
              <button
                type="button"
                onClick={handleEditManually}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full text-[13px] font-bold border-2 disabled:opacity-50 transition-all"
                style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
              >
                <Pencil size={15} strokeWidth={2.4} />
                {t('createRoutine.createManually', 'Create manually')}
              </button>
            </div>
          </div>

          {/* Exercise list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[14px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>
                {t('createRoutine.exercisesCount', { count: exercises.length })}
              </label>
            </div>
            {exercises.length === 0 ? (
              <div className="rounded-xl border border-dashed py-10 text-center" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-hover)' }}>
                <Dumbbell size={32} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--color-text-subtle)' }} />
                <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('createRoutine.emptyExercisesHint')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {exercises.map((item, index) => {
                  const ex = getExerciseById(item.id);
                  return (
                    <div
                      key={`${item.id}-${index}`}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border"
                      style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {ex?.name ?? item.id}
                        </p>
                        <p className="text-[12px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
                          {ex?.muscle ?? ''} · {item.sets}×{item.reps}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveExercise(index)}
                        aria-label={t('createRoutine.removeExercise', 'Remove exercise')}
                        className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-red-500/10 hover:text-red-400 transition-colors focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex-shrink-0 flex gap-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-full text-[14px] font-semibold transition-colors focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none"
            style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface-hover)' }}
          >
            {t('createRoutine.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-[16px] text-[14px] disabled:opacity-50 transition-all text-[var(--color-text-on-accent,#fff)] focus:ring-2 focus:ring-[var(--color-accent,#2EC4C4)] focus:outline-none"
            style={{ backgroundColor: 'var(--color-accent, #2EC4C4)', fontWeight: 800 }}
          >
            {saving ? t('createRoutine.saving') : hasExercises ? (saveLabel || t('createRoutine.saveAndStart')) : t('createRoutine.saveAndEdit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRoutineModal;
