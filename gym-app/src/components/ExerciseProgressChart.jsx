import React, { useState, useEffect } from 'react';
import { X, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format, parseISO } from 'date-fns';

const tooltipStyle = {
  contentStyle: {
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: '#9CA3AF' },
  itemStyle:  { color: '#D4AF37' },
};

export default function ExerciseProgressChart({ exerciseId, exerciseName, onClose }) {
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

  return (
    <div
      className="fixed inset-0 z-[160] flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-t-3xl bg-white dark:bg-slate-900 px-5 pt-4 pb-10 shadow-2xl animate-fade-in">
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full mx-auto mb-4 bg-black/10 dark:bg-white/20" />

        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
              Estimated 1RM Progress
            </p>
            <h3 className="font-bold text-[18px] leading-tight text-slate-900 dark:text-slate-100">
              {exerciseName}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center mt-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Gain badge */}
        {gain != null && gain > 0 && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[12px] font-semibold mb-4">
            <TrendingUp size={12} />
            +{gain} lbs 1RM across {data.length} PRs
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-44">
            <div className="w-7 h-7 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-44 gap-2 text-slate-400 dark:text-slate-500">
            <TrendingUp size={32} className="opacity-25" />
            <p className="text-[13px] font-medium">No PR history yet</p>
            <p className="text-[12px] opacity-70 text-center">Hit a new personal record to start tracking your progress on this exercise.</p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9CA3AF', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value) => [`${value} lbs`, 'Est. 1RM']}
                />
                <Line
                  type="monotone"
                  dataKey="orm"
                  stroke="#D4AF37"
                  strokeWidth={2.5}
                  dot={{ fill: '#D4AF37', r: 4, strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: '#D4AF37' }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Recent PR rows */}
            <div className="mt-4 space-y-0">
              {[...data].reverse().slice(0, 4).map((d, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/[0.06] last:border-0">
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">{d.date}</span>
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    {d.weight} lbs × {d.reps}
                    <span className="text-[11px] text-amber-600 dark:text-amber-400 font-normal ml-1.5">
                      ({d.orm} lbs 1RM)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
