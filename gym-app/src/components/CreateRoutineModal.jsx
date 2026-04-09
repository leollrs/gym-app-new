import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Zap, Trash2, Dumbbell, AlertCircle, ArrowRight } from 'lucide-react';
import { MUSCLE_GROUPS, getExerciseById } from '../data/exercises';
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
      setError(err.message || t('createRoutine.failedToSave'));
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
      setError(err.message || t('createRoutine.failedToSave'));
    } finally {
      setSaving(false);
    }
  };

  const hasExercises = exercises.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4"
      onClick={onClose}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-routine-title"
        className="border rounded-[20px] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
        style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)', paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <h2 id="create-routine-title" className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {t('createRoutine.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors"
            style={{ backgroundColor: 'var(--color-surface-hover)' }}
          >
            <X size={20} style={{ color: 'var(--color-text-muted)' }} />
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
              className="flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>
              {t('createRoutine.routineName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              placeholder={t('createRoutine.namePlaceholder')}
              className="w-full border rounded-xl px-4 py-3 text-[14px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Workout length / intensity */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>
              {t('createRoutine.workoutLength')}
            </label>
            <div className="flex gap-2">
              {WORKOUT_LENGTHS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWorkoutLength(key)}
                  className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl text-[13px] font-semibold transition-all border-2 ${
                    workoutLength === key
                      ? 'bg-[#D4AF37]/15 border-[#D4AF37]/60 text-[#D4AF37]'
                      : 'border-2'
                  }`}
                  style={workoutLength !== key ? { backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' } : undefined}
                >
                  <span>{t(`createRoutine.duration.${key}`)}</span>
                  <span className="text-[11px] font-medium opacity-80">{t(`createRoutine.duration.${key}_desc`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Muscle groups for auto-generate */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>
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
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all border-2 ${
                    selectedMuscles.includes(m)
                      ? 'bg-[#D4AF37]/20 border-[#D4AF37]/50 text-[#D4AF37]'
                      : ''
                  }`}
                  style={!selectedMuscles.includes(m) ? { backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' } : undefined}
                >
                  {t(`muscleGroups.${m}`, m)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAutoGenerate}
              disabled={selectedMuscles.length === 0}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-all bg-[#D4AF37] text-black"
            >
              <Zap size={16} />
              {t('createRoutine.autoGenerate')}
            </button>
            <button
              type="button"
              onClick={handleEditManually}
              disabled={saving}
              className="mt-2 flex items-center gap-1 text-[13px] font-medium hover:text-[#D4AF37] transition-colors disabled:opacity-50"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {t('createRoutine.orEditManually')} <ArrowRight size={13} />
            </button>
          </div>

          {/* Exercise list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
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
                        className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-red-500/10 hover:text-red-400 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('createRoutine.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-xl text-[14px] font-bold disabled:opacity-50 transition-all bg-[#D4AF37] text-black focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            {saving ? t('createRoutine.saving') : hasExercises ? (saveLabel || t('createRoutine.saveAndStart')) : t('createRoutine.saveAndEdit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRoutineModal;
