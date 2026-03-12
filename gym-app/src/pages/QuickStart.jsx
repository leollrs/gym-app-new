import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, RotateCcw, Dumbbell, ChevronRight, Zap, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const formatTimeAgo = (isoDate) => {
  if (!isoDate) return '';
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
};

const QuickStart = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [routines, setRoutines] = useState([]);
  const [lastSession, setLastSession] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      // Fetch routines, last sessions per routine, and most recent session in parallel
      const [{ data: routineData }, { data: sessionData }] = await Promise.all([
        supabase
          .from('routines')
          .select('id, name, routine_exercises(id)')
          .eq('created_by', user.id)
          .eq('is_template', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('workout_sessions')
          .select('routine_id, completed_at, total_volume')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false }),
      ]);

      // Build last-performed map
      const lastPerformed = {};
      const routineNames = {};
      (routineData || []).forEach(r => { routineNames[r.id] = r.name; });

      (sessionData || []).forEach(s => {
        if (s.routine_id && !lastPerformed[s.routine_id]) {
          lastPerformed[s.routine_id] = s;
        }
      });

      // Enrich routines
      const enriched = (routineData || []).map(r => ({
        id: r.id,
        name: r.name,
        exerciseCount: r.routine_exercises?.length ?? 0,
        lastPerformedAt: lastPerformed[r.id]?.completed_at || null,
      }));
      setRoutines(enriched);

      // Find last session (with routine name)
      const mostRecent = sessionData?.[0];
      if (mostRecent?.routine_id && routineNames[mostRecent.routine_id]) {
        setLastSession({
          routineId: mostRecent.routine_id,
          routineName: routineNames[mostRecent.routine_id],
          completedAt: mostRecent.completed_at,
          volume: mostRecent.total_volume,
        });
      }

      // Suggest next routine: the one least recently performed (rotation logic)
      if (enriched.length > 0) {
        const sorted = [...enriched].sort((a, b) => {
          if (!a.lastPerformedAt && !b.lastPerformedAt) return 0;
          if (!a.lastPerformedAt) return -1; // never performed = highest priority
          if (!b.lastPerformedAt) return 1;
          return new Date(a.lastPerformedAt) - new Date(b.lastPerformedAt);
        });
        setSuggested(sorted[0]);
      }

      setLoading(false);
    };

    load();
  }, [user]);

  // No routines at all → redirect to workouts
  useEffect(() => {
    if (!loading && routines.length === 0 && !lastSession) {
      navigate('/workouts', { replace: true });
    }
  }, [loading, routines, lastSession, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  const otherRoutines = routines.filter(r => r.id !== suggested?.id);

  return (
    <div className="min-h-screen bg-[#05070B] px-4 pt-4 pb-28 md:pb-12">
      <div className="max-w-lg mx-auto space-y-5 stagger-fade-in">

        {/* Header */}
        <div>
          <h1 className="text-[26px] font-bold text-[#E5E7EB]">Start Workout</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">Pick a routine and get lifting</p>
        </div>

        {/* ── Suggested Next Routine (Hero) ──────────────────────── */}
        {suggested && (
          <button
            onClick={() => navigate(`/session/${suggested.id}`)}
            className="w-full text-left bg-gradient-to-br from-[#D4AF37]/15 to-[#D4AF37]/5 border border-[#D4AF37]/25 rounded-[14px] p-5 transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-1.5 mb-3">
              <Zap size={13} className="text-[#D4AF37]" />
              <span className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-widest">Up Next</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[20px] font-bold text-[#E5E7EB]">{suggested.name}</p>
                <p className="text-[12px] text-[#9CA3AF] mt-1 flex items-center gap-2">
                  <span className="flex items-center gap-1"><Dumbbell size={11} /> {suggested.exerciseCount} exercises</span>
                  {suggested.lastPerformedAt && (
                    <>
                      <span className="text-white/15">•</span>
                      <span className="flex items-center gap-1"><Clock size={11} /> {formatTimeAgo(suggested.lastPerformedAt)}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-[#D4AF37] flex items-center justify-center shadow-lg shadow-[#D4AF37]/25 flex-shrink-0">
                <Play size={20} fill="black" stroke="black" />
              </div>
            </div>
          </button>
        )}

        {/* ── Repeat Last Workout ────────────────────────────────── */}
        {lastSession && lastSession.routineId !== suggested?.id && (
          <button
            onClick={() => navigate(`/session/${lastSession.routineId}`)}
            className="w-full text-left bg-[#0F172A] border border-white/8 rounded-[14px] p-4 flex items-center gap-4 transition-transform active:scale-[0.98]"
          >
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
              <RotateCcw size={18} className="text-[#9CA3AF]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{lastSession.routineName}</p>
              <p className="text-[12px] text-[#6B7280] mt-0.5">
                Repeat last • {formatTimeAgo(lastSession.completedAt)}
                {lastSession.volume > 0 && ` • ${(lastSession.volume / 1000).toFixed(1)}k vol`}
              </p>
            </div>
            <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0" />
          </button>
        )}

        {/* ── Other Routines ─────────────────────────────────────── */}
        {otherRoutines.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">
              Other Routines
            </p>
            <div className="space-y-2">
              {otherRoutines.map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/session/${r.id}`)}
                  className="w-full text-left bg-[#0F172A] border border-white/8 rounded-[14px] p-4 flex items-center gap-4 transition-transform active:scale-[0.98]"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Dumbbell size={16} className="text-[#9CA3AF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{r.name}</p>
                    <p className="text-[12px] text-[#6B7280] mt-0.5">
                      {r.exerciseCount} exercises
                      {r.lastPerformedAt && ` • ${formatTimeAgo(r.lastPerformedAt)}`}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Empty Session ──────────────────────────────────────── */}
        <button
          onClick={() => navigate('/workouts')}
          className="w-full text-left bg-[#111827] border border-white/6 rounded-[14px] p-4 flex items-center gap-4 transition-transform active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
            <Dumbbell size={16} className="text-[#6B7280]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#9CA3AF]">Browse All Workouts</p>
            <p className="text-[12px] text-[#6B7280] mt-0.5">Programs, routines & more</p>
          </div>
          <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0" />
        </button>

      </div>
    </div>
  );
};

export default QuickStart;
