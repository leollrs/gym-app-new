import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ArrowLeft, Trophy, ChevronDown, TrendingUp, Search, SlidersHorizontal, X, Flame } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import ChartTooltip from '../components/ChartTooltip';
import { exName } from '../lib/exerciseName';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';

const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const TU_ACCENT = 'var(--color-accent, #2EC4C4)';

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'];
const EQUIPMENT_TYPES = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];

const PRRow = ({ pr, history, isNew }) => {
  const { t, i18n } = useTranslation('pages');
  const dateLocale = i18n.language === 'es' ? esLocale : undefined;
  const [expanded, setExpanded] = useState(false);
  const orm = parseFloat(pr.estimated_1rm);
  const name = pr.exercises ? exName(pr.exercises) : pr.exercise_id;
  const group = pr.exercises?.muscle_group ?? '';
  const groupLabel = group ? t(`personalRecords.muscleGroups.${group}`, group) : '';
  const byDate = {};
  history.forEach(h => {
    const dateKey = h.achieved_at.slice(0, 10);
    const o = parseFloat(h.estimated_1rm);
    if (!byDate[dateKey] || o > byDate[dateKey].orm) byDate[dateKey] = { dateKey, orm: o };
  });
  const chartData = Object.values(byDate)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .map(d => ({ date: format(parseISO(d.dateKey), 'MMM d', { locale: dateLocale }), orm: Math.round(d.orm) }));

  return (
    <div className="rounded-[18px] overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:scale-[0.98] transition-all focus:outline-none"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Icon */}
        <div className="w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0"
          style={{ background: isNew ? 'rgba(255,90,46,0.12)' : `${TU_ACCENT}12` }}>
          {isNew ? <Flame size={18} style={{ color: '#FF5A2E' }} /> : <Trophy size={18} style={{ color: TU_ACCENT }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-bold truncate" style={{ fontFamily: TU_DISPLAY, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>{name}</p>
            {isNew && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'rgba(255,90,46,0.12)', color: '#FF5A2E', letterSpacing: 0.5 }}>{t('personalRecords.newBadge', 'NEW')}</span>
            )}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {groupLabel && <span className="capitalize">{groupLabel} {'\u00B7'} </span>}
            {format(parseISO(pr.achieved_at), 'MMM d, yyyy', { locale: dateLocale })}
          </p>
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <p style={{ fontFamily: TU_DISPLAY, fontSize: 22, fontWeight: 800, color: TU_ACCENT, letterSpacing: -0.5, lineHeight: 1 }}>{Math.round(orm)}</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('personalRecords.est1RM')}</p>
        </div>
        <ChevronDown
          size={15}
          className="flex-shrink-0 transition-transform duration-200"
          style={{ color: 'var(--color-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <div className="mt-3 grid grid-cols-3 gap-2 mb-4">
            {[
              { v: pr.weight_lbs, l: t('personalRecords.weightLbs'), c: 'var(--color-text-primary)' },
              { v: pr.reps, l: t('personalRecords.reps'), c: 'var(--color-text-primary)' },
              { v: Math.round(orm), l: t('personalRecords.estimated1RM'), c: TU_ACCENT },
            ].map(m => (
              <div key={m.l} className="rounded-[12px] p-2.5 text-center" style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.03))' }}>
                <p className="text-[16px] font-black" style={{ fontFamily: TU_DISPLAY, color: m.c }}>{m.v}</p>
                <p className="text-[9px] font-bold uppercase mt-1" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{m.l}</p>
              </div>
            ))}
          </div>

          {chartData.length > 1 ? (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                {t('personalRecords.estimated1RMOverTime')}
              </p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} />
                  <Line type="monotone" dataKey="orm" stroke={TU_ACCENT} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: TU_ACCENT }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-center py-3" style={{ color: 'var(--color-text-muted)' }}>
              {t('personalRecords.hitLiftAgain')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default function PersonalRecords({ embedded = false }) {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const { user } = useAuth();

  // Cache slots scoped to user — survives unmount (e.g. swiping away from this
  // Progress tab) so re-entry paints PRs instantly.
  const uid = user?.id || 'anon';
  const prsCacheKey = `personal-records-prs-${uid}`;
  const histCacheKey = `personal-records-history-${uid}`;

  const [prs, setPrs] = useCachedState(prsCacheKey, []);
  const [prHistory, setPrHistory] = useCachedState(histCacheKey, {});
  // Skeleton only on truly-first visit: if we have cached PRs we skip the flash.
  const [loading, setLoading] = useState(() => !hasCachedState(prsCacheKey));
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterEquipment, setFilterEquipment] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = (filterGroup !== 'all' ? 1 : 0) + (filterEquipment !== 'all' ? 1 : 0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      // Only toggle the loader on if we have nothing cached. Otherwise the
      // cached data is already painted and we revalidate silently.
      if (!hasCachedState(prsCacheKey)) setLoading(true);
      const [{ data: prData }, { data: histData }] = await Promise.all([
        supabase.from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, name_es, muscle_group, equipment)')
          .eq('profile_id', user.id).order('estimated_1rm', { ascending: false }).limit(1000),
        supabase.from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', user.id).order('achieved_at', { ascending: true }).limit(500),
      ]);
      if (cancelled) return;
      setPrs(prData ?? []);
      const grouped = {};
      (histData ?? []).forEach(h => { if (!grouped[h.exercise_id]) grouped[h.exercise_id] = []; grouped[h.exercise_id].push(h); });
      setPrHistory(grouped);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user, prsCacheKey, setPrs, setPrHistory]);

  const filtered = prs.filter(pr => {
    const localName = pr.exercises ? (exName(pr.exercises) ?? '').toLowerCase() : '';
    const group = (pr.exercises?.muscle_group ?? '').toLowerCase();
    const equip = (pr.exercises?.equipment ?? '').toLowerCase();
    return (!search || localName.includes(search.toLowerCase()))
      && (filterGroup === 'all' || group === filterGroup)
      && (filterEquipment === 'all' || equip === filterEquipment);
  });

  // Split into new PRs this week vs all
  const weekAgo = subDays(new Date(), 7).toISOString();
  const newPRs = filtered.filter(pr => pr.achieved_at >= weekAgo);
  const allPRs = filtered;

  // Quick filter pills (muscle groups)
  const quickFilters = ['all', ...MUSCLE_GROUPS];

  return (
    <div className={embedded ? '' : 'min-h-screen'} style={{ background: embedded ? undefined : 'var(--color-bg-primary)' }}>
      <div className={embedded ? '' : 'max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pt-4 pb-28 md:pb-12'}>

        {/* Search bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 flex items-center gap-2.5 rounded-[14px] px-3.5 py-3"
            style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
            <Search size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('personalRecords.searchExercises', 'Search exercises...')}
              className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-muted)]"
              style={{ color: 'var(--color-text-primary)' }} />
          </div>
          <button onClick={() => setShowFilters(true)}
            className="relative w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 active:scale-95 focus:outline-none"
            style={{
              background: activeFilterCount > 0 ? `${TU_ACCENT}12` : 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: activeFilterCount > 0 ? TU_ACCENT : 'var(--color-text-muted)',
            }}>
            <SlidersHorizontal size={16} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: TU_ACCENT, color: '#001512' }}>{activeFilterCount}</span>
            )}
          </button>
        </div>

        {/* Quick filter pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-4">
          {quickFilters.map(g => (
            <button key={g} onClick={() => setFilterGroup(g)}
              className="px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap active:scale-95 transition-all flex-shrink-0"
              style={{
                background: filterGroup === g ? 'var(--color-text-primary)' : 'transparent',
                color: filterGroup === g ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
                border: filterGroup === g ? 'none' : '1px solid var(--color-border-subtle)',
              }}>
              {t(`personalRecords.muscleGroups.${g}`, g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1))}
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton variant="card" count={6} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Trophy size={40} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
            <p className="font-semibold text-[16px]" style={{ color: 'var(--color-text-primary)' }}>
              {prs.length === 0 ? t('personalRecords.noPRsYet') : t('personalRecords.noMatchingRecords')}
            </p>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {prs.length === 0 ? t('personalRecords.completeWorkoutsToPR') : t('personalRecords.adjustSearchOrFilter')}
            </p>
          </div>
        ) : (
          <FadeIn>
            {/* New PRs this week */}
            {newPRs.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Flame size={14} style={{ color: '#FF5A2E' }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
                    {t('personalRecords.newPRsThisWeek', 'New PRs this week')}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {newPRs.map(pr => (
                    <PRRow key={`new-${pr.exercise_id}`} pr={pr} history={prHistory[pr.exercise_id] ?? []} isNew />
                  ))}
                </div>
              </div>
            )}

            {/* All records */}
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
                  {t('personalRecords.allRecords', 'All records')} {'\u00B7'} {allPRs.length}
                </span>
              </div>
              <div className="space-y-2">
                {allPRs.map(pr => (
                  <PRRow key={`${pr.exercise_id}-${pr.achieved_at || ''}`} pr={pr} history={prHistory[pr.exercise_id] ?? []} />
                ))}
              </div>
            </div>
          </FadeIn>
        )}
      </div>

      {/* Filter Bottom Sheet */}
      {showFilters && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setShowFilters(false)}>
          <div className="w-full max-w-[520px] rounded-[24px] pb-6 pt-5"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
            <div className="px-5">
              <div className="flex items-center justify-between mb-5">
                <div style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5 }}>
                  {t('personalRecords.filters', 'Filters')}
                </div>
                <button onClick={() => { setFilterGroup('all'); setFilterEquipment('all'); }}
                  className="text-[13px] font-medium active:opacity-70" style={{ color: TU_ACCENT }}>
                  {t('personalRecords.clearFilters', 'Clear')}
                </button>
              </div>

              {/* Muscle Group */}
              <div className="mb-5">
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                  {t('personalRecords.muscleGroupLabel', 'Muscle Group')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['all', ...MUSCLE_GROUPS].map(g => (
                    <button key={g} onClick={() => setFilterGroup(g)}
                      className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] active:scale-95 transition-all"
                      style={{
                        background: filterGroup === g ? TU_ACCENT : 'var(--color-bg-card)',
                        color: filterGroup === g ? '#001512' : 'var(--color-text-muted)',
                        border: `1px solid ${filterGroup === g ? TU_ACCENT : 'var(--color-border-subtle)'}`,
                        fontWeight: filterGroup === g ? 700 : 500,
                      }}>
                      {t(`personalRecords.muscleGroups.${g}`, g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1))}
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipment */}
              <div className="mb-6">
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
                  {t('personalRecords.equipmentLabel', 'Equipment')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['all', ...EQUIPMENT_TYPES].map(eq => (
                    <button key={eq} onClick={() => setFilterEquipment(eq)}
                      className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] active:scale-95 transition-all"
                      style={{
                        background: filterEquipment === eq ? TU_ACCENT : 'var(--color-bg-card)',
                        color: filterEquipment === eq ? '#001512' : 'var(--color-text-muted)',
                        border: `1px solid ${filterEquipment === eq ? TU_ACCENT : 'var(--color-border-subtle)'}`,
                        fontWeight: filterEquipment === eq ? 700 : 500,
                      }}>
                      {t(`personalRecords.equipmentTypes.${eq}`, eq === 'all' ? 'All' : eq.charAt(0).toUpperCase() + eq.slice(1))}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setShowFilters(false)}
                className="w-full py-3.5 rounded-[14px] font-bold text-[14px] active:scale-[0.98] transition-all"
                style={{ background: TU_ACCENT, color: '#001512', fontFamily: TU_DISPLAY, letterSpacing: -0.2 }}>
                {t('personalRecords.showResults', { count: filtered.length, defaultValue: `Show ${filtered.length} Results` })}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
