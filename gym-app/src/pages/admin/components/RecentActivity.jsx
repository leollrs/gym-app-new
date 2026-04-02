import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CalendarCheck } from 'lucide-react';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { FadeIn, AdminCard, Avatar } from '../../../components/admin';

export default function RecentActivity({ activity = [], delay = 0 }) {
  const [expanded, setExpanded] = useState(true);
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsOpts = isEs ? { locale: esLocale } : undefined;

  return (
    <FadeIn delay={delay}>
      <AdminCard hover>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{t('admin.overview.recentActivity', 'Recent Activity')}</p>
            {activity.length > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-[#6B7280]">
                {activity.length}
              </span>
            )}
          </div>
          <button onClick={() => setExpanded(v => !v)} className="flex-shrink-0 flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            {expanded ? t('admin.overview.hide', 'Hide') : t('admin.overview.show', 'Show')}
            <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="pt-3 mt-3 border-t border-white/6">
              {activity.length === 0 ? (
                <p className="text-[12px] text-[#6B7280] text-center py-6">{t('admin.overview.noActivity', 'No activity yet')}</p>
              ) : (
                <div className="divide-y divide-white/4">
                  {activity.map((s, i) => (
                    <div key={s.timestamp + s.profile_id + i} className="flex items-center gap-3 py-2.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${s.type === 'checkin' ? 'bg-[#8B5CF6]/15' : 'bg-[#1E293B]'}`}>
                        {s.type === 'checkin'
                          ? <CalendarCheck size={12} className="text-[#8B5CF6]" />
                          : <span className="text-[10px] font-bold text-[#9CA3AF]">{s.memberInitial}</span>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-[#E5E7EB] truncate">
                          {s.memberName}
                          <span className="text-[10px] text-[#6B7280] ml-1.5">
                            {s.type === 'checkin'
                              ? t('admin.overview.checkedIn', 'checked in')
                              : t('admin.overview.loggedWorkout', 'logged a workout')}
                          </span>
                        </p>
                        <p className="text-[10px] text-[#6B7280]">{format(new Date(s.timestamp), 'MMM d, h:mm a', dateFnsOpts)}</p>
                      </div>
                      {s.type === 'workout' && s.total_volume_lbs > 0 && (
                        <span className="text-[11px] font-semibold text-[#9CA3AF] tabular-nums flex-shrink-0 whitespace-nowrap">
                          {Math.round(s.total_volume_lbs).toLocaleString()} lbs
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </AdminCard>
    </FadeIn>
  );
}
