import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trophy, ChevronDown, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO } from 'date-fns';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import CoachMark from '../components/CoachMark';
import ChartTooltip from '../components/ChartTooltip';

// ── Strength standards (bodyweight multipliers) ───────────────────────────────
// Tiers: beginner → novice → intermediate → advanced → elite
const STANDARDS = [
  {
    exerciseId: 'ex_bp',
    name:       'Bench Press',
    tiers:      [0.5, 0.75, 1.25, 1.75, 2.0],
  },
  {
    exerciseId: 'ex_sq',
    name:       'Back Squat',
    tiers:      [0.75, 1.25, 1.75, 2.25, 2.75],
  },
  {
    exerciseId: 'ex_dl',
    name:       'Deadlift',
    tiers:      [1.0, 1.5, 2.0, 2.5, 3.0],
  },
  {
    exerciseId: 'ex_ohp',
    name:       'Overhead Press',
    tiers:      [0.35, 0.55, 0.75, 1.1, 1.4],
  },
  {
    exerciseId: 'ex_bbr',
    name:       'Barbell Row',
    tiers:      [0.5, 0.75, 1.0, 1.5, 1.75],
  },
];

const TIER_LABELS  = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const TIER_KEYS    = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];
const TIER_COLORS  = ['#6B7280', '#60A5FA', '#10B981', '#D4AF37', '#EF4444'];


// ── Helper: compute tier index (0 = below beginner, 5 = elite+) ──────────────
const getTier = (orm, bw, tiers) => {
  if (!bw) return -1;
  const ratio = orm / bw;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (ratio >= tiers[i]) return i;
  }
  return -1; // below beginner
};

// ── Helper: progress % within current tier ───────────────────────────────────
const getTierProgress = (orm, bw, tiers, tier) => {
  if (!bw || tier < 0) return 0;
  if (tier >= tiers.length - 1) return 100; // elite or above
  const lo = tier < 0 ? 0 : tiers[tier] * bw;
  const hi = tiers[tier + 1] * bw;
  return Math.min(100, Math.round(((orm - lo) / (hi - lo)) * 100));
};

// ── Standards card ────────────────────────────────────────────────────────────
const StandardCard = ({ standard, pr, bodyweight }) => {
  const { t } = useTranslation('pages');
  const orm  = pr ? parseFloat(pr.estimated_1rm) : null;
  const tier = orm != null ? getTier(orm, bodyweight, standard.tiers) : -1;

  const tierLabel = tier < 0
    ? t('strength.noData')
    : tier < TIER_KEYS.length
      ? t(`strength.tierLabels.${TIER_KEYS[tier]}`)
      : t('strength.tierLabels.elite');

  const tierColor = tier < 0
    ? '#4B5563'
    : TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];

  const progress = orm != null
    ? getTierProgress(orm, bodyweight, standard.tiers, tier)
    : 0;

  const nextTierLbs = (tier < standard.tiers.length - 1 && bodyweight)
    ? Math.ceil(standard.tiers[tier + 1] * bodyweight)
    : null;

  return (
    <div className="bg-[#0F172A] rounded-2xl border border-white/8 p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[14px] font-semibold text-[#E5E7EB]">
          {standard.name}
        </p>
        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: `${tierColor}18`, color: tierColor }}
        >
          {tierLabel}
        </span>
      </div>

      {orm != null ? (
        <>
          <p className="text-[28px] font-black text-white leading-none mb-1">
            {Math.round(orm)}
            <span className="text-[13px] font-medium ml-1 text-[#9CA3AF]">{t('strength.lbs')}</span>
          </p>
          <p className="text-[11px] mb-3 text-[#9CA3AF]">
            {pr.weight_lbs} lbs × {pr.reps} reps
          </p>

          {/* Tier progress bar */}
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full w-full overflow-hidden bg-white/6">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: tierColor,
                }}
              />
            </div>
            {nextTierLbs && tier < TIER_KEYS.length - 1 && (
              <p className="text-[10px] text-[#9CA3AF]">
                {t('strength.lbsTo', { count: nextTierLbs - Math.round(orm) })}{' '}
                <span style={{ color: TIER_COLORS[Math.min(tier + 1, TIER_COLORS.length - 1)] }}>
                  {t(`strength.tierLabels.${TIER_KEYS[tier + 1]}`)}
                </span>
              </p>
            )}
          </div>

          {/* Tier dots */}
          <div className="flex items-center gap-1 mt-3">
            {TIER_KEYS.map((tk, i) => (
              <div
                key={tk}
                className="flex-1 h-1 rounded-full"
                style={{ background: i <= tier ? TIER_COLORS[i] : 'rgba(255,255,255,0.08)' }}
                title={t(`strength.tierLabels.${tk}`)}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="text-[12px] mt-1 text-[#9CA3AF]">
          {t('strength.logLiftToSeeLevel')}
        </p>
      )}
    </div>
  );
};

