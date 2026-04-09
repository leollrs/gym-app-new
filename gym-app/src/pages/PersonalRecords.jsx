import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { ArrowLeft, Trophy, ChevronDown, TrendingUp, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO } from 'date-fns';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import ChartTooltip from '../components/ChartTooltip';
import { exName } from '../lib/exerciseName';

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'legs', 'arms', 'core'];
const EQUIPMENT_TYPES = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];

const PRRow = ({ pr, history }) => {
  const { t } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const orm = parseFloat(pr.estimated_1rm);
  const name = pr.exercises ? exName(pr.exercises) : pr.exercise_id;
  const group = pr.exercises?.muscle_group ?? '';
  const groupLabel = group ? t(`muscleGroups.${group.charAt(0).toUpperCase() + group.slice(1)}`, group) : '';
  // Group by date and take max 1RM per day to avoid duplicate data points
  const byDate = {};
  history.forEach(h => {
    const dateKey = h.achieved_at.slice(0, 10);
    const orm = parseFloat(h.estimated_1rm);
    if (!byDate[dateKey] || orm > byDate[dateKey].orm) {
      byDate[dateKey] = { dateKey, orm };
    }
  });
  const chartData = Object.values(byDate)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .map(d => ({
      date: format(parseISO(d.dateKey), 'MMM d'),
      orm: Math.round(d.orm),
    }));

  return (
    <div className="overflow-hidden hover:bg-white/[0.03] transition-all">
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
        onClick={() => setExpanded(e => !e)}
        aria-label={`Toggle details for ${name}`}
      >
        <Trophy size={15} className="text-[#D4AF37] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate">{name}</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {groupLabel && <span className="capitalize">{groupLabel} · </span>}
            {format(parseISO(pr.achieved_at), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="text-right flex-shrink-0 mr-2">
          <p className="text-[16px] font-black text-[#D4AF37]">{Math.round(orm)}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">{t('personalRecords.est1RM')}</p>
        </div>
        <ChevronDown
          size={15}
          className="flex-shrink-0 transition-transform duration-200 text-[var(--color-text-subtle)]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/6">
          <div className="mt-3 grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-xl p-2.5 text-center bg-[var(--color-bg-card)]">
              <p className="text-[16px] font-black" style={{ color: 'var(--color-text-primary)' }}>{pr.weight_lbs}</p>
              <p className="text-[9px] font-semibold uppercase text-[var(--color-text-muted)]">{t('personalRecords.weightLbs')}</p>
            </div>
            <div className="rounded-xl p-2.5 text-center bg-[var(--color-bg-card)]">
              <p className="text-[16px] font-black" style={{ color: 'var(--color-text-primary)' }}>{pr.reps}</p>
              <p className="text-[9px] font-semibold uppercase text-[var(--color-text-muted)]">{t('personalRecords.reps')}</p>
            </div>
            <div className="rounded-xl p-2.5 text-center bg-[var(--color-bg-card)]">
              <p className="text-[16px] font-black text-[#D4AF37]">{Math.round(orm)}</p>
              <p className="text-[9px] font-semibold uppercase text-[var(--color-text-muted)]">{t('personalRecords.estimated1RM')}</p>
            </div>
          </div>

          {chartData.length > 1 ? (
            <div>
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] mb-2">{t('personalRecords.estimated1RMOverTime')}</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                  <Line
                    type="monotone"
                    dataKey="orm"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--color-text-muted)] text-center py-3">
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
  const [prs, setPrs] = useState([]);
  const [prHistory, setPrHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterEquipment, setFilterEquipment] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = (filterGroup !== 'all' ? 1 : 0) + (filterEquipment !== 'all' ? 1 : 0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [{ data: prData }, { data: histData }] = await Promise.all([
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, name_es, muscle_group, equipment)')
          .eq('profile_id', user.id)
          .order('estimated_1rm', { ascending: false })
          .limit(200),
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', user.id)
          .order('achieved_at', { ascending: true })
          .limit(500),
      ]);

      if (cancelled) return;

      setPrs(prData ?? []);
      const grouped = {};
      (histData ?? []).forEach(h => {
        if (!grouped[h.exercise_id]) grouped[h.exercise_id] = [];
        grouped[h.exercise_id].push(h);
      });
      setPrHistory(grouped);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  const filtered = prs.filter(pr => {
    const localName = pr.exercises ? (exName(pr.exercises) ?? '').toLowerCase() : '';
    const group = (pr.exercises?.muscle_group ?? '').toLowerCase();
    const equip = (pr.exercises?.equipment ?? '').toLowerCase();
    const matchSearch = !search || localName.includes(search.toLowerCase());
    const matchGroup = filterGroup === 'all' || group === filterGroup;
    const matchEquip = filterEquipment === 'all' || equip === filterEquipment;
    return matchSearch && matchGroup && matchEquip;
  });

  return (
    <div className={embedded ? '' : 'min-h-screen bg-[var(--color-bg-primary)]'}>
      {/* Header */}
      {!embedded && (
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[var(--color-bg-primary)]/95 border-b border-white/6">
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="w-11 h-11 rounded-xl bg-white/6 flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            >
              <ArrowLeft size={18} className="text-[var(--color-text-primary)]" />
            </button>
            <div>
              <h1
                className="text-[20px] font-black text-[var(--color-text-primary)] truncate"
                style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
              >
                {t('personalRecords.title')}
              </h1>
              <p className="text-[11px] text-[var(--color-text-muted)]">{t('personalRecords.exercisesTracked', { count: prs.length })}</p>
            </div>
          </div>
        </div>
      </div>
      )}

      <div className={embedded ? '' : 'max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pt-4 pb-28 md:pb-12'}>
        {/* Search + Filter */}
        <div className="flex items-center gap-2 mb-5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <input
              type="text"
              placeholder={t('personalRecords.searchExercises')}
              aria-label="Search exercises"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[var(--color-bg-card)] border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-subtle)] outline-none focus:border-[#D4AF37]/40"
            />
          </div>
          <button
            onClick={() => setShowFilters(true)}
            aria-label="Open filters"
            className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-all active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{
              background: activeFilterCount > 0 ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-bg-card)',
              color: activeFilterCount > 0 ? 'var(--color-accent)' : 'var(--color-text-subtle)',
              border: '1px solid rgba(255,255,255,0.08)',
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

        {loading ? (
          <Skeleton variant="card" count={6} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Trophy size={40} className="mx-auto mb-4 text-[var(--color-text-muted)] opacity-40" />
            <p className="font-semibold text-[16px] text-[var(--color-text-primary)]">
              {prs.length === 0 ? t('personalRecords.noPRsYet') : t('personalRecords.noMatchingRecords')}
            </p>
            <p className="text-[13px] mt-1.5 text-[var(--color-text-muted)]">
              {prs.length === 0
                ? t('personalRecords.completeWorkoutsToPR')
                : t('personalRecords.adjustSearchOrFilter')}
            </p>
          </div>
        ) : (
          <FadeIn>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(pr => (
                <div key={pr.exercise_id} className="bg-[var(--color-bg-card)] rounded-2xl border border-white/8 overflow-hidden hover:border-white/20 transition-all">
                  <PRRow pr={pr} history={prHistory[pr.exercise_id] ?? []} />
                </div>
              ))}
            </div>
          </FadeIn>
        )}
      </div>

      {/* Filter Bottom Sheet */}
      {showFilters && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={e => e.target === e.currentTarget && setShowFilters(false)}
          role="dialog"
          aria-labelledby="pr-filters-title"
        >
          <div
            className="w-full max-w-[520px] rounded-t-[24px] pb-8 pt-3 animate-slide-up"
            style={{ background: 'var(--color-bg-card)', borderTop: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))' }}
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-5" />

            <div className="px-6">
              <div className="flex items-center justify-between mb-6">
                <h3 id="pr-filters-title" className="text-[17px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {t('personalRecords.filters', 'Filters')}
                </h3>
                <button
                  onClick={() => { setFilterGroup('all'); setFilterEquipment('all'); }}
                  className="text-[13px] font-medium text-[#D4AF37] active:opacity-70"
                >
                  {t('personalRecords.clearFilters', 'Clear Filters')}
                </button>
              </div>

              {/* Muscle Group */}
              <div className="mb-6">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">
                  {t('personalRecords.muscleGroupLabel', 'Muscle Group')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['all', ...MUSCLE_GROUPS].map(g => {
                    const active = filterGroup === g;
                    return (
                      <button
                        key={g}
                        onClick={() => setFilterGroup(g)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.04)',
                          color: active ? 'var(--color-bg-secondary, #0A0D14)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`personalRecords.muscleGroups.${g}`, g.charAt(0).toUpperCase() + g.slice(1))}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Equipment */}
              <div className="mb-8">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] mb-3 text-[#5B6276]">
                  {t('personalRecords.equipmentLabel', 'Equipment')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {['all', ...EQUIPMENT_TYPES].map(eq => {
                    const active = filterEquipment === eq;
                    return (
                      <button
                        key={eq}
                        onClick={() => setFilterEquipment(eq)}
                        className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-[10px] transition-all active:scale-95"
                        style={{
                          background: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.04)',
                          color: active ? 'var(--color-bg-secondary, #0A0D14)' : 'var(--color-text-muted)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'rgba(255,255,255,0.08)'}`,
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t(`personalRecords.equipmentTypes.${eq}`, eq.charAt(0).toUpperCase() + eq.slice(1))}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => setShowFilters(false)}
                className="w-full py-3.5 rounded-xl font-bold text-[14px] active:scale-[0.98] transition-all bg-[#D4AF37] text-[#0A0D14]"
              >
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
