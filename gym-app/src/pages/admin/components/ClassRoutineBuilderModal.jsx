import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Dumbbell, Loader2 } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { useToast } from '../../../contexts/ToastContext';
import { supabase } from '../../../lib/supabase';
import { exName as exNameLocalized } from '../../../lib/exerciseName';
import { logAdminAction } from '../../../lib/adminAudit';
import ExercisePicker from './ExercisePicker';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

/**
 * Create/edit a single workout routine (rows in `routines` + `routine_exercises`).
 *
 * Admins author these so they can be attached to gym classes as workout
 * templates (the class "Plantilla de entreno" picker lists staff-created
 * routines). Writes are scoped to the current admin: `created_by = userId`,
 * which keeps both `routines_admin` and `routine_exercises_access` RLS happy
 * (the latter only allows mutating exercises of routines you created).
 *
 * Routines created here are NOT member-facing programs — `is_template`/
 * `is_public` stay false, so they never appear in members' "Gym Programs"
 * or personal-routine lists; they only surface in the class template picker.
 */
export default function ClassRoutineBuilderModal({ routine, gymId, userId, onClose, onSaved, t, tc }) {
  const { showToast } = useToast();
  const isEdit = !!routine?.id;

  const [name, setName] = useState(routine?.name || '');
  const [description, setDescription] = useState(routine?.description || '');
  const [items, setItems] = useState([]); // { exercise_id, target_sets, target_reps, rest_seconds }
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'workouts'

  // Exercise library (global + this gym). Prefill sets/reps/rest from defaults.
  const { data: exercises = [] } = useQuery({
    queryKey: ['exercises-library-picker'],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group, default_sets, default_reps, rest_seconds')
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // On edit, hydrate the exercise rows from routine_exercises.
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('routine_exercises')
        .select('exercise_id, target_sets, target_reps, rest_seconds, position')
        .eq('routine_id', routine.id)
        .order('position');
      if (!cancelled) {
        setItems((data || []).map(d => ({
          exercise_id: d.exercise_id,
          target_sets: d.target_sets,
          target_reps: d.target_reps,
          rest_seconds: d.rest_seconds,
        })));
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, routine?.id]);

  const exName = (id) => {
    const ex = exercises.find(e => e.id === id);
    return ex ? exNameLocalized(ex) : id;
  };

  const addExercise = (ex) => {
    if (!ex?.id) return;
    setItems(prev => [...prev, {
      exercise_id: ex.id,
      target_sets: ex.default_sets || 3,
      target_reps: ex.default_reps || '8-12',
      rest_seconds: ex.rest_seconds || 90,
    }]);
  };

  const updateItem = (i, field, val) => setItems(prev => prev.map((it, j) => j === i ? { ...it, [field]: val } : it));
  const removeItem = (i) => setItems(prev => prev.filter((_, j) => j !== i));

  const handleSave = async () => {
    if (!name.trim()) { setActiveTab('details'); showToast(t('admin.programs.classRoutines.nameRequired', 'Routine name is required'), 'error'); return; }
    if (items.length === 0) { setActiveTab('workouts'); showToast(t('admin.programs.classRoutines.noExercises', 'Add at least one exercise'), 'error'); return; }
    setSaving(true);
    try {
      // Rough session estimate: ~35s work per set + rest, summed.
      const estMin = Math.max(1, Math.round(
        items.reduce((s, it) => s + (Number(it.target_sets) || 3) * (35 + (Number(it.rest_seconds) || 90)), 0) / 60,
      ));

      let routineId = routine?.id;
      if (isEdit) {
        const { error } = await supabase.from('routines')
          .update({ name: name.trim(), description: description.trim() || null, estimated_duration_min: estMin })
          .eq('id', routine.id).eq('gym_id', gymId);
        if (error) throw error;
        // Replace exercises wholesale (RLS allows because created_by = us).
        const { error: delErr } = await supabase.from('routine_exercises').delete().eq('routine_id', routine.id);
        if (delErr) throw delErr;
        logAdminAction('update_class_routine', 'routine', routine.id);
      } else {
        const { data: r, error } = await supabase.from('routines')
          .insert({ gym_id: gymId, created_by: userId, name: name.trim(), description: description.trim() || null, is_template: false, is_public: false, estimated_duration_min: estMin })
          .select('id').single();
        if (error) throw error;
        routineId = r.id;
        logAdminAction('create_class_routine', 'routine', r.id, { name: name.trim() });
      }

      const rows = items.map((it, i) => ({
        routine_id: routineId,
        exercise_id: it.exercise_id,
        position: i,
        target_sets: Number(it.target_sets) || 3,
        target_reps: (it.target_reps || '8-12').toString().slice(0, 20),
        rest_seconds: Number(it.rest_seconds) || 90,
      }));
      const { error: e2 } = await supabase.from('routine_exercises').insert(rows);
      if (e2) throw e2;

      showToast(tc('success'), 'success');
      onSaved();
    } catch (err) {
      console.error('[ClassRoutineBuilder] save error:', err);
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' };
  const labelCls = 'block text-[12.5px] font-bold mb-1';
  const labelStyle = { color: 'var(--color-admin-text-sub)' };

  return (
    <AdminModal isOpen onClose={onClose} title={isEdit ? t('admin.programs.classRoutines.editTitle', 'Edit Class Routine') : t('admin.programs.classRoutines.newTitle', 'New Class Routine')} size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--color-admin-panel)' }}>
          {[
            { k: 'details', label: t('admin.programs.builder.tabDetails', 'Details') },
            { k: 'workouts', label: t('admin.programs.builder.tabWorkouts', 'Workouts') },
          ].map(tab => (
            <button key={tab.k} type="button" onClick={() => setActiveTab(tab.k)}
              className="flex-1 py-2 rounded-lg text-[12.5px] font-bold transition-colors"
              style={activeTab === tab.k
                ? { background: 'var(--color-bg-card)', color: 'var(--color-admin-text)', boxShadow: '0 1px 3px rgba(0,0,0,0.10)' }
                : { color: 'var(--color-admin-text-muted)', background: 'transparent' }}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (<>
        {/* Name */}
        <div>
          <label className={labelCls} style={labelStyle}>{t('admin.programs.classRoutines.name', 'Routine name')} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={100}
            placeholder={t('admin.programs.classRoutines.namePlaceholder', 'e.g. Spin Power 45')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none" style={inputStyle} />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls} style={labelStyle}>{t('admin.programs.classRoutines.description', 'Description')}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} maxLength={500}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none" style={inputStyle} />
        </div>
        </>)}

        {activeTab === 'workouts' && (
        <div>
          <label className={`${labelCls} flex items-center gap-1.5`} style={labelStyle}>
            <Dumbbell size={13} /> {t('admin.programs.classRoutines.exercises', 'Exercises')}
            {items.length > 0 && <span style={{ color: 'var(--color-admin-text-muted)', fontWeight: 600 }}>· {items.length}</span>}
          </label>

          {items.length > 0 && (
            <div className="rounded-xl overflow-hidden mb-2" style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-admin-panel)' }}>
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-admin-border)' }}>
                  <span className="grid place-items-center flex-shrink-0" style={{ width: 22, height: 22, borderRadius: 7, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)', fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 11 }}>{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{exName(it.exercise_id)}</span>
                  {/* sets */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="number" inputMode="numeric" min={1} max={20} value={it.target_sets || ''}
                      onChange={e => updateItem(i, 'target_sets', e.target.value === '' ? '' : Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                      className="w-11 rounded-lg px-1.5 py-1 text-[12px] text-center outline-none tabular-nums" style={inputStyle}
                      aria-label={t('admin.programs.classRoutines.sets', 'Sets')} />
                    <span className="text-[10px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.classRoutines.setsShort', 'sets')}</span>
                  </div>
                  {/* reps */}
                  <input type="text" value={it.target_reps || ''} onChange={e => updateItem(i, 'target_reps', e.target.value.slice(0, 20))}
                    className="w-16 rounded-lg px-2 py-1 text-[12px] text-center outline-none" style={inputStyle}
                    placeholder="8-12" aria-label={t('admin.programs.classRoutines.reps', 'Reps')} />
                  {/* rest */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input type="number" inputMode="numeric" min={0} max={600} step={15} value={it.rest_seconds ?? ''}
                      onChange={e => updateItem(i, 'rest_seconds', e.target.value === '' ? '' : Math.max(0, Math.min(600, parseInt(e.target.value, 10) || 0)))}
                      className="w-14 rounded-lg px-1.5 py-1 text-[12px] text-center outline-none tabular-nums" style={inputStyle}
                      aria-label={t('admin.programs.classRoutines.rest', 'Rest (s)')} />
                    <span className="text-[10px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.classRoutines.restShort', 's')}</span>
                  </div>
                  <button type="button" onClick={() => removeItem(i)} aria-label={tc('delete')}
                    className="flex-shrink-0 transition-colors hover:opacity-80" style={{ color: 'var(--color-danger)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add exercise — opens the browsable/searchable picker */}
          <button type="button" onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors hover:brightness-[1.03]"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px dashed color-mix(in srgb, var(--color-accent) 45%, transparent)' }}>
            <Plus size={15} strokeWidth={2.6} /> {t('admin.programs.classRoutines.addExercise', 'Add exercise')}
          </button>
          {items.length === 0 && (
            <p className="text-[11.5px] italic mt-1.5" style={{ color: 'var(--color-admin-text-faint)' }}>
              {t('admin.programs.classRoutines.hint', 'Add exercises with their sets, reps and rest. This routine can then be attached to a class.')}
            </p>
          )}
        </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 text-[13px] font-bold transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-admin-text-sub)', background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 999 }}>
          {tc('cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-bold disabled:opacity-50 transition-all hover:brightness-[1.04]"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={2.6} />}
          {saving ? tc('saving') : isEdit ? tc('save') : t('admin.programs.classRoutines.create', 'Create routine')}
        </button>
      </div>

      <ExercisePicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onAdd={addExercise}
        addedIds={items.map(it => it.exercise_id)}
        t={t}
      />
    </AdminModal>
  );
}
