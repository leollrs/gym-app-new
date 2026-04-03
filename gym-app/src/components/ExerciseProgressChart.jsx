import React, { useState, useEffect } from 'react';
import { X, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO } from 'date-fns';
import Skeleton from './Skeleton';
import FadeIn from './FadeIn';

// Custom dot for the projected point — gold dashed ring
function ProjectedDot({ cx, cy, payload }) {
  if (payload?.projected == null) return null;
  return (
    <g>
      <circle
        cx={cx} cy={cy} r={6}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeDasharray="3 2"
        opacity={0.75}
      />
      <circle cx={cx} cy={cy} r={2.5} fill="var(--color-accent)" opacity={0.6} />
    </g>
  );
}

// Custom tooltip: show "Projected: X lbs" for the projected column
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const proj   = payload.find(p => p.dataKey === 'projected');
  const real   = payload.find(p => p.dataKey === 'orm');
  if (proj?.value != null) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
        <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{label}</p>
        <p className="font-semibold text-[#D4AF37]">Projected: {proj.value} lbs</p>
      </div>
    );
  }
  if (real?.value != null) {
    return (
      <div className="bg-[var(--color-bg-card)] border border-white/10 rounded-xl px-3 py-2 shadow-xl shadow-black/40 text-[12px]">
        <p className="text-[var(--color-text-muted)] text-[11px] mb-1">{label}</p>
        <p className="font-semibold text-[#D4AF37]">Est. 1RM: {real.value} lbs</p>
      </div>
    );
  }
  return null;
}

function ExerciseProgressChart({ exerciseId, exerciseName, onClose }) {
  const { user } = useAuth();
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !exerciseId) return;
    const load = async () => {
      setLoading(true);
      const { data: rows } = await supabase
        .from('pr_history')
        .select('estimated_1rm, weight_lbs, reps, achieved_at')
        .eq('profile_id', user.id)
        .eq('exercise_id', exerciseId)
        .order('achieved_at', { ascending: true })
        .limit(12);

      setData((rows || []).map(r => ({
        date:   format(parseISO(r.achieved_at), 'MMM d'),
        orm:    Math.round(r.estimated_1rm),
        weight: r.weight_lbs,
        reps:   r.reps,
      })));
      setLoading(false);
    };
    load();
  }, [user, exerciseId]);

  const latestOrm = data[data.length - 1]?.orm;
  const firstOrm  = data[0]?.orm;
  const gain      = latestOrm && firstOrm && data.length > 1 ? latestOrm - firstOrm : null;

  // Linear regression projection
  const trendPoints = data.slice(-5);
  let projectedOrm  = null;
  let slope         = 0;
  if (trendPoints.length >= 2) {
    const n     = trendPoints.length;
    const xMean = (n - 1) / 2;
    const yMean = trendPoints.reduce((s, d) => s + d.orm, 0) / n;
    slope = trendPoints.reduce((s, d, i) => s + (i - xMean) * (d.orm - yMean), 0) /
            trendPoints.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
    projectedOrm = Math.round(trendPoints[n - 1].orm + slope * 4);
  }

  // Chart data: real points + one projected point stitched to the last real point
  const chartData = data.length > 0
    ? [
        ...data,
        {
          date:      '~4 wks',
          orm:       null,
          projected: projectedOrm,
          // bridge value so the dashed line connects from the last real orm
          bridge:    data[data.length - 1].orm,
        },
      ]
    : data;

  return (
    <div
      className="fixed inset-0 z-[160] flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="exercise-progress-title" className="w-full max-w-lg rounded-t-3xl bg-[var(--color-bg-card)] px-5 pt-4 pb-10 shadow-2xl animate-fade-in">
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full mx-auto mb-4 bg-white/20" />

        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[var(--color-text-muted)] mb-0.5">
              Estimated 1RM Progress
            </p>
            <h3 id="exercise-progress-title" className="font-bold text-[18px] leading-tight text-[var(--color-text-primary)] truncate">
              {exerciseName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5 bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Gain badge + projection chip */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {gain != null && gain > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/40 text-emerald-400 text-[12px] font-semibold">
              <TrendingUp size={12} />
              +{gain} lbs 1RM across {data.length} PRs
            </div>
          )}
          {trendPoints.length >= 3 && slope > 0 && projectedOrm != null && (
            <div className="inline-flex items-center gap-1 bg-[var(--color-bg-card)] border border-[#D4AF37]/30 text-[#D4AF37] text-[12px] rounded-full px-2.5 py-1">
              On track for ~{projectedOrm} lbs 1RM in 4 weeks
            </div>
          )}
          {trendPoints.length >= 3 && slope <= 0 && (
            <div className="inline-flex items-center gap-1 bg-[var(--color-bg-card)] border border-white/10 text-[var(--color-text-muted)] text-[12px] rounded-full px-2.5 py-1">
              Holding steady — focus on consistency
            </div>
          )}
        </div>

        {loading ? (
          <Skeleton variant="chart" />
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-44 gap-2 text-[var(--color-text-subtle)]">
            <TrendingUp size={32} className="opacity-25" />
            <p className="text-[13px] font-medium">No PR history yet</p>
            <p className="text-[12px] opacity-70 text-center">Hit a new personal record to start tracking your progress on this exercise.</p>
          </div>
        ) : (
          <FadeIn>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-accent-glow)' }} />
                {/* Real 1RM line */}
                <Line
                  type="monotone"
                  dataKey="orm"
                  stroke="var(--color-accent)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                  connectNulls={false}
                />
                {/* Bridge: invisible line that connects last real point to projected point */}
                <Line
                  type="monotone"
                  dataKey="bridge"
                  stroke="color-mix(in srgb, var(--color-accent) 45%, transparent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  legendType="none"
                  connectNulls={false}
                />
                {/* Projected point line */}
                <Line
                  type="monotone"
                  dataKey="projected"
                  stroke="color-mix(in srgb, var(--color-accent) 45%, transparent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={<ProjectedDot />}
                  activeDot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Recent PR rows */}
            <div className="mt-4 space-y-0">
              {[...data].reverse().slice(0, 4).map((d, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.06] last:border-0">
                  <span className="text-[12px] text-[var(--color-text-muted)]">{d.date}</span>
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                    {d.weight} lbs x {d.reps}
                    <span className="text-[11px] text-amber-400 font-normal ml-1.5">
                      ({d.orm} lbs 1RM)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </FadeIn>
        )}
      </div>
    </div>
  );
}

export default React.memo(ExerciseProgressChart);
