import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, X, ChevronDown, ChevronRight, Dumbbell, Info, Plus, Bookmark, Check, Users, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT, CATEGORIES } from '../data/exercises';
import BodyDiagram from '../components/BodyDiagram';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';

/* ── Resolve a video path to a full public URL ──────────────────────────────── */
const resolveVideoUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('/') || path.startsWith('http')) return path;
  const { data } = supabase.storage.from('exercise-videos').getPublicUrl(path);
  return data?.publicUrl || null;
};

/* ── Muscle icon tints (muted, premium palette) ─────────────────────────────── */
const MUSCLE_TINTS = {
  Chest:       '#E8927C',
  Back:        '#7CA8E8',
  Shoulders:   '#C9A84C',
  Biceps:      '#C9A84C',
  Triceps:     '#E8A87C',
  Legs:        '#6BC4A6',
  Glutes:      '#E8A87C',
  Core:        '#7CB8E8',
  Calves:      '#6BC4A6',
  Forearms:    '#C9A84C',
  Traps:       '#7CA8E8',
  'Full Body': '#8B95A5',
};

const getMuscleColor = (muscle) => MUSCLE_TINTS[muscle] || '#C9A84C';

/* ── Sort options ───────────────────────────────────────────────────────────── */
const SORT_OPTIONS = [
  { key: 'name-asc',   label: 'Name A-Z' },
  { key: 'name-desc',  label: 'Name Z-A' },
  { key: 'muscle',     label: 'Muscle Group' },
  { key: 'equipment',  label: 'Equipment' },
];

/* ── Stat Pill ──────────────────────────────────────────────────────────────── */
const StatPill = ({ label, value }) => (
  <div className="flex flex-col items-center px-4 py-2">
    <span className="text-[15px] font-bold text-[#E5E7EB] tracking-[-0.01em]">{value}</span>
    <span className="text-[10.5px] font-medium text-[#5B6276] uppercase tracking-[0.06em] mt-0.5">{label}</span>
  </div>
);

