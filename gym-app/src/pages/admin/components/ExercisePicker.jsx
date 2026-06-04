import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Check, Plus, Dumbbell } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { exName as exNameLocalized } from '../../../lib/exerciseName';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

// Preferred muscle-group chip order; anything else is appended after.
const MUSCLE_ORDER = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes',
  'Core', 'Calves', 'Forearms', 'Traps', 'Full Body', 'Cardio', 'Warm-Up',
];

/**
 * Browsable + searchable exercise picker.
 *
 * Replaces the old "type the name into a <select>" UX. Lets the admin browse by
 * muscle group and equipment, search by EN or ES name, and add multiple
 * exercises in a row without the sheet closing. Self-contained (own query,
 * cached under the shared key) and rendered as a high-z overlay so it can sit
 * on top of any parent modal.
 *
 * Props:
 *   isOpen, onClose
 *   onAdd(exerciseRow)  — called with the full exercises row (id, name, name_es,
 *                         muscle_group, equipment, default_sets/reps, rest_seconds)
 *   addedIds            — Set | array of exercise ids already in the routine
 *   t                   — i18n t() from the 'pages' namespace
 */
export default function ExercisePicker({ isOpen, onClose, onAdd, addedIds, t }) {
  const [search, setSearch] = useState('');
  const [muscle, setMuscle] = useState('all');
  const [equipment, setEquipment] = useState('all');
  const [justAdded, setJustAdded] = useState(null);

  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['exercises-library-picker'],
    queryFn: async () => {
      const { data } = await supabase
        .from('exercises')
        .select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds')
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const added = addedIds instanceof Set ? addedIds : new Set(addedIds || []);

  const muscles = useMemo(() => {
    const present = new Set(exercises.map(e => e.muscle_group).filter(Boolean));
    const ordered = MUSCLE_ORDER.filter(m => present.has(m));
    const extra = [...present].filter(m => !MUSCLE_ORDER.includes(m)).sort();
    return ['all', ...ordered, ...extra];
  }, [exercises]);

  const equipmentList = useMemo(() => {
    const present = new Set(exercises.map(e => e.equipment).filter(Boolean));
    return ['all', ...[...present].sort()];
  }, [exercises]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exercises.filter(e => {
      if (muscle !== 'all' && e.muscle_group !== muscle) return false;
      if (equipment !== 'all' && e.equipment !== equipment) return false;
      if (!q) return true;
      return (e.name || '').toLowerCase().includes(q)
        || (e.name_es || '').toLowerCase().includes(q)
        || (e.muscle_group || '').toLowerCase().includes(q)
        || (e.equipment || '').toLowerCase().includes(q);
    });
  }, [exercises, search, muscle, equipment]);

  if (!isOpen) return null;

  const handleAdd = (ex) => {
    onAdd(ex);
    setJustAdded(ex.id);
    setTimeout(() => setJustAdded(p => (p === ex.id ? null : p)), 700);
  };

  const chip = (active) => ({
    padding: '5px 11px',
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'all .15s',
    border: '1px solid',
    borderColor: active ? 'var(--color-accent)' : 'var(--color-admin-border)',
    background: active ? 'var(--color-accent)' : 'var(--color-bg-card)',
    color: active ? '#fff' : 'var(--color-admin-text-sub)',
  });

  const muscleLabel = (m) =>
    m === 'all' ? t('admin.programs.picker.allMuscles', 'All') : t(`admin.programs.picker.muscle.${m}`, m);
  const equipLabel = (e) =>
    e === 'all' ? t('admin.programs.picker.allEquipment', 'All equipment') : t(`admin.programs.picker.equip.${e}`, e);

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center"
      style={{ zIndex: 200, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full sm:max-w-lg flex flex-col overflow-hidden"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-admin-border)',
          borderRadius: 20,
          maxHeight: '88vh',
          margin: '0 0 env(safe-area-inset-bottom, 0px) 0',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
          <div className="flex items-center gap-2">
            <span className="grid place-items-center" style={{ width: 28, height: 28, borderRadius: 9, background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
              <Dumbbell size={15} style={{ color: 'var(--color-accent)' }} />
            </span>
            <span style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 16, color: 'var(--color-admin-text)' }}>
              {t('admin.programs.picker.title', 'Add exercises')}
            </span>
          </div>
          <button onClick={onClose} aria-label={t('admin.programs.picker.done', 'Done')}
            className="grid place-items-center transition-colors hover:opacity-80"
            style={{ width: 32, height: 32, borderRadius: 9, color: 'var(--color-admin-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 flex-shrink-0">
          <div className="flex items-center gap-2 px-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', borderRadius: 11, height: 40 }}>
            <Search size={15} style={{ color: 'var(--color-admin-text-muted)' }} />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('admin.programs.picker.searchPlaceholder', 'Search by name, muscle, equipment…')}
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--color-admin-text)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label={t('common:clear', 'Clear')} style={{ color: 'var(--color-admin-text-muted)' }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Muscle chips */}
        <div className="px-4 pt-2.5 flex gap-1.5 overflow-x-auto scrollbar-hide flex-shrink-0">
          {muscles.map(m => (
            <button key={m} onClick={() => setMuscle(m)} style={chip(muscle === m)}>{muscleLabel(m)}</button>
          ))}
        </div>

        {/* Equipment chips */}
        <div className="px-4 pt-1.5 pb-2.5 flex gap-1.5 overflow-x-auto scrollbar-hide flex-shrink-0" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
          {equipmentList.map(eq => (
            <button key={eq} onClick={() => setEquipment(eq)} style={{ ...chip(equipment === eq), fontSize: 11, opacity: equipment === eq ? 1 : 0.92 }}>{equipLabel(eq)}</button>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2" style={{ minHeight: 160 }}>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)', borderTopColor: 'var(--color-accent)' }} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Search size={22} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.picker.noResults', 'No exercises match')}</p>
            </div>
          ) : (
            filtered.map(ex => {
              const isAdded = added.has(ex.id);
              const flash = justAdded === ex.id;
              return (
                <button
                  key={ex.id}
                  onClick={() => handleAdd(ex)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors text-left"
                  style={{ background: flash ? 'color-mix(in srgb, var(--color-success) 16%, transparent)' : 'transparent' }}
                >
                  <span className="grid place-items-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--color-admin-panel)' }}>
                    <Dumbbell size={14} style={{ color: 'var(--color-admin-text-sub)' }} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{exNameLocalized(ex)}</p>
                    <p className="truncate text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {t(`admin.programs.picker.muscle.${ex.muscle_group}`, ex.muscle_group)}
                      {ex.equipment ? ` · ${t(`admin.programs.picker.equip.${ex.equipment}`, ex.equipment)}` : ''}
                    </p>
                  </div>
                  <span
                    className="grid place-items-center flex-shrink-0 transition-colors"
                    style={{
                      width: 30, height: 30, borderRadius: 9,
                      background: (isAdded || flash) ? 'color-mix(in srgb, var(--color-success) 18%, transparent)' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                      color: (isAdded || flash) ? 'var(--color-success)' : 'var(--color-accent)',
                    }}
                  >
                    {(isAdded || flash) ? <Check size={16} strokeWidth={2.8} /> : <Plus size={16} strokeWidth={2.8} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
          <button onClick={onClose}
            className="w-full py-2.5 text-[13px] font-bold transition-all hover:brightness-[1.04]"
            style={{ background: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 30%, transparent)' }}>
            {t('admin.programs.picker.done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
}
