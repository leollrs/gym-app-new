import { Dumbbell, MapPin, Activity } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../../../lib/supabase';
import ChartTooltip from '../../../components/ChartTooltip';

// 30-day daily check-in + workout trend — the shape that tells you whether a
// gym's members are showing up more or less over time (vs the raw recent
// lists below, which only show the latest handful).
function ActivityTrend({ gymId }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  const { data = [], isLoading } = useQuery({
    queryKey: ['platform', 'gym-activity-daily', gymId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('gym_activity_daily', { p_gym_id: gymId, p_days: 30 });
      if (error) throw error;
      return (data || []).map((r) => ({
        day: r.day,
        label: format(parseISO(r.day), 'MMM d', dateFnsLocale || {}),
        checkins: Number(r.checkins),
        workouts: Number(r.workouts),
      }));
    },
    enabled: !!gymId,
    staleTime: 5 * 60_000,
  });

  const hasData = data.some((d) => d.checkins > 0 || d.workouts > 0);

  return (
    <div className="bg-[#0F172A] border border-white/6 rounded-xl mb-4">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
        <Activity className="w-4 h-4 text-[#D4AF37]" />
        <h3 className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.activity.trend30d', 'Activity — last 30 days')}</h3>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-[#6B7280] text-sm">…</div>
      ) : !hasData ? (
        <div className="py-12 text-center text-[#6B7280] text-sm">{t('platform.gymDetail.activity.noTrend', 'No activity in the last 30 days')}</div>
      ) : (
        <div className="h-[200px] p-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gradCheckins" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradWorkouts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(212,175,55,0.2)' }} />
              <Area type="monotone" dataKey="checkins" name={t('platform.gymDetail.activity.checkinsSeries', 'Check-ins')} stroke="#D4AF37" strokeWidth={2} fill="url(#gradCheckins)" />
              <Area type="monotone" dataKey="workouts" name={t('platform.gymDetail.activity.workoutsSeries', 'Workouts')} stroke="#10B981" strokeWidth={2} fill="url(#gradWorkouts)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function GymActivityTab({ sessions, checkIns, gymId }) {
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? { locale: esLocale } : undefined;

  return (
    <div>
    {gymId && <ActivityTrend gymId={gymId} />}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Recent sessions */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
          <Dumbbell className="w-4 h-4 text-[#D4AF37]" />
          <h3 className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.activity.recentSessions')}</h3>
        </div>
        {sessions.length === 0 ? (
          <div className="py-10 text-center text-[#6B7280] text-sm">{t('platform.gymDetail.activity.noSessions')}</div>
        ) : (
          <div className="divide-y divide-white/6">
            {sessions.map(s => (
              <div key={s.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] text-[#E5E7EB]">
                    {s.profiles?.full_name ?? t('platform.gymDetail.people.unknown')}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    s.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {t(`platform.gymDetail.activity.status.${s.status ?? 'unknown'}`, s.status ?? t('platform.gymDetail.activity.status.unknown', 'unknown'))}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
                  <span>{s.started_at ? format(new Date(s.started_at), 'MMM d, h:mm a', dateFnsLocale || {}) : '\u2014'}</span>
                  {s.total_volume_lbs != null && (
                    <span>{Number(s.total_volume_lbs).toLocaleString()} lbs</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent check-ins */}
      <div className="bg-[#0F172A] border border-white/6 rounded-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/6">
          <MapPin className="w-4 h-4 text-[#D4AF37]" />
          <h3 className="text-[13px] font-semibold text-[#E5E7EB]">{t('platform.gymDetail.activity.recentCheckIns')}</h3>
        </div>
        {checkIns.length === 0 ? (
          <div className="py-10 text-center text-[#6B7280] text-sm">{t('platform.gymDetail.activity.noCheckIns')}</div>
        ) : (
          <div className="divide-y divide-white/6">
            {checkIns.map(ci => (
              <div key={ci.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <span className="text-[13px] text-[#E5E7EB] block">
                  {ci.profiles?.full_name ?? t('platform.gymDetail.people.unknown')}
                </span>
                <span className="text-[11px] text-[#6B7280]">
                  {ci.checked_in_at ? format(new Date(ci.checked_in_at), 'MMM d, h:mm a', dateFnsLocale || {}) : '\u2014'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