/* ── Premium Exercise Card ──────────────────────────────────────────────────── */
const ExerciseCard = ({ exercise, onSelect, selectable }) => {
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const tint = getMuscleColor(exercise.muscle);

  const hasVideo = !!exercise.videoUrl;
  const hasMuscles = exercise.primaryRegions?.length > 0;
  const longDescription = (exercise.instructions?.length ?? 0) > 100;

  return (
    <div
      className="group rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: 'rgba(15,23,42,0.6)',
        borderColor: expanded ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        boxShadow: expanded ? '0 6px 32px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={() => { setExpanded(e => !e); setDetailTab('overview'); setShowFullDescription(false); }}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug text-[#F1F3F5] tracking-[-0.01em]">
            {exercise.name}
          </p>
          <p className="text-[12.5px] mt-0.5 text-[#6B7280]">
            {exercise.muscle}
            <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
            {exercise.equipment}
          </p>
        </div>

        {selectable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
            style={{ background: 'rgba(212,175,55,0.12)', border: '1.5px solid rgba(212,175,55,0.35)' }}
          >
            <Plus size={14} strokeWidth={2.5} style={{ color: '#D4AF37' }} />
          </button>
        )}

        <ChevronRight
          size={16}
          className={`flex-shrink-0 transition-transform duration-200 text-[#4B5563] ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      {/* ── Expanded detail panel ────────────────────────────────────────────── */}
      {expanded && (
        <div>
          {/* Video section */}
          {hasVideo && (
            <div className="mx-3 mb-2 rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', background: '#080B12' }}>
              <video
                src={resolveVideoUrl(exercise.videoUrl)}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Content area */}
          <div className="px-4 pt-3 pb-4">
            {/* Title + metadata (reinforced in expanded) */}
            <div className="mb-3">
              <h3 className="text-[17px] font-bold text-[#F1F3F5] tracking-[-0.015em] leading-tight">
                {exercise.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[12.5px] text-[#6B7280]">
                  {exercise.muscle}
                  <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
                  {exercise.equipment}
                </span>
                {exercise.category && (
                  <span
                    className="text-[10.5px] font-semibold px-2 py-[3px] rounded-md"
                    style={{ background: `${tint}0C`, color: tint, border: `1px solid ${tint}18` }}
                  >
                    {exercise.category}
                  </span>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div
              className="flex items-center justify-center rounded-[12px] mb-4 divide-x"
              style={{ background: 'rgba(255,255,255,0.025)', borderColor: 'transparent', '--tw-divide-opacity': '0.05', '--tw-divide-color': 'rgba(255,255,255,var(--tw-divide-opacity))' }}
            >
              <StatPill label="Sets" value={exercise.defaultSets} />
              <StatPill label="Reps" value={exercise.defaultReps} />
              <StatPill label="Type" value={exercise.category || 'Strength'} />
            </div>

            {/* Detail tabs */}
            {(exercise.instructions || hasMuscles) && (
              <>
                <div className="flex gap-0 mb-3.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  {[
                    { key: 'overview', label: 'Overview', show: !!exercise.instructions },
                    { key: 'muscles', label: 'Muscles', show: hasMuscles },
                  ].filter(t => t.show).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setDetailTab(t.key)}
                      className="relative px-4 pb-2.5 text-[12.5px] font-semibold transition-colors"
                      style={{ color: detailTab === t.key ? '#E5E7EB' : '#4B5563' }}
                    >
                      {t.label}
                      {detailTab === t.key && (
                        <span
                          className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
                          style={{ background: '#D4AF37' }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Overview tab */}
                {detailTab === 'overview' && exercise.instructions && (
                  <div>
                    <p className={`text-[13px] leading-[1.65] text-[#8B95A5] ${!showFullDescription && longDescription ? 'line-clamp-2' : ''}`}>
                      {exercise.instructions}
                    </p>
                    {longDescription && (
                      <button
                        onClick={() => setShowFullDescription(s => !s)}
                        className="text-[12px] font-medium mt-1 transition-colors"
                        style={{ color: '#C9A84C' }}
                      >
                        {showFullDescription ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                )}

                {/* Muscles tab */}
                {detailTab === 'muscles' && hasMuscles && (
                  <div>
                    <BodyDiagram
                      compact
                      inline
                      title="Muscles worked"
                      primaryRegions={exercise.primaryRegions}
                      secondaryRegions={exercise.secondaryRegions ?? []}
                    />
                  </div>
                )}
              </>
            )}

            {/* Fallback: no instructions and no muscles — just show stats (already shown above) */}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Exercise Library (browseable list with search + filters) ────────────────── */
const ExerciseLibrary = ({ onSelect, selectable = false, selectedIds = [], extraExercises = [] }) => {
  const [query, setQuery] = useState('');
  const [activeMuscle, setActiveMuscle] = useState('All');
  const [activeEquipment, setActiveEquipment] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortBy, setSortBy] = useState('name-asc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortRef = useRef(null);

  const allExercises = useMemo(() => {
    const localById = Object.fromEntries(localExercises.map(e => [e.id, e]));
    const dbIds = new Set(extraExercises.map(e => e.id));
    const uniqueLocal = localExercises.filter(e => !dbIds.has(e.id));
    // For DB exercises missing video_url, fall back to the local video path
    const dbWithFallback = extraExercises.map(e =>
      (!e.videoUrl && localById[e.id]?.videoUrl)
        ? { ...e, videoUrl: localById[e.id].videoUrl }
        : e
    );
    return [...uniqueLocal, ...dbWithFallback];
  }, [extraExercises]);

  // Close sort menu on outside click
  useEffect(() => {
    const fn = (e) => { if (sortRef.current && !sortRef.current.contains(e.target)) setShowSortMenu(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return allExercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesMuscle    = activeMuscle    === 'All' || e.muscle    === activeMuscle;
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      const matchesCategory  = activeCategory  === 'All' || e.category  === activeCategory;
      return matchesQuery && matchesMuscle && matchesEquipment && matchesCategory;
    });
  }, [query, activeMuscle, activeEquipment, activeCategory, allExercises]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'name-asc':  return arr.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc': return arr.sort((a, b) => b.name.localeCompare(a.name));
      case 'muscle':    return arr.sort((a, b) => a.muscle.localeCompare(b.muscle) || a.name.localeCompare(b.name));
      case 'equipment': return arr.sort((a, b) => a.equipment.localeCompare(b.equipment) || a.name.localeCompare(b.name));
      default:          return arr;
    }
  }, [filtered, sortBy]);

  const activeFilterCount = [activeEquipment !== 'All', activeCategory !== 'All'].filter(Boolean).length;

  return (
    <div className="animate-fade-in">
      {/* Search bar with filter toggle */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#4B5563]" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises..."
          aria-label="Search exercises"
          className="w-full rounded-xl pl-10 pr-12 py-3 text-[14px] focus:outline-none transition-all bg-[#111827]/80 border border-white/[0.06] text-[#E5E7EB] placeholder-[#3B4252] focus:border-white/[0.12] focus:bg-[#111827]"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1.5 rounded-lg transition-colors text-[#6B7280] hover:text-[#E5E7EB]"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowAdvancedFilters(true)}
            className="relative p-2 rounded-xl transition-all active:scale-95"
            style={{
              background: activeFilterCount > 0 ? 'rgba(212,175,55,0.1)' : 'transparent',
              color: activeFilterCount > 0 ? '#D4AF37' : '#6B7280',
            }}
          >
            <SlidersHorizontal size={16} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#D4AF37] text-black text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Quick muscle-group filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none mb-4">
        {['All', ...MUSCLE_GROUPS].map(m => {
          const active = activeMuscle === m;
          return (
            <button
              key={m}
              onClick={() => setActiveMuscle(m)}
              className="flex-shrink-0 text-[12px] font-medium px-3 py-[6px] rounded-[10px] transition-all active:scale-95"
              style={{
                background: active ? '#D4AF37' : 'rgba(255,255,255,0.04)',
                color: active ? '#0A0D14' : '#7B8494',
                border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.06)'}`,
                fontWeight: active ? 700 : 500,
              }}
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* Results + Sort row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12.5px] font-medium text-[#5B6276]">
          {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          {query && <span className="text-[#4B5563]"> for "{query}"</span>}
        </p>
        <div ref={sortRef} className="relative">
          <button
            onClick={() => setShowSortMenu(s => !s)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors text-[#6B7280] hover:text-[#9CA3AF] active:scale-95"
          >
            <ArrowUpDown size={13} />
            Sort
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl border border-white/[0.08] overflow-hidden z-20"
                 style={{ background: '#141B2D', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSortBy(opt.key); setShowSortMenu(false); }}
                  className="w-full px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.04]"
                  style={{ color: sortBy === opt.key ? '#D4AF37' : '#9CA3AF' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Exercise list */}
      <div className="flex flex-col gap-2">
        {sorted.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            selectable={selectable && !selectedIds.includes(ex.id)}
            onSelect={onSelect}
          />
        ))}

        {sorted.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Dumbbell size={28} className="text-[#3B4252]" />
            </div>
            <p className="text-[15px] font-medium text-[#6B7280]">No exercises found</p>
            <p className="text-[13px] mt-1 text-[#4B5563]">Try a different search or filter</p>
          </div>
        )}
      </div>

      {/* Advanced Filters Bottom Sheet */}
      {showAdvancedFilters && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowAdvancedFilters(false)}
        >
          <div
            className="w-full max-w-[520px] rounded-t-[24px] pb-8 pt-3 animate-slide-up"
            style={{ background: '#111827', borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-5" />

            <div className="px-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[17px] font-bold text-[#F1F3F5]">Filters</h3>
                <button
                  onClick={() => {
                    setActiveEquipment('All');
                    setActiveCategory('All');
                  }}
                  className="text-[13px] font-medium text-[#D4AF37] active:opacity-70"
                >
                  Reset
                </button>
              </div>

              {/* Equipment */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">Equipment</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...EQUIPMENT].map(eq => {
                    const active = activeEquipment === eq;
                    return (
                      <button
                        key={eq}
                        onClick={() => setActiveEquipment(eq)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? '#D4AF37' : 'rgba(255,255,255,0.04)',
                          color: active ? '#0A0D14' : '#7B8494',
                          border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.06)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {eq}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div className="mb-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">Category</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...CATEGORIES].map(cat => {
                    const active = activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? '#D4AF37' : 'rgba(255,255,255,0.04)',
                          color: active ? '#0A0D14' : '#7B8494',
                          border: `1px solid ${active ? '#D4AF37' : 'rgba(255,255,255,0.06)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => setShowAdvancedFilters(false)}
                className="w-full py-3.5 rounded-xl font-bold text-[14px] active:scale-[0.98] transition-all bg-[#D4AF37] text-[#0A0D14]"
              >
                Show {filtered.length} exercise{filtered.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Custom Exercise Card (Mine / Friends tabs) ─────────────────────────────── */
const CustomExerciseCard = ({ exercise, isMine, isSaved, onSave }) => {
  const [expanded, setExpanded] = useState(false);
  const tint = getMuscleColor(exercise.muscle);

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: 'rgba(15,23,42,0.6)',
        borderColor: expanded ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        boxShadow: expanded ? '0 4px 24px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      <div
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug text-[#F1F3F5] tracking-[-0.01em]">
            {exercise.name}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[12.5px] text-[#6B7280]">
              {exercise.muscle}
              <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
              {exercise.equipment}
            </span>
            {!isMine && exercise.createdByName && (
              <span className="text-[11px] text-[#4B5563] ml-1">
                by @{exercise.createdByUsername ?? exercise.createdByName}
              </span>
            )}
            {isMine && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md ml-1"
                    style={{ background: 'rgba(212,175,55,0.08)', color: '#C9A84C' }}>
                Yours
              </span>
            )}
          </div>
        </div>

        {!isMine && !isSaved && onSave && (
          <button
            onClick={e => { e.stopPropagation(); onSave(); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold active:scale-95 transition-all flex-shrink-0"
            style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)', color: '#D4AF37' }}
          >
            <Bookmark size={12} /> Save
          </button>
        )}
        {isSaved && !isMine && (
          <span className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0 text-[#10B981]">
            <Check size={12} /> Saved
          </span>
        )}

        <ChevronRight
          size={16}
          className={`flex-shrink-0 transition-transform duration-200 text-[#4B5563] ${expanded ? 'rotate-90' : ''}`}
        />
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {/* Stats row */}
          <div
            className="flex items-center justify-center rounded-[12px] mb-3.5 divide-x"
            style={{ background: 'rgba(255,255,255,0.025)', '--tw-divide-opacity': '0.05', '--tw-divide-color': 'rgba(255,255,255,var(--tw-divide-opacity))' }}
          >
            <StatPill label="Sets" value={exercise.defaultSets} />
            <StatPill label="Reps" value={exercise.defaultReps} />
          </div>
          {exercise.instructions && (
            <p className="text-[13px] leading-[1.65] text-[#8B95A5]">
              {exercise.instructions}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Normalize a DB exercise row to frontend format ─────────────────────────── */
const normalizeDbExercise = (row) => {
  return {
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
    videoUrl:         row.video_url || null,
    createdBy:        row.created_by,
    createdByName:    row.profiles?.full_name,
    createdByUsername: row.profiles?.username,
    isCustom:         true,
  };
};

/* ── Custom dropdown for Add Exercise modal ─────────────────────────────────── */
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
      <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] mb-1.5 text-[#5B6276]">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-[12px] px-3.5 py-3 text-left text-[14px] flex items-center justify-between min-h-[44px] focus:outline-none transition-all text-[#E5E7EB]"
        style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span>{value || placeholder}</span>
        <ChevronDown size={15} className={`flex-shrink-0 transition-transform text-[#4B5563] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10 max-h-[200px] overflow-y-auto"
          style={{ background: '#141B2D', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full px-3.5 py-2.5 text-left text-[13px] hover:bg-white/[0.04] transition-colors"
              style={{ color: value === opt ? '#D4AF37' : '#D1D5DB' }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Add Exercise Modal ─────────────────────────────────────────────────────── */
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
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-[480px] rounded-[24px] p-6 max-h-[80vh] overflow-y-auto animate-slide-up"
        style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Handle (mobile) */}
        <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-4 sm:hidden" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-[18px] text-[#F1F3F5]">New Exercise</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/[0.04] transition-colors">
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] mb-1.5 text-[#5B6276]">
              Exercise Name *
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Bulgarian Split Squat"
              className="w-full rounded-[12px] px-3.5 py-2.5 text-[14px] focus:outline-none transition-all text-[#E5E7EB] placeholder-[#3B4252]"
              style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DropdownSelect label="Muscle Group" value={form.muscle} options={MUSCLE_GROUPS} onChange={(v) => set('muscle', v)} />
            <DropdownSelect label="Equipment" value={form.equipment} options={EQUIPMENT} onChange={(v) => set('equipment', v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] mb-1.5 text-[#5B6276]">Default Sets</label>
              <input type="number" min="1" max="10" value={form.defaultSets}
                onChange={e => set('defaultSets', e.target.value)}
                className="w-full rounded-[12px] px-3.5 py-2.5 text-[13px] focus:outline-none text-[#E5E7EB]"
                style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] mb-1.5 text-[#5B6276]">Default Reps</label>
              <input type="number" inputMode="numeric" min={0} value={form.defaultReps}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '' || v === '-') return set('defaultReps', v);
                  const n = parseInt(v, 10);
                  set('defaultReps', (!isNaN(n) && n < 0) ? '0' : v);
                }}
                placeholder="8-12"
                className="w-full rounded-[12px] px-3.5 py-2.5 text-[13px] focus:outline-none text-[#E5E7EB] placeholder-[#3B4252]"
                style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] mb-1.5 text-[#5B6276]">Instructions (optional)</label>
            <textarea
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder="How to perform this exercise..."
              rows={3}
              className="w-full rounded-[12px] px-3.5 py-2.5 text-[13px] focus:outline-none resize-none text-[#E5E7EB] placeholder-[#3B4252]"
              style={{ background: 'rgba(17,24,39,0.8)', border: '1px solid rgba(255,255,255,0.06)' }}
            />
          </div>

          {error && <p className="text-[12px] text-red-400">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:scale-[0.98] transition-all bg-[#D4AF37] text-[#0A0D14]">
            {saving ? 'Saving...' : 'Add Exercise'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Full-page wrapper ──────────────────────────────────────────────────────── */
export const ExerciseLibraryPage = () => {
  const { user, profile } = useAuth();
  const [tab, setTab]               = useState('all');
  const [customExercises, setCustom] = useState([]);
  const [globalDbExercises, setGlobalDb] = useState([]);
  const [savedIds, setSavedIds]      = useState(new Set());
  const [friendIds, setFriendIds]    = useState(new Set());
  const [loading, setLoading]        = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = useCallback(async () => {
    if (!user || !profile) return;
    setLoading(true);

    try {
      // Fetch global exercises (video_url included via *)
      const [globalsRes, customsRes, savedRes, fshipsRes] = await Promise.all([
        supabase.from('exercises').select('*').is('gym_id', null).eq('is_active', true),
        profile.gym_id
          ? supabase.from('exercises').select('*').eq('gym_id', profile.gym_id).eq('is_active', true)
          : Promise.resolve({ data: [] }),
        supabase.from('user_saved_exercises').select('exercise_id').eq('user_id', user.id),
        supabase.from('friendships')
          .select('requester_id, addressee_id, status')
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted'),
      ]);

      const globals = globalsRes.data ?? [];
      const customs = customsRes.data ?? [];
      const saved   = savedRes.data ?? [];
      const fships  = fshipsRes.data ?? [];

      const fIds = new Set(fships.map(f =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      ));

      // Separately fetch profile names for custom exercises that have a created_by
      const creatorIds = [...new Set(customs.map(e => e.created_by).filter(Boolean))];
      let profileMap = {};
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, username')
          .in('id', creatorIds);
        profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]));
      }

      const customNormalized = customs.map(row => ({
        ...normalizeDbExercise(row),
        createdByName: profileMap[row.created_by]?.full_name,
        createdByUsername: profileMap[row.created_by]?.username,
      }));
      const globalNormalized = globals.map(normalizeDbExercise);

      setCustom(customNormalized);
      setGlobalDb(globalNormalized);
      setSavedIds(new Set(saved.map(s => s.exercise_id)));
      setFriendIds(fIds);
    } catch (err) {
      logger.error('ExerciseLibrary load error:', err);
    } finally {
      setLoading(false);
    }
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
      logger.error('Create exercise error:', error);
      return { error: error.message };
    }

    await supabase.from('user_saved_exercises').insert({ user_id: user.id, exercise_id: id });

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
      createdByUsername:  profile.username,
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

  const mineExercises   = customExercises.filter(e => e.createdBy === user?.id || savedIds.has(e.id));
  const friendExercises = customExercises.filter(e => friendIds.has(e.createdBy) && !savedIds.has(e.id));
  const extraForAll     = [...globalDbExercises, ...customExercises];

  const totalCount = localExercises.length + globalDbExercises.length + customExercises.length;

  const tabs = [
    { key: 'all',     label: 'All' },
    { key: 'mine',    label: 'Mine', count: mineExercises.length || null },
    { key: 'friends', label: 'Friends', count: friendExercises.length || null },
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-7 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[28px] md:text-[32px] font-extrabold text-[#F1F3F5] tracking-[-0.02em] leading-none"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            Exercises
          </h1>
          <p className="text-[13px] mt-1.5 font-medium text-[#5B6276]">
            {totalCount} exercises available
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-[12px] text-[13px] font-bold active:scale-95 transition-all"
          style={{
            background: 'linear-gradient(135deg, #D4AF37 0%, #C49B2F 100%)',
            color: '#0A0D14',
            boxShadow: '0 2px 12px rgba(212,175,55,0.2)',
          }}
        >
          <Plus size={15} strokeWidth={2.5} /> New Exercise
        </button>
      </header>

      {/* ── Segmented Control ───────────────────────────────────────────────── */}
      <div
        className="flex gap-0.5 mb-5 rounded-[12px] p-[3px]"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold transition-all relative"
              style={{
                background: active ? 'rgba(15,23,42,0.9)' : 'transparent',
                color: active ? '#F1F3F5' : '#5B6276',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
              }}
            >
              {t.label}
              {t.count ? (
                <span
                  className="ml-1.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{
                    background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#D4AF37' : '#4B5563',
                  }}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────────────────── */}

      {/* All tab */}
      {tab === 'all' && (
        <ExerciseLibrary extraExercises={extraForAll} />
      )}

      {/* Mine tab */}
      {tab === 'mine' && !loading && (
        mineExercises.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Dumbbell size={28} className="text-[#3B4252]" />
            </div>
            <p className="font-semibold text-[16px] text-[#D1D5DB]">No custom exercises yet</p>
            <p className="text-[13px] mt-1.5 text-[#5B6276]">
              Create your own or save exercises from friends.
            </p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-bold active:scale-95 transition-all bg-[#D4AF37] text-[#0A0D14]">
              <Plus size={14} /> New Exercise
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <Users size={28} className="text-[#3B4252]" />
            </div>
            <p className="font-semibold text-[16px] text-[#D1D5DB]">No friend exercises yet</p>
            <p className="text-[13px] mt-1.5 text-[#5B6276]">
              When friends add custom exercises, they'll appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
