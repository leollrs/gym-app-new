import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getCached, setCache } from '../lib/queryCache';

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
