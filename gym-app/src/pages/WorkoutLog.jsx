import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronRight, Trophy, Dumbbell, Clock, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const formatDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatMonthYear = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

// ── Session Card ──────────────────────────────────────────────────────────────
const SessionCard = ({ session }) => {
  const [expanded, setExpanded] = useState(false);

  const exercises  = session.session_exercises ?? [];
  const allSets    = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prSets     = allSets.filter(s => s.is_pr);
  const volumeK    = (parseFloat(session.total_volume_lbs) || 0);
  const volumeStr  = volumeK >= 1000
    ? `${(volumeK / 1000).toFixed(1)}k lbs`
    : `${Math.round(volumeK)} lbs`;

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden transition-all">

      {/* Main row */}
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Date block */}
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">
            {new Date(session.completed_at).toLocaleDateString('en-US', { month: 'short' })}
          </p>
          <p className="text-[24px] font-black leading-none text-[#E5E7EB]">
            {new Date(session.completed_at).getDate()}
          </p>
        </div>

        {/* Info */}
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

        {/* Expand arrow */}
        <ChevronDown
          size={18}
          className="flex-shrink-0 mt-1 transition-transform duration-200 text-[#9CA3AF]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Expanded exercise list */}
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
                            {set.weight_lbs} × {set.reps}
                            {set.is_pr && ' 🏆'}
                          </div>
                        ))
                      }
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const WorkoutLog = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);

      const { data } = await supabase
        .from('workout_sessions')
        .select(`
          id, name, completed_at, duration_seconds, total_volume_lbs,
          session_exercises(
            id, snapshot_name, position,
            session_sets(set_number, weight_lbs, reps, is_completed, is_pr)
          )
        `)
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      setSessions(data ?? []);
      setLoading(false);
    };

    load();
  }, [user]);

  // Group sessions by month
  const grouped = sessions.reduce((acc, s) => {
    const key = formatMonthYear(s.completed_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const months = Object.keys(grouped);

  return (
    <div className="mx-auto w-full max-w-[680px] px-4 md:px-6 pt-6 pb-28 md:pb-12 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:opacity-70 bg-[#111827] text-[#9CA3AF]"
        >
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
        <div>
          <h1 className="font-black text-[24px] leading-tight text-[#E5E7EB]" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Workout Log
          </h1>
          {!loading && (
            <p className="text-[12px] mt-0.5 text-[#9CA3AF]">
              {sessions.length} workout{sessions.length !== 1 ? 's' : ''} completed
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <Skeleton variant="list-item" count={3} />
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <EmptyState
          icon={Dumbbell}
          title="No workouts yet"
          description="Complete your first session to see it here"
          actionLabel="Go to Workouts"
          onAction={() => navigate('/workouts')}
        />
      )}

      {/* Sessions grouped by month */}
      {!loading && months.map(month => (
        <div key={month} className="mb-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-3 text-[#9CA3AF]">
            {month}
          </p>
          <div className="flex flex-col gap-3">
            {grouped[month].map(session => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default WorkoutLog;
