import { useState, useEffect } from 'react';
import {
  Trophy, ChevronDown, TrendingUp, Dumbbell,
} from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { format, parseISO } from 'date-fns';
import ChartTooltip from '../../components/ChartTooltip';

// ── PRRow (has data) ─────────────────────────────────────────────────────────
const PRRow = ({ pr, history }) => {
  const [open, setOpen] = useState(false);

  const chartData = (history ?? []).map(h => ({
    date: format(parseISO(h.achieved_at.slice(0, 10)), 'MMM d'),
    orm: Math.round(parseFloat(h.estimated_1rm)),
  }));

  const yMin = chartData.length ? Math.floor(Math.min(...chartData.map(d => d.orm)) - 5) : undefined;
  const yMax = chartData.length ? Math.ceil(Math.max(...chartData.map(d => d.orm)) + 5) : undefined;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
        aria-label={`Toggle details for ${pr.exercises?.name ?? 'exercise'}`}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37' }}
        >
          <Trophy size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold truncate text-[#E5E7EB]">
            {pr.exercises?.name}
          </p>
          <p className="text-[11px] text-[#9CA3AF]">
            {pr.weight_lbs} lbs x {pr.reps} · {format(parseISO(pr.achieved_at.slice(0, 10)), 'MMM d, yyyy')}
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
              Hit this lift again to see your 1RM trend
            </p>
          ) : (
            <div className="pt-3">
              <p className="text-[12px] font-medium mb-2 text-[#9CA3AF]">Estimated 1RM over time</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 4) - 1)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                  <Line
                    type="monotone"
                    dataKey="orm"
                    stroke="#D4AF37"
                    strokeWidth={2}
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

// ── ExerciseRow (no data) ────────────────────────────────────────────────────
const EmptyExerciseRow = ({ name }) => (
  <div className="flex items-center gap-3 px-4 py-3.5">
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: 'rgba(255,255,255,0.04)' }}
    >
      <Dumbbell size={15} className="text-[#4B5563]" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[14px] font-semibold truncate text-[#E5E7EB]">{name}</p>
      <p className="text-[11px] text-[#4B5563]">No data recorded yet</p>
    </div>
    <p className="text-[13px] text-[#4B5563] flex-shrink-0">—</p>
  </div>
);

// ── StrengthTab ──────────────────────────────────────────────────────────────
export default function ProgressStrength() {
  const { user } = useAuth();
  const [prs, setPrs] = useState([]);
  const [prHistory, setPrHistory] = useState({});
  const [allExercises, setAllExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      const [prRes, histRes, exRes] = await Promise.all([
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
          .from('exercises')
          .select('id, name')
          .order('name', { ascending: true }),
      ]);

      if (cancelled) return;

      if (prRes.error || histRes.error) {
        setError('Failed to load strength data');
        setLoading(false);
        return;
      }

      setPrs(prRes.data ?? []);
      setAllExercises(exRes.data ?? []);

      const grouped = {};
      (histRes.data ?? []).forEach(h => {
        if (!grouped[h.exercise_id]) grouped[h.exercise_id] = [];
        grouped[h.exercise_id].push(h);
      });
      setPrHistory(grouped);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="card" height="h-[80px]" />
        <Skeleton variant="card" height="h-[120px]" count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-800 rounded-2xl p-4 text-center">
        <p className="text-[14px] text-red-400">{error}</p>
      </div>
    );
  }

  // Build combined list: PRs first (top 5), then remaining exercises without data
  const prExerciseIds = new Set(prs.map(p => p.exercise_id));
  const exercisesWithoutPR = allExercises.filter(e => !prExerciseIds.has(e.id));

  return (
    <div>
      {/* Personal Records */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[15px] font-bold text-[#E5E7EB]">
          Personal Records
          {prs.length > 0 && (
            <span
              className="ml-2 text-[12px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37' }}
            >
              {prs.length}
            </span>
          )}
        </p>
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-[12px] font-semibold text-[#D4AF37]"
        >
          {showAll ? 'Show top 5' : 'See all'}
        </button>
      </div>

      {prs.length === 0 && !showAll ? (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 py-16 flex flex-col items-center gap-3">
          <TrendingUp size={32} className="text-[#4B5563]" strokeWidth={1.5} />
          <p className="text-[14px] text-[#9CA3AF]">No PRs yet</p>
          <p className="text-[12px] text-[#6B7280]">Complete workouts to start tracking</p>
        </div>
      ) : (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 overflow-hidden divide-y divide-white/4">
          {(showAll ? prs : prs.slice(0, 5)).map(pr => (
            <PRRow key={pr.exercise_id} pr={pr} history={prHistory[pr.exercise_id] ?? []} />
          ))}
          {showAll && exercisesWithoutPR.map(ex => (
            <EmptyExerciseRow key={ex.id} name={ex.name} />
          ))}
        </div>
      )}
    </div>
  );
}
