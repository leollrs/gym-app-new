import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, Dumbbell, Info, Plus, Bookmark, Check, Users } from 'lucide-react';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT, CATEGORIES } from '../data/exercises';
import BodyDiagram from '../components/BodyDiagram';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const MUSCLE_COLORS = {
  Chest:      'text-red-300 bg-red-500/15',
  Back:       'text-blue-300 bg-blue-500/15',
  Shoulders:  'text-[#D4AF37] bg-[#D4AF37]/15',
  Biceps:     'text-amber-300 bg-amber-500/15',
  Triceps:    'text-orange-300 bg-orange-500/15',
  Legs:       'text-emerald-300 bg-emerald-500/15',
  Glutes:     'text-orange-300 bg-orange-500/12',
  Core:       'text-sky-300 bg-sky-500/15',
  Calves:     'text-green-300 bg-green-500/15',
  'Full Body':'text-[#CBD5E1] bg-white/8',
};

const ExerciseCard = ({ exercise, onSelect, selectable }) => {
  const [expanded, setExpanded] = useState(false);
  const colorClass = MUSCLE_COLORS[exercise.muscle] || 'text-[#D4AF37] bg-[#D4AF37]/15';

  // ── SELECTABLE MODE: tap card to expand, tap + to add ───────────────────
  if (selectable) {
    return (
      <div
        className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden transition-all"
      >
        <div
          className="flex items-center gap-4 px-5 py-4 cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          {/* Coloured icon */}
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
            <Dumbbell size={19} strokeWidth={2} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-[15px] truncate">{exercise.name}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
                {exercise.muscle}
              </span>
              <span className="text-[12px] text-[#9CA3AF]">{exercise.equipment}</span>
            </div>
          </div>

          {/* Add button */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            style={{ background: 'rgba(212,175,55,0.18)', border: '1.5px solid rgba(212,175,55,0.5)' }}
          >
            <Plus size={18} strokeWidth={2.5} style={{ color: '#D4AF37' }} />
          </button>
        </div>

        {expanded && (
          <div className="px-5 pb-5 pt-3 border-t border-white/5">
            <div className="flex gap-2.5 text-[#CBD5E1] text-[13px] leading-relaxed">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
              <p>{exercise.instructions}</p>
            </div>
            <div className="flex gap-5 mt-4 text-[12px] text-[#9CA3AF]">
              <span>Default: <span className="text-[#E5E7EB] font-semibold">{exercise.defaultSets} sets</span></span>
              <span>Reps: <span className="text-[#E5E7EB] font-semibold">{exercise.defaultReps}</span></span>
              <span>Category: <span className="text-[#E5E7EB] font-semibold">{exercise.category}</span></span>
            </div>
            {exercise.primaryRegions?.length > 0 && (
              <div className="mt-4">
                <BodyDiagram
                  compact
                  title="Muscles worked"
                  primaryRegions={exercise.primaryRegions}
                  secondaryRegions={exercise.secondaryRegions ?? []}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── BROWSE MODE: expandable card ─────────────────────────────────────────
  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/6 overflow-hidden transition-colors hover:border-white/12">
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
          <Dumbbell size={19} strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-[15px] truncate">{exercise.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
              {exercise.muscle}
            </span>
            <span className="text-[12px] text-[#9CA3AF]">{exercise.equipment}</span>
          </div>
        </div>

        <ChevronDown
          size={16}
          className={`text-[#6B7280] transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="px-5 pb-5 pt-3 border-t border-white/5">
          <div className="flex gap-2.5 text-[#CBD5E1] text-[13px] leading-relaxed">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
            <p>{exercise.instructions}</p>
          </div>
          <div className="flex gap-5 mt-4 text-[12px] text-[#9CA3AF]">
            <span>Default: <span className="text-[#E5E7EB] font-semibold">{exercise.defaultSets} sets</span></span>
            <span>Reps: <span className="text-[#E5E7EB] font-semibold">{exercise.defaultReps}</span></span>
            <span>Category: <span className="text-[#E5E7EB] font-semibold">{exercise.category}</span></span>
          </div>
          {exercise.primaryRegions?.length > 0 && (
            <div className="mt-4">
              <BodyDiagram
                compact
                title="Muscles worked"
                primaryRegions={exercise.primaryRegions}
                secondaryRegions={exercise.secondaryRegions ?? []}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ExerciseLibrary = ({ onSelect, selectable = false, selectedIds = [], extraExercises = [] }) => {
  const [query, setQuery] = useState('');
  const [activeMuscle, setActiveMuscle] = useState('All');
  const [activeEquipment, setActiveEquipment] = useState('All');

  const allExercises = useMemo(() => [...localExercises, ...extraExercises], [extraExercises]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allExercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesMuscle    = activeMuscle    === 'All' || e.muscle    === activeMuscle;
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      return matchesQuery && matchesMuscle && matchesEquipment;
    });
  }, [query, activeMuscle, activeEquipment]);

  const grouped = useMemo(() => {
    if (activeMuscle !== 'All') return { [activeMuscle]: filtered };
    return filtered.reduce((acc, ex) => {
      if (!acc[ex.muscle]) acc[ex.muscle] = [];
      acc[ex.muscle].push(ex);
      return acc;
    }, {});
  }, [filtered, activeMuscle]);

  return (
    <div className="animate-fade-in">
      {/* Search bar */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full bg-[#111827] border border-white/12 rounded-xl pl-10 pr-10 py-3 text-[14px] text-white placeholder-[#6B7280] focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-white transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Muscle group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none mb-3">
        {['All', ...MUSCLE_GROUPS].map(m => (
          <button
            key={m}
            onClick={() => setActiveMuscle(m)}
            className={`flex-shrink-0 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-colors ${
              activeMuscle === m
                ? 'bg-[#D4AF37] text-black'
                : 'bg-white/8 text-[#CBD5E1] hover:bg-white/14 hover:text-white'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Equipment filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none mb-6">
        {['All', ...EQUIPMENT].map(eq => (
          <button
            key={eq}
            onClick={() => setActiveEquipment(eq)}
            className={`flex-shrink-0 text-[12px] font-semibold px-3.5 py-1.5 rounded-full border transition-colors ${
              activeEquipment === eq
                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border-[#D4AF37]/40'
                : 'bg-white/6 text-[#CBD5E1] border-white/10 hover:bg-white/12 hover:text-white'
            }`}
          >
            {eq}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-[12px] text-[#9CA3AF] mb-6">
        {filtered.length} exercise{filtered.length !== 1 ? 's' : ''} of {allExercises.length}
        {query && ` matching "${query}"`}
      </p>

      {/* Exercise groups */}
      <div className="flex flex-col gap-8">
        {Object.entries(grouped).map(([muscle, exs]) => (
          <section key={muscle}>
            {activeMuscle === 'All' && (
              <h3 className="section-label mb-3">{muscle}</h3>
            )}
            <div className="flex flex-col gap-3">
              {exs.map(ex => (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  selectable={selectable && !selectedIds.includes(ex.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-20 text-[#6B7280]">
            <Dumbbell size={40} className="mx-auto mb-4 opacity-20" />
            <p className="text-[15px]">No exercises found</p>
            <p className="text-[13px] mt-1">Try a different search or filter</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Custom Exercise Card (Mine / Friends tabs) ────────────────────────────────
const CustomExerciseCard = ({ exercise, isMine, isSaved, onSave }) => {
  const [expanded, setExpanded] = useState(false);
  const colorClass = MUSCLE_COLORS[exercise.muscle] || 'text-[#D4AF37] bg-[#D4AF37]/15';

  return (
    <div className="rounded-[14px] border overflow-hidden transition-all"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
          <Dumbbell size={19} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--text-primary)' }}>
            {exercise.name}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
              {exercise.muscle}
            </span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{exercise.equipment}</span>
            {!isMine && exercise.createdByName && (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                by @{exercise.createdByUsername ?? exercise.createdByName}
              </span>
            )}
            {isMine && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(212,175,55,0.12)', color: 'var(--accent-gold)' }}>
                Created by you
              </span>
            )}
          </div>
        </div>
        {!isMine && !isSaved && onSave && (
          <button onClick={e => { e.stopPropagation(); onSave(); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0"
            style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', color: 'var(--accent-gold)' }}>
            <Bookmark size={12} /> Save
          </button>
        )}
        {isSaved && !isMine && (
          <span className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0"
            style={{ color: '#10B981' }}>
            <Check size={11} /> Saved
          </span>
        )}
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }} />
      </div>

      {expanded && (
        <div className="px-5 pb-5 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {exercise.instructions && (
            <div className="flex gap-2.5 text-[13px] leading-relaxed mb-3"
              style={{ color: 'var(--text-secondary)' }}>
              <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-gold)' }} />
              <p>{exercise.instructions}</p>
            </div>
          )}
          <div className="flex gap-5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>Default: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{exercise.defaultSets} sets</span></span>
            <span>Reps: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{exercise.defaultReps}</span></span>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Normalize a DB exercise row to frontend format ────────────────────────────
const normalizeDbExercise = (row) => ({
  id:               row.id,
  name:             row.name,
  muscle:           row.muscle_group,
  equipment:        row.equipment,
  category:         row.category,
  defaultSets:      row.default_sets,
  defaultReps:      row.default_reps,
  restSeconds:      row.rest_seconds,
  instructions:     row.instructions ?? '',
  primaryRegions:   row.primary_regions   ?? [],
  secondaryRegions: row.secondary_regions ?? [],
  createdBy:        row.created_by,
  createdByName:    row.profiles?.full_name,
  createdByUsername:row.profiles?.username,
  isCustom:         true,
});

// ── Add Exercise Modal ────────────────────────────────────────────────────────
const AddExerciseModal = ({ onSave, onClose }) => {
  const [form, setForm] = useState({
    name: '', muscle: MUSCLE_GROUPS[0], equipment: EQUIPMENT[0],
    category: CATEGORIES[0], defaultSets: '3', defaultReps: '8-12', instructions: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    const result = await onSave({
      ...form,
      name:        form.name.trim(),
      defaultSets: parseInt(form.defaultSets) || 3,
    });
    if (result?.error) setError(result.error);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[480px] rounded-[20px] p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-[18px]" style={{ color: 'var(--text-primary)' }}>New Exercise</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70">
            <X size={18} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-muted)' }}>Exercise Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Bulgarian Split Squat"
              className="w-full rounded-xl px-3 py-2.5 text-[14px] focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Muscle + Equipment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Muscle Group</label>
              <select value={form.muscle} onChange={e => set('muscle', e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                {MUSCLE_GROUPS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Equipment</label>
              <select value={form.equipment} onChange={e => set('equipment', e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                {EQUIPMENT.map(eq => <option key={eq} value={eq}>{eq}</option>)}
              </select>
            </div>
          </div>

          {/* Sets + Reps */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Default Sets</label>
              <input type="number" min="1" max="10" value={form.defaultSets}
                onChange={e => set('defaultSets', e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Default Reps</label>
              <input value={form.defaultReps} onChange={e => set('defaultReps', e.target.value)}
                placeholder="8-12"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-muted)' }}>Instructions (optional)</label>
            <textarea
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder="How to perform this exercise…"
              rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] focus:outline-none resize-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-semibold text-[14px] disabled:opacity-50 active:scale-95 transition-all"
            style={{ background: 'var(--accent-gold)', color: '#000' }}>
            {saving ? 'Saving…' : 'Add Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Full-page wrapper ─────────────────────────────────────────────────────────
export const ExerciseLibraryPage = () => {
  const { user, profile } = useAuth();
  const [tab, setTab]               = useState('all');   // 'all' | 'mine' | 'friends'
  const [customExercises, setCustom] = useState([]);
  const [savedIds, setSavedIds]      = useState(new Set());
  const [friendIds, setFriendIds]    = useState(new Set());
  const [loading, setLoading]        = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    if (!user || !profile) return;
    setLoading(true);

    // Custom exercises for this gym (with creator profile)
    const { data: customs } = await supabase
      .from('exercises')
      .select('*, profiles!created_by(full_name, username)')
      .eq('gym_id', profile.gym_id)
      .eq('is_active', true);

    // My saved exercises
    const { data: saved } = await supabase
      .from('user_saved_exercises')
      .select('exercise_id')
      .eq('user_id', user.id);

    // Accepted friend IDs
    const { data: fships } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq('status', 'accepted');

    const fIds = new Set((fships ?? []).map(f =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    ));

    setCustom((customs ?? []).map(normalizeDbExercise));
    setSavedIds(new Set((saved ?? []).map(s => s.exercise_id)));
    setFriendIds(fIds);
    setLoading(false);
  }, [user, profile]);

  useEffect(() => { load(); }, [load]);

  const handleCreateExercise = async (form) => {
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const { error } = await supabase
      .from('exercises')
      .insert({
        id,
        gym_id:       profile.gym_id,
        created_by:   user.id,
        name:         form.name,
        muscle_group: form.muscle,
        equipment:    form.equipment,
        category:     form.category,
        default_sets: form.defaultSets,
        default_reps: form.defaultReps,
        rest_seconds: 90,
        instructions: form.instructions || null,
        is_active:    true,
      });

    if (error) {
      console.error('Create exercise error:', error);
      return { error: error.message };
    }

    // Auto-save to user_saved_exercises
    await supabase.from('user_saved_exercises').insert({ user_id: user.id, exercise_id: id });

    // Build normalized object from known form data (no extra DB round-trip)
    const normalized = {
      id,
      name:              form.name,
      muscle:            form.muscle,
      equipment:         form.equipment,
      category:          form.category,
      defaultSets:       form.defaultSets,
      defaultReps:       form.defaultReps,
      restSeconds:       90,
      instructions:      form.instructions ?? '',
      primaryRegions:    [],
      secondaryRegions:  [],
      createdBy:         user.id,
      createdByName:     profile.full_name,
      createdByUsername: profile.username,
      isCustom:          true,
    };

    setCustom(prev => [...prev, normalized]);
    setSavedIds(prev => new Set([...prev, id]));
    setShowAddModal(false);
    return {};
  };

  const handleSave = async (exerciseId) => {
    setSavedIds(prev => new Set([...prev, exerciseId]));
    await supabase.from('user_saved_exercises').insert({ user_id: user.id, exercise_id: exerciseId });
  };

  // Which custom exercises to show per tab
  const mineExercises    = customExercises.filter(e =>
    e.createdBy === user?.id || savedIds.has(e.id)
  );
  const friendExercises  = customExercises.filter(e =>
    friendIds.has(e.createdBy) && !savedIds.has(e.id)
  );
  const extraForAll = customExercises; // all custom visible in All tab

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: 'var(--text-primary)', fontFamily: "'Barlow Condensed', sans-serif" }}>
            Exercises
          </h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {localExercises.length + customExercises.length} exercises available
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold active:scale-95 transition-all"
          style={{ background: 'var(--accent-gold)', color: '#000' }}
        >
          <Plus size={14} /> New Exercise
        </button>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 rounded-xl p-1"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
        {[
          { key: 'all',     label: 'All' },
          { key: 'mine',    label: `Mine${mineExercises.length ? ` · ${mineExercises.length}` : ''}` },
          { key: 'friends', label: `Friends${friendExercises.length ? ` · ${friendExercises.length}` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all"
            style={{
              background: tab === t.key ? 'var(--bg-card)' : 'transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* All tab */}
      {tab === 'all' && (
        <ExerciseLibrary extraExercises={extraForAll} />
      )}

      {/* Mine tab */}
      {tab === 'mine' && !loading && (
        mineExercises.length === 0 ? (
          <div className="text-center py-20">
            <Dumbbell size={40} className="mx-auto mb-4 opacity-20" style={{ color: 'var(--text-muted)' }} />
            <p className="font-semibold text-[16px]" style={{ color: 'var(--text-secondary)' }}>No custom exercises yet</p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              Create your own or save exercises from friends.
            </p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold active:scale-95 transition-all"
              style={{ background: 'var(--accent-gold)', color: '#000' }}>
              <Plus size={14} /> New Exercise
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {mineExercises.map(ex => (
              <CustomExerciseCard key={ex.id} exercise={ex} isMine={ex.createdBy === user?.id} isSaved />
            ))}
          </div>
        )
      )}

      {/* Friends tab */}
      {tab === 'friends' && !loading && (
        friendExercises.length === 0 ? (
          <div className="text-center py-20">
            <Users size={40} className="mx-auto mb-4 opacity-20" style={{ color: 'var(--text-muted)' }} />
            <p className="font-semibold text-[16px]" style={{ color: 'var(--text-secondary)' }}>No friend exercises yet</p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              When friends add custom exercises, they'll appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {friendExercises.map(ex => (
              <CustomExerciseCard key={ex.id} exercise={ex} isMine={false} isSaved={savedIds.has(ex.id)}
                onSave={() => handleSave(ex.id)} />
            ))}
          </div>
        )
      )}

      {showAddModal && (
        <AddExerciseModal onSave={handleCreateExercise} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
};

export default ExerciseLibrary;
