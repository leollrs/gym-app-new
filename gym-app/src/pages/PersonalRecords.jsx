import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trophy, ChevronDown, TrendingUp, Search, Filter } from 'lucide-react';
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
  itemStyle: { color: '#D4AF37' },
};

const MUSCLE_GROUPS = ['All', 'Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core'];

const PRRow = ({ pr, history }) => {
  const [expanded, setExpanded] = useState(false);
  const orm = parseFloat(pr.estimated_1rm);
  const name = pr.exercises?.name ?? pr.exercise_id;
  const group = pr.exercises?.muscle_group ?? '';
  const chartData = history.map(h => ({
    date: format(parseISO(h.achieved_at), 'MMM d'),
    orm: Math.round(parseFloat(h.estimated_1rm)),
  }));

  return (
    <div className="overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <Trophy size={15} className="text-[#D4AF37] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{name}</p>
          <p className="text-[11px] text-[#6B7280]">
            {group && <span className="capitalize">{group} · </span>}
            {format(parseISO(pr.achieved_at), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="text-right flex-shrink-0 mr-2">
          <p className="text-[16px] font-black text-[#D4AF37]">{Math.round(orm)}</p>
          <p className="text-[10px] text-[#6B7280]">est. 1RM</p>
        </div>
        <ChevronDown
          size={15}
          className="flex-shrink-0 transition-transform duration-200 text-[#4B5563]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/6">
          <div className="mt-3 grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-xl p-2.5 text-center bg-[#111827]">
              <p className="text-[16px] font-black text-white">{pr.weight_lbs}</p>
              <p className="text-[9px] font-semibold uppercase text-[#6B7280]">Weight (lbs)</p>
            </div>
            <div className="rounded-xl p-2.5 text-center bg-[#111827]">
              <p className="text-[16px] font-black text-white">{pr.reps}</p>
              <p className="text-[9px] font-semibold uppercase text-[#6B7280]">Reps</p>
            </div>
            <div className="rounded-xl p-2.5 text-center bg-[#111827]">
              <p className="text-[16px] font-black text-[#D4AF37]">{Math.round(orm)}</p>
              <p className="text-[9px] font-semibold uppercase text-[#6B7280]">Est. 1RM</p>
            </div>
          </div>

          {chartData.length > 1 ? (
            <div>
              <p className="text-[11px] font-semibold text-[#6B7280] mb-2">Estimated 1RM over time</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} lbs`, 'Est. 1RM']} />
                  <Line
                    type="monotone"
                    dataKey="orm"
                    stroke="#D4AF37"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#D4AF37', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#D4AF37' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-[#6B7280] text-center py-3">
              Hit this lift again to see your 1RM trend
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default function PersonalRecords() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [prs, setPrs] = useState([]);
  const [prHistory, setPrHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGroup, setFilterGroup] = useState('All');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [{ data: prData }, { data: histData }] = await Promise.all([
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
    const name = (pr.exercises?.name ?? '').toLowerCase();
    const group = (pr.exercises?.muscle_group ?? '').toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchGroup = filterGroup === 'All' || group === filterGroup.toLowerCase();
    return matchSearch && matchGroup;
  });

  return (
    <div className="min-h-screen bg-[#05070B]">
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[#05070B]/95 border-b border-white/6">
        <div className="max-w-[720px] mx-auto px-4 md:px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-xl bg-white/6 flex items-center justify-center"
            >
              <ArrowLeft size={18} className="text-[#E5E7EB]" />
            </button>
            <div>
              <h1
                className="text-[20px] font-black text-[#E5E7EB]"
                style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
              >
                Personal Records
              </h1>
              <p className="text-[11px] text-[#6B7280]">{prs.length} exercise{prs.length !== 1 ? 's' : ''} tracked</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-4 md:px-6 pt-4 pb-28 md:pb-12">
        {/* Search */}
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563]" />
          <input
            type="text"
            placeholder="Search exercises..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0F172A] border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
          />
        </div>

        {/* Muscle group filter */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-5">
          {MUSCLE_GROUPS.map(g => (
            <button
              key={g}
              onClick={() => setFilterGroup(g)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors"
              style={
                filterGroup === g
                  ? { background: 'rgba(212,175,55,0.15)', color: '#D4AF37' }
                  : { background: '#111827', color: '#6B7280', border: '1px solid rgba(255,255,255,0.08)' }
              }
            >
              {g}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Trophy size={40} className="mx-auto mb-4 text-[#9CA3AF] opacity-40" />
            <p className="font-semibold text-[16px] text-[#E5E7EB]">
              {prs.length === 0 ? 'No PRs yet' : 'No matching records'}
            </p>
            <p className="text-[13px] mt-1.5 text-[#9CA3AF]">
              {prs.length === 0
                ? 'Complete workouts to start tracking personal records'
                : 'Try adjusting your search or filter'}
            </p>
          </div>
        ) : (
          <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden divide-y divide-white/4">
            {filtered.map(pr => (
              <PRRow key={pr.exercise_id} pr={pr} history={prHistory[pr.exercise_id] ?? []} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
