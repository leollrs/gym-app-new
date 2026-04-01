import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getCached, setCache } from '../lib/queryCache';
import { syncRoutinesToWatch } from '../lib/watchBridge';

/**
 * Determine which program routines are for today based on the active generated_program.
 * Week A = odd weeks, Week B = even weeks. Returns a Set of routine IDs for today.
 */
async function getTodayProgramRoutineIds(userId, routines) {
  try {
    const { data: programs } = await supabase
      .from('generated_programs')
      .select('program_start, expires_at')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    const program = programs?.[0];
    if (!program || new Date(program.expires_at) <= new Date()) return new Set();
    const weekNum = Math.floor((new Date() - new Date(program.program_start)) / (7 * 86400000)) + 1;
    const isWeekA = weekNum % 2 === 1;
    return new Set(
      routines
        .filter(r => {
          if (!r.name?.startsWith('Auto:')) return false;
          if (isWeekA) return r.name.endsWith(' A') || (!r.name.endsWith(' B'));
          return r.name.endsWith(' B');
        })
        .map(r => r.id)
    );
  } catch {
    return new Set();
  }
}

export const useRoutines = () => {
  const { user, profile } = useAuth();
  const [routines, setRoutines]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Hydrate from cache instantly
  useEffect(() => {
    if (!user?.id) return;
    const cached = getCached(`routines:${user.id}`);
    if (cached?.data) {
      setRoutines(cached.data);
      setLoading(false);
    }
  }, [user?.id]);

  const fetchRoutines = useCallback(async () => {
    if (!user || !profile) return;

    const hasCached = !!getCached(`routines:${user.id}`)?.data;
    if (!hasCached) setLoading(true);
    setError(null);

    // Parallel fetch: routines + sessions
    const [routinesRes, sessionsRes] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, created_at, updated_at, routine_exercises(id)')
        .eq('created_by', user.id)
        .eq('is_template', false)
        .order('created_at', { ascending: false }),
      supabase
        .from('workout_sessions')
        .select('routine_id, completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false }),
    ]);

    if (routinesRes.error) {
      setError(routinesRes.error.message);
      // Try loading from offline cache on error
      try {
        const cached = localStorage.getItem('offline_routines');
        if (cached) setRoutines(JSON.parse(cached));
      } catch {}
    } else {
      const lastPerformedMap = {};
      sessionsRes.data?.forEach(s => {
        if (s.routine_id && !lastPerformedMap[s.routine_id]) {
          lastPerformedMap[s.routine_id] = s.completed_at;
        }
      });

      const enriched = (routinesRes.data || []).map(r => ({
        ...r,
        exerciseCount: r.routine_exercises?.length ?? 0,
        lastPerformedAt: lastPerformedMap[r.id] || null,
      }));

      setRoutines(enriched);
      setCache(`routines:${user.id}`, enriched);
      // Cache for offline access
      try { localStorage.setItem('offline_routines', JSON.stringify(enriched)); } catch {}

      // Sync routines to Apple Watch — include program + today flags
      getTodayProgramRoutineIds(user.id, enriched).then(todayIds => {
        syncRoutinesToWatch(enriched.map(r => ({
          id: r.id,
          name: r.name,
          exercises: r.routine_exercises || [],
          exerciseCount: r.exerciseCount || r.routine_exercises?.length || 0,
          lastUsed: r.lastPerformedAt || '',
          isProgram: r.name?.startsWith('Auto:') || false,
          isTodayWorkout: todayIds.has(r.id),
        })));
      });
    }

    setLoading(false);
  }, [user, profile]);

  useEffect(() => { fetchRoutines(); }, [fetchRoutines]);

  const createRoutine = async (name) => {
    const { data, error: err } = await supabase
      .from('routines')
      .insert({ name, gym_id: profile.gym_id, created_by: user.id })
      .select()
      .single();
    if (err) throw err;
    await fetchRoutines();
    return data;
  };

  const deleteRoutine = async (id) => {
    const { error: err } = await supabase
      .from('routines')
      .delete()
      .eq('id', id);
    if (err) throw err;
    setRoutines(prev => prev.filter(r => r.id !== id));
  };

  return { routines, loading, error, createRoutine, deleteRoutine, refetch: fetchRoutines };
};
