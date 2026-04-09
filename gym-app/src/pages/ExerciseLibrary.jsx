import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, ChevronRight, Dumbbell, Info, Plus, Bookmark, Check, Users, SlidersHorizontal, ArrowUpDown, Star, Pencil } from 'lucide-react';
import { exercises as localExercises, MUSCLE_GROUPS, EQUIPMENT, CATEGORIES } from '../data/exercises';
import BodyDiagram from '../components/BodyDiagram';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { useTranslation } from 'react-i18next';
import { exName, exInstructions } from '../lib/exerciseName';

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
  { key: 'name-asc',   i18nKey: 'name_asc' },
  { key: 'name-desc',  i18nKey: 'name_desc' },
  { key: 'muscle',     i18nKey: 'muscle' },
  { key: 'equipment',  i18nKey: 'equipment' },
];

/* ── Stat Pill ──────────────────────────────────────────────────────────────── */
const StatPill = ({ label, value }) => (
  <div className="flex flex-col items-center px-4 py-2">
    <span className="text-[15px] font-bold tracking-[-0.01em]" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
    <span className="text-[10.5px] font-medium text-[#5B6276] uppercase tracking-[0.06em] mt-0.5">{label}</span>
  </div>
);

/* ── Premium Exercise Card ──────────────────────────────────────────────────── */
const ExerciseCard = React.memo(({ exercise, onSelect, selectable, isFavorite, onToggleFavorite }) => {
  const { t } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const [showFullDescription, setShowFullDescription] = useState(false);
  const tint = getMuscleColor(exercise.muscle);

  const hasVideo = !!exercise.videoUrl;
  const hasMuscles = exercise.primaryRegions?.length > 0;
  const instrText = exInstructions(exercise);
  const longDescription = (instrText?.length ?? 0) > 100;

  return (
    <div
      className="group rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: expanded ? 'var(--color-border-default)' : 'var(--color-border-subtle)',
        boxShadow: expanded ? '0 6px 32px rgba(0,0,0,0.35)' : '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${exName(exercise)} - ${exercise.muscle}, ${exercise.equipment}`}
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={() => { setExpanded(e => !e); setDetailTab('overview'); setShowFullDescription(false); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); setDetailTab('overview'); setShowFullDescription(false); } }}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug tracking-[-0.01em] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exName(exercise)}
          </p>
          <p className="text-[12.5px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>
            {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
            <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
            {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}
          </p>
        </div>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(exercise.id); }}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <Star size={15} className={isFavorite ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-[#3B4252]'} />
          </button>
        )}

        {selectable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
            aria-label={`Add ${exName(exercise)}`}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', border: '1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)' }}
          >
            <Plus size={14} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
          </button>
        )}

        <ChevronRight
          size={16}
          className={`flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--color-text-muted)' }}
        />
      </div>

      {/* ── Expanded detail panel ────────────────────────────────────────────── */}
      {expanded && (
        <div>
          {/* Video section */}
          {hasVideo && (
            <div className="mx-3 mb-2 rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', background: 'var(--color-bg-primary)' }}>
              <video
                src={resolveVideoUrl(exercise.videoUrl)}
                autoPlay
                loop
                muted
                playsInline
                aria-label={`${exName(exercise)} demonstration`}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Content area */}
          <div className="px-4 pt-3 pb-4">
            {/* Title + metadata (reinforced in expanded) */}
            <div className="mb-3">
              <h3 className="text-[17px] font-bold tracking-[-0.015em] leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
                {exName(exercise)}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[12.5px]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
                  <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
                  {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}
                </span>
                {exercise.category && (
                  <span
                    className="text-[10.5px] font-semibold px-2 py-[3px] rounded-md"
                    style={{ background: `${tint}0C`, color: tint, border: `1px solid ${tint}18` }}
                  >
                    {t(`exerciseLibrary.categoryNames.${exercise.category}`, exercise.category)}
                  </span>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div
              className="flex items-center justify-center rounded-[12px] mb-4 divide-x"
              style={{ background: 'var(--color-surface-hover)', borderColor: 'transparent', '--tw-divide-opacity': '0.05', '--tw-divide-color': 'var(--color-border-subtle)' }}
            >
              <StatPill label={t('exerciseLibrary.sets')} value={exercise.defaultSets} />
              <StatPill label={t('exerciseLibrary.reps')} value={exercise.defaultReps} />
              <StatPill label={t('exerciseLibrary.type')} value={t(`exerciseLibrary.categoryNames.${exercise.category || 'Compound'}`, exercise.category || 'Strength')} />
            </div>

            {/* Detail tabs */}
            {(instrText || hasMuscles) && (
              <>
                <div className="flex gap-0 mb-3.5" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {[
                    { key: 'overview', label: t('exerciseLibrary.tabs.overview'), show: !!instrText },
                    { key: 'muscles', label: t('exerciseLibrary.tabs.muscles'), show: hasMuscles },
                  ].filter(t => t.show).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setDetailTab(t.key)}
                      className="relative px-4 pb-2.5 text-[12.5px] font-semibold transition-colors"
                      style={{ color: detailTab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-subtle)' }}
                    >
                      {t.label}
                      {detailTab === t.key && (
                        <span
                          className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full"
                          style={{ background: 'var(--color-accent)' }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Overview tab */}
                {detailTab === 'overview' && instrText && (
                  <div>
                    <p className={`text-[13px] leading-[1.65] text-[#8B95A5] ${!showFullDescription && longDescription ? 'line-clamp-2' : ''}`}>
                      {instrText}
                    </p>
                    {longDescription && (
                      <button
                        onClick={() => setShowFullDescription(s => !s)}
                        className="text-[12px] font-medium mt-1 transition-colors"
                        style={{ color: '#C9A84C' }}
                      >
                        {showFullDescription ? t('exerciseLibrary.showLess') : t('exerciseLibrary.readMore')}
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
                      title={t('exerciseLibrary.musclesWorked')}
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
});

/* ── Exercise Library (browseable list with search + filters) ────────────────── */
const ExerciseLibrary = ({ onSelect, selectable = false, selectedIds = [], extraExercises = [], favoriteIds = new Set(), onToggleFavorite }) => {
  const { t } = useTranslation('pages');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeMuscle, setActiveMuscle] = useState('All');
  const [activeEquipment, setActiveEquipment] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Scroll locking for advanced filters modal
  useEffect(() => {
    if (showAdvancedFilters) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showAdvancedFilters]);

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
    const q = debouncedQuery.toLowerCase();
    return allExercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        (e.name_es && e.name_es.toLowerCase().includes(q)) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesMuscle    = activeMuscle    === 'All' || e.muscle    === activeMuscle;
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      const matchesCategory  = activeCategory  === 'All' || e.category  === activeCategory;
      return matchesQuery && matchesMuscle && matchesEquipment && matchesCategory;
    });
  }, [debouncedQuery, activeMuscle, activeEquipment, activeCategory, allExercises]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case 'name-asc':  return arr.sort((a, b) => exName(a).localeCompare(exName(b)));
      case 'name-desc': return arr.sort((a, b) => exName(b).localeCompare(exName(a)));
      case 'muscle':    return arr.sort((a, b) => a.muscle.localeCompare(b.muscle) || exName(a).localeCompare(exName(b)));
      case 'equipment': return arr.sort((a, b) => a.equipment.localeCompare(b.equipment) || exName(a).localeCompare(exName(b)));
      default:          return arr;
    }
  }, [filtered, sortBy]);

  const activeFilterCount = [activeMuscle !== 'All', activeEquipment !== 'All', activeCategory !== 'All'].filter(Boolean).length;

  return (
    <div className="animate-fade-in">
      {/* Search bar with filter toggle */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder={t('exerciseLibrary.searchPlaceholder')}
          aria-label={t('exerciseLibrary.searchPlaceholder')}
          className="w-full rounded-xl pl-10 pr-12 py-3 text-[14px] focus:outline-none transition-all border border-white/[0.06] placeholder-[#3B4252] focus:border-white/[0.12]"
          style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setDebouncedQuery(''); }}
              aria-label="Clear search"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowAdvancedFilters(true)}
            aria-label="Open filters"
            className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-all active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{
              background: activeFilterCount > 0 ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
              color: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-subtle)',
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

      {/* Results + Sort row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12.5px] font-medium text-[#5B6276]">
          {t('exerciseLibrary.resultCount', { count: sorted.length })}
          {debouncedQuery && <span style={{ color: 'var(--color-text-muted)' }}> {t('exerciseLibrary.forQuery', { query: debouncedQuery })}</span>}
        </p>
        <div ref={sortRef} className="relative">
          <button
            onClick={() => setShowSortMenu(s => !s)}
            aria-label={t('exerciseLibrary.sort')}
            className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors active:scale-95"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ArrowUpDown size={13} />
            {t('exerciseLibrary.sort')}
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl border border-white/[0.08] overflow-hidden z-20"
                 style={{ background: 'var(--color-bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSortBy(opt.key); setShowSortMenu(false); }}
                  className="w-full px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-white/[0.04]"
                  style={{ color: sortBy === opt.key ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                >
                  {t(`exerciseLibrary.sortOptions.${opt.i18nKey}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Exercise list */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:grid-cols-3">
        {sorted.map(ex => (
          <ExerciseCard
            key={ex.id}
            exercise={ex}
            selectable={selectable && !selectedIds.includes(ex.id)}
            onSelect={onSelect}
            isFavorite={favoriteIds.has(ex.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))}

        {sorted.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Dumbbell size={28} className="text-[#3B4252]" />
            </div>
            <p className="text-[15px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('exerciseLibrary.noExercisesFound')}</p>
            <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.tryDifferentSearch')}</p>
          </div>
        )}
      </div>

      {/* Advanced Filters Bottom Sheet */}
      {showAdvancedFilters && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowAdvancedFilters(false)}
          role="dialog"
          aria-labelledby="filters-dialog-title"
        >
          <div
            className="w-full max-w-[520px] rounded-t-[24px] pb-8 pt-3 animate-slide-up"
            style={{ background: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border-subtle)' }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-5" />

            <div className="px-6">
              <div className="flex items-center justify-between mb-6">
                <h3 id="filters-dialog-title" className="text-[17px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.filters')}</h3>
                <button
                  onClick={() => {
                    setActiveMuscle('All');
                    setActiveEquipment('All');
                    setActiveCategory('All');
                  }}
                  aria-label={t('exerciseLibrary.reset')}
                  className="text-[13px] font-medium text-[#D4AF37] active:opacity-70"
                >
                  {t('exerciseLibrary.reset')}
                </button>
              </div>

              {/* Muscle Group */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">{t('exerciseLibrary.muscleGroup')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...MUSCLE_GROUPS].map(m => {
                    const active = activeMuscle === m;
                    return (
                      <button
                        key={m}
                        onClick={() => setActiveMuscle(m)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-bg-secondary)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`muscleGroups.${m}`, m)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">{t('exerciseLibrary.equipment')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...EQUIPMENT].map(eq => {
                    const active = activeEquipment === eq;
                    return (
                      <button
                        key={eq}
                        onClick={() => setActiveEquipment(eq)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-bg-secondary)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`exerciseLibrary.equipmentNames.${eq}`, eq)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Category */}
              <div className="mb-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">{t('exerciseLibrary.category')}</p>
                <div className="flex flex-wrap gap-2">
                  {['All', ...CATEGORIES].map(cat => {
                    const active = activeCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                          color: active ? 'var(--color-bg-secondary)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`exerciseLibrary.categoryNames.${cat}`, cat)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => setShowAdvancedFilters(false)}
                className="w-full py-3.5 rounded-xl font-bold text-[14px] active:scale-[0.98] transition-all bg-[#D4AF37] text-[#0A0D14]"
              >
                {t('exerciseLibrary.showExercises', { count: filtered.length })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ── Custom Exercise Card (Mine / Friends tabs) ─────────────────────────────── */
const CustomExerciseCard = ({ exercise, isMine, isSaved, onSave, onDelete, onUnsave, onEdit, isFavorite, onToggleFavorite }) => {
  const { t } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const tint = getMuscleColor(exercise.muscle);

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        background: 'var(--color-bg-card)',
        borderColor: expanded ? 'var(--color-border-default)' : 'var(--color-border-subtle)',
        boxShadow: expanded ? '0 4px 24px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${exName(exercise)} - ${exercise.muscle}, ${exercise.equipment}`}
        className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer active:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
      >
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center flex-shrink-0"
          style={{ background: `${tint}12`, border: `1px solid ${tint}18` }}
        >
          <Dumbbell size={18} strokeWidth={2} style={{ color: tint }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-snug tracking-[-0.01em] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exName(exercise)}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 truncate">
            <span className="text-[12.5px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
              {t(`muscleGroups.${exercise.muscle}`, exercise.muscle)}
              <span className="mx-1.5 text-[#3B3F47]">&middot;</span>
              {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}
            </span>
            {!isMine && exercise.createdByName && (
              <span className="text-[11px] ml-1" style={{ color: 'var(--color-text-muted)' }}>
                by @{exercise.createdByUsername ?? exercise.createdByName}
              </span>
            )}
            {isMine && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md ml-1"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', color: 'var(--color-accent)' }}>
                {t('exerciseLibrary.yours')}
              </span>
            )}
          </div>
        </div>

        {/* Action icons — grouped tight */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onToggleFavorite && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggleFavorite(exercise.id); }}
              aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <Star size={15} className={isFavorite ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-[#3B4252]'} />
            </button>
          )}

          {!isMine && !isSaved && onSave && (
            <button
              onClick={e => { e.stopPropagation(); onSave(); }}
              aria-label="Save exercise"
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 transition-all focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
            >
              <Bookmark size={14} style={{ color: 'var(--color-accent)' }} />
            </button>
          )}
          {isSaved && !isMine && onUnsave && (
            <button
              onClick={e => { e.stopPropagation(); onUnsave(); }}
              aria-label="Unsave exercise"
              className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center active:scale-90 bg-[#10B981]/10 hover:bg-red-500/10 transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <Bookmark size={14} className="text-[#10B981] fill-[#10B981]" />
            </button>
          )}

          <ChevronRight
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {/* Stats row */}
          <div
            className="flex items-center justify-center rounded-[12px] mb-3.5 divide-x"
            style={{ background: 'var(--color-surface-hover)', '--tw-divide-opacity': '0.05', '--tw-divide-color': 'var(--color-border-subtle)' }}
          >
            <StatPill label={t('exerciseLibrary.sets')} value={exercise.defaultSets} />
            <StatPill label={t('exerciseLibrary.reps')} value={exercise.defaultReps} />
          </div>
          {exInstructions(exercise) && (
            <p className="text-[13px] leading-[1.65] text-[#8B95A5] mb-3">
              {exInstructions(exercise)}
            </p>
          )}

          {/* Actions for own exercises */}
          {isMine && (
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              {onEdit && (
                <button
                  onClick={() => onEdit(exercise)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  <Pencil size={11} /> {t('exerciseLibrary.edit')}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(exercise.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium hover:text-red-400 bg-white/[0.03] hover:bg-red-500/10 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <X size={11} /> {t('exerciseLibrary.delete')}
                </button>
              )}
            </div>
          )}

          {/* Unsave for friend exercises */}
          {!isMine && isSaved && onUnsave && (
            <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
              <button
                onClick={() => onUnsave()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium hover:text-red-400 bg-white/[0.03] hover:bg-red-500/10 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={11} /> {t('exerciseLibrary.removeFromSaved')}
              </button>
            </div>
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
    name_es:          row.name_es || null,
    muscle:           row.muscle_group,
    equipment:        row.equipment,
    category:         row.category,
    defaultSets:      row.default_sets,
    defaultReps:      row.default_reps,
    restSeconds:      row.rest_seconds,
    instructions:     row.instructions ?? '',
    instructions_es:  row.instructions_es || null,
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
const DropdownSelect = ({ value, options, onChange, placeholder, label, renderOption }) => {
  const display = renderOption || ((v) => v);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', fn);
    return () => document.removeEventListener('click', fn);
  }, []);
  return (
    <div ref={ref} className="relative">
      <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border border-white/[0.06] rounded-xl px-3.5 py-3 text-left text-[14px] flex items-center justify-between min-h-[44px] focus:outline-none focus:border-[#D4AF37]/40 transition-all"
        style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
      >
        <span>{value ? display(value) : placeholder}</span>
        <ChevronDown size={15} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-10 max-h-[200px] overflow-y-auto border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          style={{ background: 'var(--color-bg-primary)' }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full px-3.5 py-2.5 text-left text-[13px] hover:bg-white/[0.04] transition-colors"
              style={{ color: value === opt ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
            >
              {display(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Add Exercise Modal ─────────────────────────────────────────────────────── */
const SECONDARY_MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Core', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Traps', 'Lats'];

const AddExerciseModal = ({ onSave, onClose }) => {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: '', muscle: MUSCLE_GROUPS[0], equipment: EQUIPMENT[0],
    category: CATEGORIES[0], defaultSets: '3', defaultReps: '8-12', instructions: '',
    secondaryMuscles: [], shareWithFriends: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleSecondary = (muscle) => {
    setForm(f => ({
      ...f,
      secondaryMuscles: f.secondaryMuscles.includes(muscle)
        ? f.secondaryMuscles.filter(m => m !== muscle)
        : [...f.secondaryMuscles, muscle],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError(t('exerciseLibrary.nameRequired')); return; }
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
    <div className="fixed inset-0 z-[110] flex flex-col animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <header className="flex-shrink-0 px-5 pb-3 border-b border-white/[0.06] flex items-center gap-3" style={{ paddingTop: 'max(0.875rem, var(--safe-area-top, env(safe-area-inset-top)))', background: 'var(--color-bg-primary)' }}>
        <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center hover:bg-white/[0.08] transition-colors">
          <X size={18} style={{ color: 'var(--color-text-muted)' }} />
        </button>
        <h2 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.newExercise')}</h2>
      </header>

      {/* Scrollable body — save button is inline at the bottom */}
      <div className="flex-1 overflow-y-auto px-5 py-5 pb-[calc(2rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))]">
        <div className="flex flex-col gap-5">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('exerciseLibrary.exerciseNameLabel')}
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder={t('exerciseLibrary.exerciseNamePlaceholder')}
              className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[14px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 transition-all"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Primary Muscle + Equipment */}
          <div className="grid grid-cols-2 gap-3">
            <DropdownSelect label={t('exerciseLibrary.primaryMuscleLabel')} value={form.muscle} options={MUSCLE_GROUPS} onChange={(v) => set('muscle', v)} renderOption={(v) => t(`muscleGroups.${v}`, v)} />
            <DropdownSelect label={t('exerciseLibrary.equipmentLabel')} value={form.equipment} options={EQUIPMENT} onChange={(v) => set('equipment', v)} renderOption={(v) => t(`exerciseLibrary.equipmentNames.${v}`, v)} />
          </div>

          {/* Secondary Muscles (optional multi-select chips) */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('exerciseLibrary.secondaryMusclesLabel')} <span className="normal-case" style={{ color: 'var(--color-text-muted)' }}>({t('exerciseLibrary.optional')})</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SECONDARY_MUSCLES.filter(m => m !== form.muscle).map(muscle => {
                const selected = form.secondaryMuscles.includes(muscle);
                return (
                  <button
                    key={muscle}
                    type="button"
                    onClick={() => toggleSecondary(muscle)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                      selected
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                        : 'bg-white/[0.04] border border-white/[0.06]'
                    }`}
                    style={!selected ? { color: 'var(--color-text-subtle)' } : undefined}
                  >
                    {t(`muscleGroups.${muscle}`, muscle)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sets + Reps */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultSetsLabel')}</label>
              <input type="number" min="1" max="10" value={form.defaultSets}
                onChange={e => set('defaultSets', e.target.value)}
                className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[#D4AF37]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultRepsLabel')}</label>
              <input inputMode="numeric" value={form.defaultReps}
                onChange={e => set('defaultReps', e.target.value)}
                placeholder="8-12"
                className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
              />
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.instructionsLabel')} <span className="normal-case" style={{ color: 'var(--color-text-muted)' }}>({t('exerciseLibrary.optional')})</span></label>
            <textarea
              value={form.instructions}
              onChange={e => set('instructions', e.target.value)}
              placeholder={t('exerciseLibrary.instructionsPlaceholder')}
              rows={3}
              className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 resize-none transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
            />
          </div>

          {/* Share with friends toggle */}
          <div className="flex items-center justify-between py-3 border-t border-white/[0.06]">
            <div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.shareWithFriends')}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.shareWithFriendsHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => set('shareWithFriends', !form.shareWithFriends)}
              aria-label={t('exerciseLibrary.shareWithFriends')}
              aria-pressed={form.shareWithFriends}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.shareWithFriends ? 'bg-[#D4AF37]' : 'bg-white/[0.10]'}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.shareWithFriends ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Error */}
          {error && <p className="text-[12px] text-red-400">{error}</p>}

          {/* Save button — inline, right after the form */}
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 active:scale-[0.98] transition-all mt-2"
          >
            {saving ? t('exerciseLibrary.saving') : t('exerciseLibrary.saveExercise')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── Edit Exercise Form (used inside the edit modal) ─────────────────────────── */
const EditExerciseForm = ({ exercise, onSave, onCancel }) => {
  const { t } = useTranslation('pages');
  const [form, setForm] = useState({
    name: exercise.name || '',
    muscle: exercise.muscle || MUSCLE_GROUPS[0],
    equipment: exercise.equipment || EQUIPMENT[0],
    defaultSets: String(exercise.defaultSets || 3),
    defaultReps: String(exercise.defaultReps || '8-12'),
    instructions: exercise.instructions || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5 pb-[calc(2rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))]">
      <div className="flex flex-col gap-5">
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.exerciseNameLabel')}</label>
          <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('exerciseLibrary.exerciseNamePlaceholder')}
            className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[14px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 transition-all"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DropdownSelect label={t('exerciseLibrary.primaryMuscleLabel')} value={form.muscle} options={MUSCLE_GROUPS} onChange={v => set('muscle', v)} renderOption={(v) => t(`muscleGroups.${v}`, v)} />
          <DropdownSelect label={t('exerciseLibrary.equipmentLabel')} value={form.equipment} options={EQUIPMENT} onChange={v => set('equipment', v)} renderOption={(v) => t(`exerciseLibrary.equipmentNames.${v}`, v)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultSetsLabel')}</label>
            <input type="number" min="1" max="10" value={form.defaultSets} onChange={e => set('defaultSets', e.target.value)}
              className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] focus:outline-none focus:border-[#D4AF37]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
          </div>
          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.defaultRepsLabel')}</label>
            <input inputMode="numeric" value={form.defaultReps} onChange={e => set('defaultReps', e.target.value)} placeholder="8-12"
              className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold uppercase tracking-[0.1em] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('exerciseLibrary.instructionsLabel')} <span className="normal-case" style={{ color: 'var(--color-text-muted)' }}>({t('exerciseLibrary.optional')})</span></label>
          <textarea value={form.instructions} onChange={e => set('instructions', e.target.value)} placeholder={t('exerciseLibrary.instructionsPlaceholder')} rows={3}
            className="w-full border border-white/[0.06] rounded-xl px-3.5 py-2.5 text-[13px] placeholder-[#3B4252] focus:outline-none focus:border-[#D4AF37]/40 resize-none transition-all" style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }} />
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <button
          onClick={async () => {
            if (!form.name.trim()) { setError(t('exerciseLibrary.nameRequired')); return; }
            setSaving(true); setError('');
            const result = await onSave(exercise, form);
            if (result?.error) setError(result.error);
            setSaving(false);
          }}
          disabled={saving || !form.name.trim()}
          className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 active:scale-[0.98] transition-all mt-2"
        >
          {saving ? t('exerciseLibrary.saving') : t('exerciseLibrary.saveChanges')}
        </button>
      </div>
    </div>
  );
};

/* ── Full-page wrapper ──────────────────────────────────────────────────────── */
export const ExerciseLibraryPage = () => {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [tab, setTab]               = useState('all');
  const [customExercises, setCustom] = useState([]);
  const [globalDbExercises, setGlobalDb] = useState([]);
  const [savedIds, setSavedIds]      = useState(new Set());
  const [friendIds, setFriendIds]    = useState(new Set());
  const [loading, setLoading]        = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [editingExercise, setEditingExercise] = useState(null);

  const load = useCallback(async () => {
    if (!user || !profile) return;
    setLoading(true);

    try {
      // Fetch global exercises
      const [globalsRes, customsRes, savedRes, fshipsRes, favsRes] = await Promise.all([
        supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, created_by').is('gym_id', null).eq('is_active', true),
        profile.gym_id
          ? supabase.from('exercises').select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, instructions_es, primary_regions, secondary_regions, video_url, created_by').eq('gym_id', profile.gym_id).eq('is_active', true)
          : Promise.resolve({ data: [] }),
        supabase.from('user_saved_exercises').select('exercise_id').eq('user_id', user.id),
        // SECURITY: user.id comes from supabase.auth context, not user input.
        // Validate UUID format as a defense-in-depth measure before interpolating into .or() filter.
        (/^[0-9a-f-]{36}$/i.test(user.id)
          ? supabase.from('friendships')
              .select('requester_id, addressee_id, status')
              .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
              .eq('status', 'accepted')
          : Promise.resolve({ data: [] })),
        supabase.from('exercise_favorites').select('exercise_id').eq('user_id', user.id),
      ]);

      const globals = globalsRes.data ?? [];
      const customs = customsRes.data ?? [];
      const saved   = savedRes.data ?? [];
      const fships  = fshipsRes.data ?? [];
      const favs    = favsRes.data ?? [];

      const fIds = new Set(fships.map(f =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      ));
      setFavoriteIds(new Set(favs.map(f => f.exercise_id)));

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

  const handleUnsave = async (exerciseId) => {
    setSavedIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
    await supabase.from('user_saved_exercises').delete().eq('user_id', user.id).eq('exercise_id', exerciseId);
  };

  const handleDeleteExercise = async (exerciseId) => {
    if (!confirm(t('exerciseLibrary.deleteConfirm'))) return;
    await supabase.from('exercises').update({ is_active: false }).eq('id', exerciseId);
    setCustom(prev => prev.filter(e => e.id !== exerciseId));
    setSavedIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
  };

  const handleToggleFavorite = async (exerciseId) => {
    if (favoriteIds.has(exerciseId)) {
      setFavoriteIds(prev => { const s = new Set(prev); s.delete(exerciseId); return s; });
      await supabase.from('exercise_favorites').delete().eq('user_id', user.id).eq('exercise_id', exerciseId);
    } else {
      setFavoriteIds(prev => new Set([...prev, exerciseId]));
      await supabase.from('exercise_favorites').insert({ user_id: user.id, exercise_id: exerciseId });
    }
  };

  const handleEditExercise = async (exercise, updates) => {
    const { error } = await supabase.from('exercises').update({
      name: updates.name,
      muscle_group: updates.muscle,
      equipment: updates.equipment,
      default_sets: parseInt(updates.defaultSets) || 3,
      default_reps: updates.defaultReps,
      instructions: updates.instructions || null,
    }).eq('id', exercise.id);
    if (error) { logger.error('Edit exercise error:', error); return { error: error.message }; }
    setCustom(prev => prev.map(e => e.id === exercise.id ? { ...e, name: updates.name, muscle: updates.muscle, equipment: updates.equipment, defaultSets: parseInt(updates.defaultSets) || 3, defaultReps: updates.defaultReps, instructions: updates.instructions || '' } : e));
    setEditingExercise(null);
    return {};
  };

  const mineExercises   = customExercises.filter(e => e.createdBy === user?.id || savedIds.has(e.id));
  const friendExercises = customExercises.filter(e => friendIds.has(e.createdBy) && !savedIds.has(e.id));
  const extraForAll     = [...globalDbExercises, ...customExercises];

  // Deduplicated count: locals not in DB + all DB exercises
  const dbIds = new Set([...globalDbExercises, ...customExercises].map(e => e.id));
  const totalCount = localExercises.filter(e => !dbIds.has(e.id)).length + dbIds.size;

  const tabs = [
    { key: 'all',     label: t('exerciseLibrary.tabAll') },
    { key: 'mine',    label: t('exerciseLibrary.tabMine'), count: mineExercises.length || null },
    { key: 'friends', label: t('exerciseLibrary.tabFriends'), count: friendExercises.length || null },
  ];

  return (
    <div className="mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 md:px-8 pt-7 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="mb-7 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1
            className="text-[22px] md:text-[32px] font-extrabold tracking-[-0.02em] leading-none truncate"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}
          >
            {t('exerciseLibrary.title')}
          </h1>
          <p className="text-[13px] mt-1.5 font-medium text-[#5B6276]">
            {t('exerciseLibrary.exercisesAvailable', { count: totalCount })}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-[12px] text-[13px] font-bold active:scale-95 transition-all whitespace-nowrap flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 85%, black) 100%)',
            color: 'var(--color-bg-secondary)',
            boxShadow: '0 2px 12px color-mix(in srgb, var(--color-accent) 20%, transparent)',
          }}
        >
          <Plus size={15} strokeWidth={2.5} /> {t('exerciseLibrary.newExercise')}
        </button>
      </header>

      {/* ── Segmented Control ───────────────────────────────────────────────── */}
      <div
        className="flex gap-0.5 mb-5 rounded-[12px] p-[3px]"
        style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}
      >
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2 rounded-[10px] text-[13px] font-semibold transition-all relative"
              style={{
                background: active ? 'var(--color-bg-card)' : 'transparent',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
              }}
            >
              {t.label}
              {t.count ? (
                <span
                  className="ml-1.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'rgba(255,255,255,0.04)',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-subtle)',
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
        <ExerciseLibrary extraExercises={extraForAll} favoriteIds={favoriteIds} onToggleFavorite={handleToggleFavorite} />
      )}

      {/* Mine tab */}
      {tab === 'mine' && !loading && (
        mineExercises.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Dumbbell size={28} className="text-[#3B4252]" />
            </div>
            <p className="font-semibold text-[16px] text-[#D1D5DB]">{t('exerciseLibrary.noCustomYet')}</p>
            <p className="text-[13px] mt-1.5 text-[#5B6276]">
              {t('exerciseLibrary.noCustomHint')}
            </p>
            <button onClick={() => setShowAddModal(true)}
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[13px] font-bold active:scale-95 transition-all bg-[#D4AF37] text-[#0A0D14]">
              <Plus size={14} /> {t('exerciseLibrary.newExercise')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {mineExercises.map(ex => (
              <CustomExerciseCard key={ex.id} exercise={ex} isMine={ex.createdBy === user?.id} isSaved
                onDelete={ex.createdBy === user?.id ? handleDeleteExercise : undefined}
                onEdit={ex.createdBy === user?.id ? (e) => setEditingExercise(e) : undefined}
                onUnsave={ex.createdBy !== user?.id ? () => handleUnsave(ex.id) : undefined}
                isFavorite={favoriteIds.has(ex.id)}
                onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )
      )}

      {/* Friends tab */}
      {tab === 'friends' && !loading && (
        friendExercises.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-subtle)' }}>
              <Users size={28} className="text-[#3B4252]" />
            </div>
            <p className="font-semibold text-[16px] text-[#D1D5DB]">{t('exerciseLibrary.noFriendExercises')}</p>
            <p className="text-[13px] mt-1.5 text-[#5B6276]">
              {t('exerciseLibrary.noFriendExercisesHint')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {friendExercises.map(ex => (
              <CustomExerciseCard key={ex.id} exercise={ex} isMine={false} isSaved={savedIds.has(ex.id)}
                onSave={() => handleSave(ex.id)}
                onUnsave={() => handleUnsave(ex.id)}
                isFavorite={favoriteIds.has(ex.id)}
                onToggleFavorite={handleToggleFavorite} />
            ))}
          </div>
        )
      )}

      {showAddModal && createPortal(
        <AddExerciseModal onSave={handleCreateExercise} onClose={() => setShowAddModal(false)} />,
        document.body
      )}

      {/* Edit Exercise Modal */}
      {editingExercise && createPortal(
        <div className="fixed inset-0 z-[110] flex flex-col animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>
          <header className="flex-shrink-0 px-5 pb-3 border-b border-white/[0.06] flex items-center gap-3" style={{ paddingTop: 'max(0.875rem, var(--safe-area-top, env(safe-area-inset-top)))', background: 'var(--color-bg-primary)' }}>
            <button onClick={() => setEditingExercise(null)} aria-label="Close" className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center hover:bg-white/[0.08] transition-colors">
              <X size={18} style={{ color: 'var(--color-text-muted)' }} />
            </button>
            <h2 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('exerciseLibrary.editExercise')}</h2>
          </header>
          <EditExerciseForm exercise={editingExercise} onSave={handleEditExercise} onCancel={() => setEditingExercise(null)} />
        </div>,
        document.body
      )}
    </div>
  );
};

export default ExerciseLibrary;
