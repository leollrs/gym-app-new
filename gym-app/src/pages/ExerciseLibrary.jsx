import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, X, ChevronDown, Dumbbell, Info, Plus, Bookmark, Check, Users, Play } from 'lucide-react';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT, CATEGORIES } from '../data/exercises';
import BodyDiagram from '../components/BodyDiagram';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const MUSCLE_COLORS = {
  Chest:       { bg: 'rgba(239,68,68,0.15)',   text: '#F87171' },
  Back:        { bg: 'rgba(59,130,246,0.15)',   text: '#60A5FA' },
  Shoulders:   { bg: 'rgba(212,175,55,0.15)',   text: '#D4AF37' },
  Biceps:      { bg: 'rgba(212,175,55,0.15)',   text: '#D4AF37' },
  Triceps:     { bg: 'rgba(251,146,60,0.15)',   text: '#FB923C' },
  Legs:        { bg: 'rgba(16,185,129,0.15)',   text: '#34D399' },
  Glutes:      { bg: 'rgba(251,146,60,0.15)',   text: '#FB923C' },
  Core:        { bg: 'rgba(14,165,233,0.15)',   text: '#38BDF8' },
  Calves:      { bg: 'rgba(16,185,129,0.15)',   text: '#34D399' },
  'Full Body': { bg: 'rgba(107,114,128,0.15)',  text: '#9CA3AF' },
};

