import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Dumbbell, Clock, Zap, ChevronDown,
} from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import LoadMoreButton from '../../components/LoadMoreButton';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import usePaginatedQuery from '../../hooks/usePaginatedQuery';
import { formatDuration, formatMonthYear } from './progressConstants';

// ── SessionCard (local to History) ───────────────────────────────────────────
const SessionCard = ({ session }) => {
  const [expanded, setExpanded] = useState(false);

  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prSets = allSets.filter(s => s.is_pr);
  const volumeK = parseFloat(session.total_volume_lbs) || 0;
  const volumeStr = volumeK >= 1000
    ? `${(volumeK / 1000).toFixed(1)}k lbs`
    : `${Math.round(volumeK)} lbs`;

  return (
    <div className="bg-[#0F172A] rounded-2xl border border-white/8 overflow-hidden transition-all">
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">
            {new Date(session.completed_at).toLocaleDateString('en-US', { month: 'short' })}
          </p>
          <p className="text-[24px] font-black leading-none text-[#E5E7EB]">
            {new Date(session.completed_at).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[16px] leading-tight truncate text-[#E5E7EB]">
            {session.name}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Clock size={11} /> {formatDuration(session.duration_seconds)}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Zap size={11} /> {volumeStr}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Dumbbell size={11} /> {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </span>
            {prSets.length > 0 && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-[#D4AF37]">
                <Trophy size={11} /> {prSets.length} PR{prSets.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={18}
          className="flex-shrink-0 mt-1 transition-transform duration-200 text-[#9CA3AF]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-4 border-t border-white/8">
          <div className="pt-3 flex flex-col gap-3">
            {exercises
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map((ex) => {
                const completedSets = (ex.session_sets ?? []).filter(s => s.is_completed);
                const hasPR = completedSets.some(s => s.is_pr);
                return (
                  <div key={ex.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-semibold text-[14px] text-[#E5E7EB]">
                        {ex.snapshot_name}
                      </p>
                      {hasPR && <Trophy size={13} className="text-[#D4AF37]" />}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {completedSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map((set, i) => (
                          <div
                            key={i}
                            className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                            style={
                              set.is_pr
                                ? { background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }
                                : { background: '#111827', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' }
                            }
                          >
                            {set.weight_lbs} x {set.reps}
                            {set.is_pr && ' PR'}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── HistoryTab ───────────────────────────────────────────────────────────────
export default function ProgressHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [expandedMonths, setExpandedMonths] = useState(new Set());

  const {
    data: sessions,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  } = usePaginatedQuery({
    table: 'workout_sessions',
    select: `id, name, completed_at, duration_seconds, total_volume_lbs,
      session_exercises(id, snapshot_name, position,
        session_sets(set_number, weight_lbs, reps, is_completed, is_pr))`,
    filters: { profile_id: user?.id, status: 'completed' },
    orderBy: 'completed_at',
    ascending: false,
    pageSize: 30,
    enabled: !!user?.id,
  });

  // Auto-expand current month on first load
  useEffect(() => {
    if (sessions.length > 0 && expandedMonths.size === 0) {
      setExpandedMonths(new Set([formatMonthYear(new Date().toISOString())]));
    }
  }, [sessions.length]);

  // Group sessions by month
  const grouped = sessions.reduce((acc, s) => {
    const key = formatMonthYear(s.completed_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});
  const months = Object.keys(grouped);

  const toggleMonth = (month) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  if (loading) {
    return <Skeleton variant="list-item" count={3} />;
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Dumbbell}
        title="No workouts yet"
        description="Complete your first session to see it here"
        actionLabel="Go to Workouts"
        onAction={() => navigate('/workouts')}
      />
    );
  }

  return (
    <div>
      <p className="text-[12px] mb-4 text-[#9CA3AF]">
        {sessions.length} workout{sessions.length !== 1 ? 's' : ''} completed
      </p>
      {months.map(month => {
        const isExpanded = expandedMonths.has(month);
        const count = grouped[month].length;
        return (
          <div key={month} className="mb-4">
            <button
              onClick={() => toggleMonth(month)}
              className="w-full flex items-center justify-between mb-3 group"
            >
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">
                  {month}
                </p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/6 text-[#6B7280]">
                  {count}
                </span>
              </div>
              <ChevronDown
                size={15}
                className="text-[#4B5563] transition-transform duration-200"
                style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>
            {isExpanded ? (
              <div className="flex flex-col gap-3">
                {grouped[month].map(session => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="bg-[#0F172A] rounded-2xl border border-white/8 px-4 py-3">
                <p className="text-[12px] text-[#6B7280]">
                  {count} workout{count !== 1 ? 's' : ''} · Tap to expand
                </p>
              </div>
            )}
          </div>
        );
      })}
      <LoadMoreButton hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}
