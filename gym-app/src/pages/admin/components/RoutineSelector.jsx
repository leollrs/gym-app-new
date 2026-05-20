import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dumbbell, Search } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';

/**
 * Search-and-pick selector for attaching a workout routine to a class.
 *
 * Lists routines owned by this gym, with their exercise count. Search is
 * client-side because the routine count per gym is small (typically <100).
 * Routine creation lives in the Workouts section — this picker only
 * attaches existing routines, showing a hint in the empty state.
 */
export default function RoutineSelector({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data: routines = [] } = useQuery({
    queryKey: adminKeys.classes.routines(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(count)')
        .eq('gym_id', gymId)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = routines.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selected = routines.find(r => r.id === value);

  return (
    <div ref={wrapperRef}>
      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.classes.workoutTemplate')}
      </label>
      {selected ? (
        <div className="flex items-center gap-2 p-2.5 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <Dumbbell size={14} className="flex-shrink-0" style={{ color: 'var(--color-accent, #D4AF37)' }} />
          <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {selected.name}
            <span className="ml-1.5" style={{ color: 'var(--color-text-muted)' }}>
              ({selected.routine_exercises?.[0]?.count || 0} {t('admin.classes.exercises', 'exercises')})
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium transition-colors"
            style={{ color: 'var(--color-danger, #EF4444)' }}
          >
            {t('admin.classes.removeTemplate')}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5 relative">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={t('admin.classes.selectTemplate')}
              aria-label={t('admin.classes.selectTemplate')}
              className="w-full rounded-xl pl-8 pr-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          {open && filtered.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl shadow-xl"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors flex items-center gap-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <Dumbbell size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {r.routine_exercises?.[0]?.count || 0}
                  </span>
                </button>
              ))}
              {/* Create new routine hint */}
              <div className="px-3 py-2 text-[11px] italic" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border-subtle)' }}>
                {t('admin.classes.createRoutineHint', 'To create a new routine, use the Workouts section')}
              </div>
            </div>
          )}
          {open && filtered.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl shadow-xl p-3"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noTemplate')}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.createRoutineHint', 'To create a new routine, use the Workouts section')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