const ExerciseCard = ({ exercise, onSelect, selectable }) => {
  const [expanded, setExpanded] = useState(false);
  const colors = MUSCLE_COLORS[exercise.muscle] || { bg: 'rgba(212,175,55,0.15)', text: '#D4AF37' };

  const cardContent = (
    <>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[16px] leading-tight text-[#E5E7EB]">
          {exercise.name}
        </p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
            style={{ background: colors.bg, color: colors.text }}
          >
            {exercise.muscle}
          </span>
          <span className="text-[12px] text-[#6B7280]">
            {exercise.equipment}
          </span>
        </div>
      </div>
      <ChevronDown
        size={18}
        className={`flex-shrink-0 transition-transform duration-200 text-[#9CA3AF] ${expanded ? 'rotate-180' : ''}`}
      />
    </>
  );

  // ── SELECTABLE MODE: tap card to expand, tap + to add ───────────────────
  if (selectable) {
    return (
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
        <div
          className="flex items-center gap-4 px-4 py-4 cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: colors.bg }}
          >
            <Dumbbell size={18} strokeWidth={2} style={{ color: colors.text }} />
          </div>
          {cardContent}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            style={{ background: 'rgba(212,175,55,0.18)', border: '1.5px solid rgba(212,175,55,0.5)' }}
          >
            <Plus size={16} strokeWidth={2.5} style={{ color: '#D4AF37' }} />
          </button>
        </div>
        {expanded && (
          <div className="px-4 pb-4 pt-3 border-t border-white/8">
            <div className="flex gap-2.5 text-[13px] leading-relaxed text-[#9CA3AF]">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
              <p>{exercise.instructions}</p>
            </div>
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <div className="flex gap-5 text-[12px] text-[#6B7280]">
                <span>Default: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultSets} sets</span></span>
                <span>Reps: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultReps}</span></span>
                <span>Category: <span className="font-semibold text-[#E5E7EB]">{exercise.category}</span></span>
              </div>

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
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden hover:border-white/12 transition-colors">
      <div
        className="flex items-center gap-4 px-4 py-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: colors.bg }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: colors.text }} />
        </div>
        {cardContent}
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t border-white/8">
          <div className="flex gap-2.5 text-[13px] leading-relaxed text-[#9CA3AF]">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
            <p>{exercise.instructions}</p>
          </div>
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <div className="flex gap-5 text-[12px] text-[#6B7280]">
              <span>Default: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultSets} sets</span></span>
              <span>Reps: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultReps}</span></span>
              <span>Category: <span className="font-semibold text-[#E5E7EB]">{exercise.category}</span></span>
            </div>
          </div>
          {exercise.videoUrl && (
            <div className="mt-4 rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
              <video
                src={exercise.videoUrl}
                controls
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          )}
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
        <Search
          size={15}
          className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#9CA3AF]"
        />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          aria-label="Search exercises"
          className="w-full rounded-xl pl-10 pr-10 py-3 text-[14px] focus:outline-none transition-colors bg-[#111827] border border-white/6 text-[#E5E7EB] placeholder-[#4B5563]"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors text-[#9CA3AF] hover:text-[#E5E7EB]"
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
            className={`flex-shrink-0 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-colors border ${
              activeMuscle === m
                ? 'bg-[#D4AF37] text-black border-[#D4AF37]'
                : 'bg-[#111827] text-[#6B7280] border-white/8'
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
                ? 'bg-[#D4AF37] text-black border-[#D4AF37]'
                : 'bg-[#111827] text-[#6B7280] border-white/8'
            }`}
          >
            {eq}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-[12px] mb-5 font-medium text-[#6B7280]">
        {filtered.length} of {allExercises.length} exercises
        {query && <span> · "{query}"</span>}
      </p>

      {/* Exercise groups */}
      <div className="flex flex-col gap-6">
        {Object.entries(grouped).map(([muscle, exs]) => (
          <section key={muscle}>
            {activeMuscle === 'All' && (
              <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] mb-3 text-[#6B7280]">
                {muscle}
              </h3>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
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
  const colors = MUSCLE_COLORS[exercise.muscle] || { bg: 'rgba(212,175,55,0.15)', text: '#D4AF37' };

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden hover:border-white/20 hover:bg-white/[0.03] transition-all">
      <div className="flex items-center gap-4 px-4 py-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: colors.bg }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: colors.text }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[16px] leading-tight text-[#E5E7EB]">
            {exercise.name}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: colors.bg, color: colors.text }}
            >
              {exercise.muscle}
            </span>
            <span className="text-[12px] text-[#6B7280]">{exercise.equipment}</span>
            {!isMine && exercise.createdByName && (
              <span className="text-[11px] text-[#6B7280]">
                by @{exercise.createdByUsername ?? exercise.createdByName}
              </span>
            )}
            {isMine && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37]">
                Created by you
              </span>
            )}
          </div>
        </div>
        {!isMine && !isSaved && onSave && (
          <button onClick={e => { e.stopPropagation(); onSave(); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0 bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37]">
            <Bookmark size={12} /> Save
          </button>
        )}
        {isSaved && !isMine && (
          <span className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0 text-[#10B981]">
            <Check size={11} /> Saved
          </span>
        )}
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform duration-200 text-[#6B7280] ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {expanded && (
        <div className="px-5 pb-5 pt-3 border-t border-white/8">
          {exercise.instructions && (
            <div className="flex gap-2.5 text-[13px] leading-relaxed mb-3 text-[#9CA3AF]">
              <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
              <p>{exercise.instructions}</p>
            </div>
          )}
          <div className="flex gap-5 text-[12px] text-[#6B7280]">
            <span>Default: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultSets} sets</span></span>
            <span>Reps: <span className="font-semibold text-[#E5E7EB]">{exercise.defaultReps}</span></span>
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

// ── Custom dropdown for Add Exercise modal ──────────────────────────────────────
const DropdownSelect = ({ value, options, onChange, placeholder, label }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#9CA3AF]">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-3 text-left text-[14px] flex items-center justify-between min-h-[44px] focus:outline-none transition-colors text-[#E5E7EB]"
      >
        <span>{value || placeholder}</span>
        <ChevronDown size={16} className={`flex-shrink-0 transition-transform text-[#6B7280] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 bg-[#111827] border border-white/8 rounded-xl shadow-lg overflow-hidden z-10 max-h-[200px] overflow-y-auto"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full px-3 py-3 text-left text-[14px] hover:bg-white/5 transition-colors"
              style={{ color: value === opt ? '#D4AF37' : '#E5E7EB' }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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

  useEffect(() => {
    const prevScroll = window.scrollY || 0;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, prevScroll);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center px-4 pb-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', paddingTop: '20vh' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[480px] bg-[#0F172A] border border-white/8 rounded-[20px] p-6 max-h-[80vh] overflow-y-auto">

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-[18px] text-[#E5E7EB]">New Exercise</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70">
            <X size={18} className="text-[#9CA3AF]" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#9CA3AF]">
              Exercise Name *
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Bulgarian Split Squat"
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[14px] focus:outline-none text-[#E5E7EB] placeholder-[#4B5563]"
            />
          </div>

          {/* Muscle + Equipment */}
          <div className="grid grid-cols-2 gap-3">
            <DropdownSelect
              label="Muscle Group"
              value={form.muscle}
              options={MUSCLE_GROUPS}
              onChange={(v) => set('muscle', v)}
            />
            <DropdownSelect
              label="Equipment"
              value={form.equipment}
              options={EQUIPMENT}
              onChange={(v) => set('equipment', v)}
            />
          </div>

          {/* Sets + Reps */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#9CA3AF]">
                Default Sets
              </label>
              <input type="number" min="1" max="10" value={form.defaultSets}
                onChange={e => set('defaultSets', e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none text-[#E5E7EB]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#9CA3AF]">
                Default Reps
              </label>
              <input type="number" inputMode="numeric" min={0} value={form.defaultReps}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '' || v === '-') return set('defaultReps', v);
                  const n = parseInt(v, 10);
                  set('defaultReps', (!isNaN(n) && n < 0) ? '0' : v);
                }}
                placeholder="8-12"
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none text-[#E5E7EB] placeholder-[#4B5563]"
              />
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5 text-[#9CA3AF]">
              Instructions (optional)
            </label>
            <textarea
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder="How to perform this exercise…"
              rows={3}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none resize-none text-[#E5E7EB] placeholder-[#4B5563]"
            />
          </div>

          {error && <p className="text-[12px] text-red-500">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] disabled:opacity-50 active:scale-95 transition-all bg-[#D4AF37] text-black">
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
          <h1 className="text-[24px] font-bold text-[#E5E7EB]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Exercises
          </h1>
          <p className="text-[13px] mt-1 text-[#9CA3AF]">
            {localExercises.length + customExercises.length} exercises available
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-all bg-[#D4AF37] text-black"
        >
          <Plus size={14} /> New Exercise
        </button>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#111827] border border-white/8 rounded-xl p-1">
        {[
          { key: 'all',     label: 'All' },
          { key: 'mine',    label: `Mine${mineExercises.length ? ` · ${mineExercises.length}` : ''}` },
          { key: 'friends', label: `Friends${friendExercises.length ? ` · ${friendExercises.length}` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all"
            style={{
              background: tab === t.key ? '#0F172A' : 'transparent',
              color: tab === t.key ? '#E5E7EB' : '#9CA3AF',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
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
            <Dumbbell size={40} className="mx-auto mb-4 opacity-20 text-[#9CA3AF]" />
            <p className="font-semibold text-[16px] text-[#E5E7EB]">No custom exercises yet</p>
            <p className="text-[13px] mt-1.5 text-[#9CA3AF]">
              Create your own or save exercises from friends.
            </p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold active:scale-95 transition-all bg-[#D4AF37] text-black">
              <Plus size={14} /> New Exercise
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <Users size={40} className="mx-auto mb-4 opacity-20 text-[#9CA3AF]" />
            <p className="font-semibold text-[16px] text-[#E5E7EB]">No friend exercises yet</p>
            <p className="text-[13px] mt-1.5 text-[#9CA3AF]">
              When friends add custom exercises, they'll appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
