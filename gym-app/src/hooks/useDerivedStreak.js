import { useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { useCachedState } from './useCachedState';
import { buildStreakCalendar } from '../lib/streakCalendar';

// Authoritative member streak — the calendar-derived value shown on the flame
// pill / streak modal (Navigation) and the Apple Watch. Use this instead of
// reading streak_cache.current_streak_days directly: that cached value drifts
// from reality and produced a "made up" streak number on the check-in screen.
//
// Returns { streak, reload }. `reload` is stable (useCallback) so callers can
// wire it into foreground/visibility refresh effects.
export function useDerivedStreak() {
  const { user, profile } = useAuth();
  const { i18n } = useTranslation();
  const [streak, setStreak] = useCachedState(`derived-streak-${user?.id || 'anon'}`, 0);

  const reload = useCallback(async () => {
    if (!user?.id) return;
    const gymId = profile?.gym_id;
    const [sessionsRes, cardioRes, profileRes, gymHoursRes, closuresRes, holidaysRes, freezesRes] = await Promise.all([
      supabase.from('workout_sessions')
        .select('completed_at')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false }),
      supabase.from('cardio_sessions')
        .select('completed_at, started_at')
        .eq('profile_id', user.id),
      supabase.from('profiles').select('preferred_training_days, created_at').eq('id', user.id).maybeSingle(),
      gymId ? supabase.from('gym_hours').select('day_of_week, is_closed').eq('gym_id', gymId) : Promise.resolve({ data: [] }),
      gymId ? supabase.from('gym_closures').select('closure_date').eq('gym_id', gymId) : Promise.resolve({ data: [] }),
      gymId ? supabase.from('gym_holidays').select('date, is_closed').eq('gym_id', gymId) : Promise.resolve({ data: [] }),
      supabase.from('streak_freezes').select('month, used_count, max_allowed, frozen_dates').eq('profile_id', user.id),
    ]);

    const { currentStreak } = buildStreakCalendar({
      sessions: sessionsRes.data,
      cardio: cardioRes.data,
      profile: profileRes.data,
      gymHours: gymHoursRes.data,
      closures: closuresRes.data,
      holidays: holidaysRes.data,
      freezes: freezesRes.data,
      lang: i18n.language,
      now: new Date(),
    });
    setStreak(currentStreak);
  }, [user?.id, profile?.gym_id, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reload(); }, [reload]);

  return { streak, reload };
}
