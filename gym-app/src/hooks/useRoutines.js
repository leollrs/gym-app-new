import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export const useRoutines = () => {
  const { user, profile } = useAuth();
  const [routines, setRoutines]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const fetchRoutines = useCallback(async () => {
    if (!user || !profile) return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from('routines')
      .select('id, name, created_at, updated_at, routine_exercises(id)')
      .eq('created_by', user.id)
      .eq('is_template', false)
      .order('created_at', { ascending: false });

    if (err) {
      setError(err.message);
    } else {
      // Also fetch last performed date per routine
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('routine_id, completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      const lastPerformedMap = {};
      sessions?.forEach(s => {
        if (s.routine_id && !lastPerformedMap[s.routine_id]) {
          lastPerformedMap[s.routine_id] = s.completed_at;
        }
      });

      const enriched = (data || []).map(r => ({
        ...r,
        exerciseCount: r.routine_exercises?.length ?? 0,
        lastPerformedAt: lastPerformedMap[r.id] || null,
      }));

      setRoutines(enriched);
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
