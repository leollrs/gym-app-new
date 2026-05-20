import { useQuery } from '@tanstack/react-query';
import { Star, UserX, XCircle, Dumbbell } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';

/**
 * Per-class analytics panel rendered inside the Class Detail Modal.
 *
 * 30-day window: attendance rate, no-show rate, cancellation rate, average
 * rating, star distribution. Plus recent workout results if the class has
 * a workout template attached.
 *
 * All five count queries run in parallel with `head: true` so zero rows
 * cross the wire — the only payload is the small ratings array and
 * (optionally) the latest 20 workout-result joins.
 */
export default function ClassAnalytics({ classId, hasTemplate, t }) {
  const { data: analytics, isLoading } = useQuery({
    queryKey: adminKeys.classes.detail(classId),
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();
      const today = new Date().toISOString().slice(0, 10);

      // Run all count queries in parallel — each uses head:true so zero rows are transferred
      const baseQuery = () => supabase
        .from('gym_class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', classId)
        .gte('created_at', since);

      const [
        { count: total },
        { count: attended },
        { count: noShows },
        { count: confirmedPast },
        { count: cancelled },
        { data: ratingRows },
        ...rest
      ] = await Promise.all([
        // Total bookings
        baseQuery(),
        // Attended bookings
        baseQuery().eq('attended', true),
        // No-shows: confirmed but not attended, past booking date
        baseQuery().eq('status', 'confirmed').eq('attended', false).lt('booking_date', today),
        // Confirmed past (confirmed or attended status, past booking date) — for no-show rate denominator
        baseQuery().in('status', ['confirmed', 'attended']).lt('booking_date', today),
        // Cancelled bookings
        baseQuery().eq('status', 'cancelled'),
        // Ratings — only fetch the small subset that have ratings (typically <5% of bookings)
        supabase
          .from('gym_class_bookings')
          .select('rating')
          .eq('class_id', classId)
          .gte('created_at', since)
          .eq('attended', true)
          .not('rating', 'is', null),
        // Recent results (only if class has a workout template)
        ...(hasTemplate ? [
          supabase
            .from('gym_class_bookings')
            .select('profile_id, rating, notes, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
            .eq('class_id', classId)
            .eq('attended', true)
            .order('attended_at', { ascending: false })
            .limit(20),
        ] : []),
      ]);

      const recentResults = hasTemplate ? (rest[0]?.data || []) : [];

      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
      const noShowRate = confirmedPast > 0 ? Math.round((noShows / confirmedPast) * 100) : 0;
      const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

      const rated = ratingRows || [];
      const avgRating = rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : null;

      const starDist = [0, 0, 0, 0, 0];
      rated.forEach(b => {
        const idx = Math.max(0, Math.min(4, Math.round(b.rating) - 1));
        starDist[idx]++;
      });

      return {
        total: total || 0, attended: attended || 0, attendanceRate, avgRating, starDist, recentResults,
        noShows: noShows || 0, noShowRate, cancelled: cancelled || 0, cancellationRate,
      };
    },
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 px-4">
        <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.loading', 'Loading...')}</span>
      </div>
    );
  }

  if (!analytics || analytics.total === 0) {
    return <p className="text-[12px] italic py-3 px-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noResults')}</p>;
  }

  return (
    <div className="space-y-4 p-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.attendanceRate')}</p>
          <p className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{analytics.attendanceRate}%</p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.attended}/{analytics.total}</p>
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.avgRating')}</p>
          {analytics.avgRating ? (
            <div className="flex items-center gap-1">
              <p className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{analytics.avgRating}</p>
              <Star size={14} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>--</p>
          )}
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <UserX size={11} style={{ color: 'var(--color-danger)' }} />
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noShowRate')}</p>
          </div>
          <p className="text-[18px] font-bold"
            style={{ color: analytics.noShowRate > 20 ? 'var(--color-danger)' : analytics.noShowRate > 10 ? 'var(--color-warning)' : 'var(--color-success)' }}>
            {analytics.noShowRate}%
          </p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.noShows} {t('admin.classes.noShows')}</p>
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <XCircle size={11} style={{ color: 'var(--color-warning)' }} />
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.cancellationRate')}</p>
          </div>
          <p className="text-[18px] font-bold"
            style={{ color: analytics.cancellationRate > 30 ? 'var(--color-danger)' : analytics.cancellationRate > 15 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
            {analytics.cancellationRate}%
          </p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.cancelled} {t('admin.classes.cancellations')}</p>
        </div>
      </div>

      {/* Star distribution */}
      {analytics.avgRating && (
        <div className="space-y-1.5 py-1">
          {[5, 4, 3, 2, 1].map(star => {
            const count = analytics.starDist[star - 1];
            const maxCount = Math.max(...analytics.starDist, 1);
            return (
              <div key={star} className="flex items-center gap-1.5">
                <span className="text-[9px] w-3 text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{star}</span>
                <Star size={8} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: 'var(--color-accent)' }} />
                </div>
                <span className="text-[9px] w-4 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] italic text-right" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.last30Days')}</p>

      {/* Recent workout results */}
      {hasTemplate && analytics.recentResults.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.recentResults')}</p>
          <div className="space-y-1.5">
            {analytics.recentResults.map((r, i) => (
              <div key={`${r.profile_id}-${i}`} className="flex items-center gap-2.5 p-2.5 rounded-lg transition-colors hover:brightness-105"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                {r.profiles?.avatar_url ? (
                  <img src={r.profiles.avatar_url} alt={r.profiles?.full_name || t('admin.classes.memberAvatarAlt', 'Member avatar')} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--color-accent)' }}>{r.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                )}
                <span className="flex-1 text-[12px] truncate" style={{ color: 'var(--color-text-primary)' }}>{r.profiles?.full_name || t('admin.classes.unknown', 'Unknown')}</span>
                {r.workout_sessions?.total_volume_lbs != null && (
                  <span className="text-[11px] flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                    <Dumbbell size={11} /> {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} {t('admin.classes.lbs', 'lbs')}
                  </span>
                )}
                {r.rating != null && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} size={10} style={s <= Math.round(r.rating) ? { color: 'var(--color-accent)', fill: 'var(--color-accent)' } : { color: 'var(--color-text-faint)' }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