// ── PR history chart row ──────────────────────────────────────────────────────
const PRRow = ({ pr, history }) => {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);

  const chartData = (history ?? []).map(h => ({
    date: format(parseISO(h.achieved_at.slice(0, 10)), 'MMM d'),
    orm:  Math.round(parseFloat(h.estimated_1rm)),
  }));

  const yMin = chartData.length ? Math.floor(Math.min(...chartData.map(d => d.orm)) - 5) : undefined;
  const yMax = chartData.length ? Math.ceil(Math.max(...chartData.map(d => d.orm))  + 5) : undefined;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)' }}
        >
          <Trophy size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold truncate text-[#E5E7EB]">
            {pr.exercises?.name}
          </p>
          <p className="text-[11px] text-[#9CA3AF]">
            {pr.weight_lbs} lbs × {pr.reps} · {format(parseISO(pr.achieved_at.slice(0, 10)), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="text-[17px] font-black text-[#D4AF37]">
            {Math.round(parseFloat(pr.estimated_1rm))}
            <span className="text-[11px] font-medium ml-0.5 text-[#9CA3AF]">lbs</span>
          </p>
          <ChevronDown
            size={15}
            className="text-[#9CA3AF]"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/4">
          {chartData.length < 2 ? (
            <p className="text-[12px] pt-3 text-[#9CA3AF]">
              {t('strength.hitLiftAgainTrend')}
            </p>
          ) : (
            <div className="pt-3">
              <p className="text-[12px] font-medium mb-2 text-[#9CA3AF]">
                {t('strength.estimated1RMOverTime')}
              </p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false} axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 4) - 1)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false} axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' }} />
                  <Line
                    type="monotone" dataKey="orm"
                    stroke="#D4AF37" strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Strength() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const { user } = useAuth();

  const [prs,        setPrs]        = useState([]);
  const [prHistory,  setPrHistory]  = useState({}); // { exerciseId: [...] }
  const [bodyweight, setBodyweight] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [showPRs,    setShowPRs]    = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: prData }, { data: histData }, { data: bwData }] = await Promise.all([
      supabase
        .from('personal_records')
        .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
        .eq('profile_id', user.id)
        .order('estimated_1rm', { ascending: false }),
      supabase
        .from('pr_history')
        .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
        .eq('profile_id', user.id)
        .order('achieved_at', { ascending: true }),
      supabase
        .from('body_weight_logs')
        .select('weight_lbs')
        .eq('profile_id', user.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    setPrs(prData ?? []);
    setBodyweight(bwData?.weight_lbs ? parseFloat(bwData.weight_lbs) : null);

    // Group history by exercise_id
    const grouped = {};
    (histData ?? []).forEach(h => {
      if (!grouped[h.exercise_id]) grouped[h.exercise_id] = [];
      grouped[h.exercise_id].push(h);
    });
    setPrHistory(grouped);

    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Map PRs by exerciseId for standards lookup
  const prByExercise = prs.reduce((acc, pr) => ({ ...acc, [pr.exercise_id]: pr }), {});

  // Separate "key lifts" (with standards) from others
  const standardExerciseIds = new Set(STANDARDS.map(s => s.exerciseId));
  const otherPrs = prs.filter(pr => !standardExerciseIds.has(pr.exercise_id));

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors bg-[#0F172A] border border-white/8"
        >
          <ArrowLeft size={18} className="text-[#9CA3AF]" />
        </button>
        <div>
          <h1 className="text-[20px] font-bold text-[#E5E7EB]">{t('strength.pageTitle')}</h1>
          <p className="text-[12px] text-[#9CA3AF]">{t('strength.pageSubtitle')}</p>
        </div>
      </div>

      {loading ? (
        <><Skeleton variant="stat" count={2} /><Skeleton variant="chart" /></>
      ) : (
        <FadeIn>
          {/* ── Personal Records button (top-right) ──────────────────── */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowPRs(s => !s)}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2.5 rounded-xl transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
            >
              <Trophy size={14} />
              {t('strength.personalRecords')}
              {prs.length > 0 && (
                <span
                  className="text-[11px] font-bold px-1.5 py-0.5 rounded-full ml-0.5"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
                >
                  {prs.length}
                </span>
              )}
            </button>
          </div>

          {/* ── Personal records (expandable) ─────────────────────────── */}
          {showPRs && (
            <>
              {prs.length === 0 ? (
                <div className="bg-[#0F172A] rounded-2xl border border-white/8 py-16 flex flex-col items-center gap-3 mb-7">
                  <TrendingUp size={32} className="text-[#4B5563]" strokeWidth={1.5} />
                  <p className="text-[14px] text-[#9CA3AF]">{t('strength.noPRsYet')}</p>
                  <p className="text-[12px] text-[#6B7280]">{t('strength.completeWorkoutsToTrack')}</p>
                </div>
              ) : (
                <div className="bg-[#0F172A] rounded-2xl border border-white/8 overflow-hidden divide-y divide-white/4 mb-7">
                  {prs.map(pr => (
                    <PRRow
                      key={pr.exercise_id}
                      pr={pr}
                      history={prHistory[pr.exercise_id] ?? []}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Top exercises (standard cards) ────────────────────────── */}
          <CoachMark
            id="strength-standards"
            title={t('strength.coachMarkTitle')}
            description={t('strength.coachMarkDesc')}
            position="bottom"
          >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
            {STANDARDS.map(std => (
              <StandardCard
                key={std.exerciseId}
                standard={std}
                pr={prByExercise[std.exerciseId] ?? null}
                bodyweight={bodyweight}
              />
            ))}
          </div>
          </CoachMark>

          {/* ── Strength standards ──────────────────────────────────────── */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold text-[#E5E7EB]">
                {t('strength.strengthStandards')}
              </p>
              {!bodyweight && (
                <button
                  onClick={() => navigate('/progress?tab=body')}
                  className="text-[11px] font-semibold px-3 py-1 rounded-xl"
                  style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                >
                  {t('strength.logWeightToUnlock')}
                </button>
              )}
            </div>
            {bodyweight && (
              <p className="text-[12px] mb-3 text-[#9CA3AF]">
                {t('strength.basedOnBodyweight', { weight: bodyweight })}
              </p>
            )}
          </div>
        </FadeIn>
      )}
    </div>
  );
}
