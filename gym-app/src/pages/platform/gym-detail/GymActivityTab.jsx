import { Dumbbell, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';

export default function GymActivityTab({ sessions, checkIns }) {
  const { t } = useTranslation('pages');

  return (
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
                    {s.status ?? 'unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
                  <span>{s.started_at ? format(new Date(s.started_at), 'MMM d, h:mm a') : '\u2014'}</span>
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
                  {ci.checked_in_at ? format(new Date(ci.checked_in_at), 'MMM d, h:mm a') : '\u2014'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
