import React, { useState } from 'react';
import { X, Zap, Trash2, Dumbbell, AlertCircle } from 'lucide-react';
import { MUSCLE_GROUPS, getExerciseById } from '../data/exercises';
import { generateRoutineFromMuscles } from '../lib/workoutGenerator';
import useFocusTrap from '../hooks/useFocusTrap';

const WORKOUT_LENGTHS = [
  { key: 'quick', label: 'Quick', desc: '~30 min' },
  { key: 'standard', label: 'Standard', desc: '~45–60 min' },
  { key: 'long', label: 'Long', desc: '~60–90 min' },
];

const CreateRoutineModal = ({ onClose, onSave }) => {
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
      setError('Select at least one muscle group');
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
    if (!trimmed) {
      setError('Enter a routine name');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({ name: trimmed, exercises });
      // Parent navigates away; no need to call onClose (avoids setState on unmount)
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

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
        className="bg-slate-800 border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
          <h2 id="create-routine-title" className="text-[18px] font-bold text-slate-100">
            Create routine
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Error notification — near top, prominent */}
        {error && (
          <div className="mx-5 mt-4 mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex-shrink-0">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="flex-1 text-[14px] font-medium text-red-700">{error}</p>
            <button
              onClick={() => setError('')}
              className="flex-shrink-0 p-1 rounded-lg hover:bg-red-100 text-red-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>
              Routine name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Upper Body Power"
              className="w-full rounded-xl px-4 py-3 text-[14px] focus:outline-none transition-colors"
              style={{
                background: '#F9FAFB',
                border: '1px solid rgba(148,163,184,0.7)',
                color: '#0F172A',
              }}
            />
          </div>

          {/* Workout length / intensity */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>
              Workout length
            </label>
            <div className="flex gap-2">
              {WORKOUT_LENGTHS.map(({ key, label, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWorkoutLength(key)}
                  className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-3 rounded-xl text-[13px] font-semibold transition-all border-2 ${
                    workoutLength === key
                      ? 'bg-[#D4AF37]/15 border-[#D4AF37]/60'
                      : 'bg-[#F3F4F6] border-transparent hover:bg-[#E5E7EB]'
                  }`}
                  style={{ color: workoutLength === key ? '#0F172A' : '#6B7280' }}
                >
                  <span>{label}</span>
                  <span className="text-[11px] font-medium opacity-80">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Muscle groups for auto-generate */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B7280' }}>
              Target areas (for auto-generate)
            </label>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_GROUPS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMuscle(m)}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                    selectedMuscles.includes(m)
                      ? 'bg-[#D4AF37]/20 border-2 border-[#D4AF37]/50 text-[#0F172A]'
                      : 'bg-[#F3F4F6] border-2 border-transparent text-[#6B7280] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAutoGenerate}
              disabled={selectedMuscles.length === 0}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-50 transition-all"
              style={{
                background: selectedMuscles.length ? 'var(--accent-gold)' : '#E5E7EB',
                color: selectedMuscles.length ? '#000' : '#6B7280',
              }}
            >
              <Zap size={16} />
              Auto-generate routine
            </button>
          </div>

          {/* Exercise list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: '#6B7280' }}>
                Exercises ({exercises.length})
              </label>
            </div>
            {exercises.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/10 py-10 text-center" style={{ background: '#FAFAFA' }}>
                <Dumbbell size={32} className="mx-auto mb-2 opacity-30" style={{ color: '#6B7280' }} />
                <p className="text-[13px]" style={{ color: '#9CA3AF' }}>
                  Select muscle groups above and tap Auto-generate, or save and add exercises in the editor.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {exercises.map((item, index) => {
                  const ex = getExerciseById(item.id);
                  return (
                    <div
                      key={`${item.id}-${index}`}
                      className="flex items-center gap-3 rounded-xl px-4 py-3 border border-black/5 bg-white"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[14px] truncate" style={{ color: '#0F172A' }}>
                          {ex?.name ?? item.id}
                        </p>
                        <p className="text-[12px] truncate" style={{ color: '#6B7280' }}>
                          {ex?.muscle ?? ''} · {item.sets}×{item.reps}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveExercise(index)}
                        className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-red-50 text-[#9CA3AF] hover:text-red-500 transition-colors"
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
        <div className="p-5 border-t border-black/5 flex-shrink-0 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl text-[14px] font-semibold border border-black/10 transition-colors"
            style={{ color: '#6B7280', background: '#F9FAFB' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-xl text-[14px] font-bold disabled:opacity-50 transition-all"
            style={{ background: 'var(--accent-gold)', color: '#000' }}
          >
            {saving ? 'Saving…' : 'Save & Edit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateRoutineModal;
