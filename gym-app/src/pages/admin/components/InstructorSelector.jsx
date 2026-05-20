import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

/**
 * Multi-pick selector for class instructors (trainers + admins).
 *
 * Renders a chip row for currently-assigned people plus a search input
 * to add more. People are fetched from `profiles` filtered to
 * role IN ('admin', 'trainer') — gyms with mixed staff can have either
 * lead a class.
 */
export default function InstructorSelector({ gymId, values = [], onChange, t }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data: people = [] } = useQuery({
    queryKey: ['admin', 'gym-people', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .eq('gym_id', gymId)
        .in('role', ['admin', 'trainer'])
        .order('full_name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const selectedIds = new Set(values);
  const selectedPeople = people.filter(p => selectedIds.has(p.id));
  const filtered = people.filter(p =>
    !selectedIds.has(p.id) &&
    p.full_name?.toLowerCase().includes(search.toLowerCase()),
  );

  const roleBadge = (role) => {
    const colors = { admin: 'admin-pill admin-pill--hot', trainer: 'admin-pill admin-pill--warn' };
    return colors[role] || 'admin-pill admin-pill--info';
  };

  const addPerson = (p) => {
    onChange([...values, p.id]);
    setSearch('');
    setOpen(false);
  };
  const removePerson = (id) => {
    onChange(values.filter(v => v !== id));
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.instructor')}</label>

      {/* Selected trainer chips */}
      {selectedPeople.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedPeople.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg text-[12px]"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.full_name || ''} className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <div className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)' }}>
                  <span className="text-[8px] font-bold" style={{ color: 'var(--color-accent, #D4AF37)' }}>{p.full_name?.[0]?.toUpperCase() || '?'}</span>
                </div>
              )}
              <span>{p.full_name}</span>
              <button type="button" onClick={() => removePerson(p.id)}
                aria-label={t('admin.classes.clearInstructor', 'Remove trainer')}
                className="hover:text-red-400 transition-colors">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search to add another */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedPeople.length > 0
            ? t('admin.classes.addAnotherInstructor', 'Add another trainer...')
            : t('admin.classes.searchInstructor', 'Search trainers, admins...')}
          aria-label={t('admin.classes.searchInstructor', 'Search trainers, admins...')}
          className="w-full rounded-xl pl-8 pr-3 py-2.5 text-[13px] outline-none transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
        />
        {open && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl shadow-xl"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-2.5 text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noMatchingPeople', 'No matching people')}</p>
            ) : (
              filtered.slice(0, 30).map(p => (
                <button key={p.id} type="button"
                  onClick={() => addPerson(p)}
                  className="flex items-center gap-2 w-full px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-left transition-colors">
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={p.full_name || t('admin.classes.trainerAvatarAlt', 'Trainer avatar')} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)' }}>
                      <span className="text-[8px] font-bold" style={{ color: 'var(--color-accent, #D4AF37)' }}>{p.full_name?.[0]?.toUpperCase() || '?'}</span>
                    </div>
                  )}
                  <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</span>
                  <span className={`${roleBadge(p.role)}`}>
                    {p.role}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
