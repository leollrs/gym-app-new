import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Clock, MapPin, Calendar, Megaphone, Info, CalendarCheck, ChevronRight, Tag, Users } from 'lucide-react';
import UserAvatar from '../components/UserAvatar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { sanitize } from '../lib/sanitize';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { formatDistanceToNow, format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ANN_COLOR = {
  event: 'var(--color-accent)',
  challenge: 'var(--color-success)',
  maintenance: 'var(--color-danger)',
  news: 'var(--color-blue)',
};

const OFFER_TYPE_COLOR = {
  discount: '#EF4444',
  free_trial: '#10B981',
  bundle: '#8B5CF6',
  class_pass: '#3B82F6',
  bring_friend: '#F59E0B',
  custom: '#6B7280',
};

const fmtTime = (timeStr, use24h) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  if (use24h) return `${hour}:${m}`;
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
};

export default function MyGym() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language === 'es';
  const use24h = isEs;
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const fmt = (timeStr) => fmtTime(timeStr, use24h);
  const { profile, gymName, gymLogoUrl, gymConfig } = useAuth();
  const navigate = useNavigate();
  const gid = profile?.gym_id;
  const cacheKey = `mygym-${gid}`;
  const hasCache = !!gid && hasCachedState(`${cacheKey}-gym`);
  const [gym, setGym] = useCachedState(`${cacheKey}-gym`, null);
  const [hours, setHours] = useCachedState(`${cacheKey}-hours`, []);
  const [holidays, setHolidays] = useCachedState(`${cacheKey}-holidays`, []);
  const [announcements, setAnnouncements] = useCachedState(`${cacheKey}-ann`, []);
  const [upcomingClasses, setUpcomingClasses] = useCachedState(`${cacheKey}-classes`, []);
  const [offers, setOffers] = useCachedState(`${cacheKey}-offers`, []);
  const [trainers, setTrainers] = useCachedState(`${cacheKey}-trainers`, []);
  // Only show the full-screen spinner on the VERY first visit. After that,
  // cached data paints instantly and we refetch silently in the background.
  const [loading, setLoading] = useState(!hasCache);

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('myGym.title', 'My Gym')} | ${window.__APP_NAME || 'TuGymPR'}`;
    return () => { document.title = prev; };
  }, [t]);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const [gymRes, hoursRes, holidaysRes, closuresRes, annRes] = await Promise.all([
        supabase.from('gyms').select('id, name, open_days, open_time, close_time, country, address').eq('id', profile.gym_id).maybeSingle(),
        supabase.from('gym_hours').select('day_of_week, is_closed, open_time, close_time').eq('gym_id', profile.gym_id).order('day_of_week'),
        supabase.from('gym_holidays').select('id, label, date, is_closed, open_time, close_time').eq('gym_id', profile.gym_id).gte('date', todayStr).order('date').limit(5),
        supabase.from('gym_closures').select('id, name, closure_date, reason').eq('gym_id', profile.gym_id).gte('closure_date', todayStr).order('closure_date').limit(5),
        supabase
          .from('announcements')
          .select('id, title, message, type, published_at')
          .eq('gym_id', profile.gym_id)
          .lte('published_at', new Date().toISOString())
          .order('published_at', { ascending: false })
          .limit(5),
      ]);
      setGym(gymRes.data);
      setHours(hoursRes.data || []);
      // "Próximos Feriados" merges TWO admin-managed tables:
      //   • gym_holidays — admin Hours page; can be a full closure OR special hours
      //   • gym_closures — admin "Cierres del Gym" card; full-closure only, and
      //                    the table the streak-protection logic reads.
      // Both must surface to members. Dedupe by date, preferring the gym_holidays
      // row (it can express special open/close hours, not just "closed").
      {
        // Reason → member-facing label fallback when a closure has no custom name.
        const reasonLabel = {
          holiday: t('admin.closures.reasonHoliday', 'Holiday'),
          maintenance: t('admin.closures.reasonMaintenance', 'Maintenance'),
          special_event: t('admin.closures.reasonSpecialEvent', 'Special event'),
          other: t('myGym.closed', 'Closed'),
        };
        const hols = holidaysRes.data || [];
        const seenDates = new Set(hols.map(h => h.date));
        const mappedClosures = (closuresRes.data || [])
          .filter(c => c.closure_date && !seenDates.has(c.closure_date))
          .map(c => ({
            id: `closure-${c.id}`,
            label: c.name || reasonLabel[c.reason] || t('myGym.closed', 'Closed'),
            date: c.closure_date,
            is_closed: true,
            open_time: null,
            close_time: null,
          }));
        const merged = [...hols, ...mappedClosures]
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 5);
        setHolidays(merged);
      }
      setAnnouncements(annRes.data || []);

      // Fetch upcoming classes if enabled — next 7 days of scheduled classes
      if (gymConfig?.classesEnabled) {
        const now = new Date();
        const todayDow = now.getDay();
        // Fetch schedules for all days of the week, then sort client-side by proximity
        const classRes = await supabase
          .from('gym_class_schedules')
          .select('id, day_of_week, start_time, end_time, gym_classes(name, color, instructor, trainer:profiles!trainer_id(id, full_name))')
          .eq('gym_id', profile.gym_id)
          .order('start_time');
        const allSchedules = classRes.data || [];
        // Sort by how many days away each class is (today first, then tomorrow, etc.)
        const sorted = allSchedules
          .map(s => ({
            ...s,
            daysAway: (s.day_of_week - todayDow + 7) % 7,
          }))
          .sort((a, b) => a.daysAway - b.daysAway || (a.start_time || '').localeCompare(b.start_time || ''))
          .slice(0, 5);
        setUpcomingClasses(sorted);
      }

      // Fetch active offers
      const offersRes = await supabase
        .from('gym_offers')
        .select('id, title, title_es, description, description_es, offer_type, badge_label, valid_until, sort_order')
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().slice(0, 10))
        .order('sort_order');
      setOffers(offersRes.data || []);

      // Fetch the gym's trainer directory via the get_gym_trainers RPC.
      // Querying `profiles` directly from the client fails three ways:
      // RLS hides other people's profile rows, PostgREST's `.contains()`
      // rejects the `additional_roles` enum array, and the visibility
      // column may be missing. The SECURITY DEFINER RPC does the role +
      // gym + visibility filtering server-side and returns only the
      // safe public columns. See migration 0391.
      const { data: trainersData, error: trainersErr } = await supabase.rpc('get_gym_trainers');
      if (trainersErr) {
        console.warn('[MyGym] get_gym_trainers RPC failed:', trainersErr.message);
        setTrainers([]);
      } else {
        setTrainers(trainersData || []);
      }

      setLoading(false);
    };
    load();
  }, [profile?.gym_id, gymConfig?.classesEnabled]);

  const todayDow = new Date().getDay();
  const todayHours = hours.find(h => h.day_of_week === todayDow);
  const isOpenToday = todayHours ? !todayHours.is_closed : gym?.open_days?.includes(todayDow);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label={t('myGym.goBack', { defaultValue: 'Go back' })} className="p-2 -ml-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none" style={{ color: 'var(--color-text-muted)', '--tw-ring-color': 'var(--color-accent, #2EC4C4)' }}>
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
          {gymLogoUrl && (
            <img src={gymLogoUrl} alt={gym?.name} className="h-9 w-9 rounded-xl object-contain flex-shrink-0" style={{ border: '1px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-secondary)' }} />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] truncate" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.4px' }}>{gym?.name || gymName}</h1>
            <p className="text-[12px]" style={{ color: isOpenToday ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {isOpenToday
                ? `${t('myGym.openToday')} · ${fmt(todayHours?.open_time || gym?.open_time)} – ${fmt(todayHours?.close_time || gym?.close_time)}`
                : t('myGym.closedToday')}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* Recent News — surfaced first so members see fresh announcements
            before scrolling through hours, classes, and trainers. */}
        <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Megaphone size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('myGym.recentNews')}</h2>
          </div>
          {announcements.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('myGym.noRecentAnnouncements')}</p>
          ) : (
            <div className="space-y-3">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  className="rounded-xl p-4 border-l-[3px]"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', borderLeftColor: ANN_COLOR[ann.type] ?? 'var(--color-blue)' }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[13px] font-semibold min-w-0 flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>{sanitize(ann.title)}</p>
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-faint)' }}>
                      {formatDistanceToNow(new Date(ann.published_at), { addSuffix: true, ...(dateFnsLocale || {}) })}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{sanitize(ann.message)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Hours Card — per-day */}
        <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('myGym.hoursSchedule')}</h2>
          </div>
          <div className="space-y-1">
            {DAY_KEYS.map((dayKey, i) => {
              const dh = hours.find(h => h.day_of_week === i);
              const isClosed = dh ? dh.is_closed : !gym?.open_days?.includes(i);
              const isToday = i === todayDow;
              return (
                <div
                  key={dayKey}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                  style={{
                    backgroundColor: isToday ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent',
                    border: isToday ? '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: isClosed ? 'var(--color-text-faint)' : 'var(--color-success)' }}
                    />
                    <span className="text-[13px] font-semibold" style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {t(`myGym.days.${dayKey}`)}
                    </span>
                  </div>
                  {isClosed ? (
                    <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-faint)' }}>{t('myGym.closed')}</span>
                  ) : (
                    <span className="text-[12px]" style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(dh?.open_time || gym?.open_time)} – {fmt(dh?.close_time || gym?.close_time)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Upcoming Holidays */}
        <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('myGym.upcomingHolidays')}</h2>
          </div>
          {holidays.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('myGym.noUpcomingHolidays')}</p>
          ) : (
            <div className="space-y-2">
              {holidays.map(h => (
                <div key={h.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{h.label}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{format(new Date(h.date + 'T00:00:00'), 'EEEE, MMM d', dateFnsLocale)}</p>
                  </div>
                  {h.is_closed ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--color-danger)' }}>{t('myGym.closed')}</span>
                  ) : (
                    <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                      {fmt(h.open_time)} – {fmt(h.close_time)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Classes */}
        {gymConfig?.classesEnabled && (
          <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarCheck size={16} style={{ color: 'var(--color-accent)' }} />
                <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('classes.upcomingClasses')}</h2>
              </div>
              <button
                onClick={() => navigate('/classes')}
                className="flex items-center gap-1 text-[12px] font-semibold min-h-[44px] min-w-[44px] justify-end focus:ring-2 focus:outline-none rounded-full px-3"
                style={{ color: 'var(--color-accent)', '--tw-ring-color': 'var(--color-accent, #2EC4C4)' }}
              >
                {t('classes.viewAll')}
                <ChevronRight size={14} />
              </button>
            </div>
            {upcomingClasses.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('classes.noUpcomingClasses', 'No upcoming classes scheduled')}</p>
            ) : (
              <div className="space-y-2">
                {upcomingClasses.map(sched => {
                  const cls = sched.gym_classes;
                  if (!cls) return null;
                  const isToday = sched.daysAway === 0;
                  const dayLabel = isToday
                    ? t('myGym.today', 'Today')
                    : t(`myGym.days.${DAY_KEYS[sched.day_of_week]}`);
                  return (
                    <div
                      key={sched.id}
                      onClick={() => navigate('/classes')}
                      className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors active:scale-[0.98]"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                    >
                      {cls.color && <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: cls.color }} />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {dayLabel} · {fmt(sched.start_time)} – {fmt(sched.end_time)}
                          {cls.trainer?.id ? (
                            <>
                              {' · '}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); navigate(`/trainers/${cls.trainer.id}`); }}
                                className="underline-offset-2 hover:underline active:opacity-80"
                                style={{ color: 'var(--color-accent)', background: 'transparent', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
                              >
                                {cls.trainer.full_name || cls.instructor}
                              </button>
                            </>
                          ) : cls.instructor ? ` · ${cls.instructor}` : ''}
                        </p>
                      </div>
                      <ChevronRight size={16} style={{ color: 'var(--color-text-faint)' }} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Gym Info Card */}
        <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('myGym.gymInfo')}</h2>
          </div>
          <div className="space-y-3">
            {gym?.country && (
              <div className="flex items-center gap-3">
                <MapPin size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>{gym.country}</span>
              </div>
            )}
            {gym?.address && (
              <div className="flex items-center gap-3">
                <MapPin size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>{gym.address}</span>
              </div>
            )}
            {!gym?.country && !gym?.address && (
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('myGym.noAdditionalInfo')}</p>
            )}
          </div>
        </section>

        {/* Trainers at your gym — always rendered, mirrors the Holidays
            section so members get a clear "no trainers listed yet" state
            instead of the whole card silently vanishing. */}
        <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>
              {t('publicTrainerProfile.trainersAtGym', { defaultValue: 'Trainers at your gym' })}
            </h2>
          </div>
          {trainers.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('publicTrainerProfile.noTrainersListed', { defaultValue: 'No trainers listed yet.' })}
            </p>
          ) : (
            <div className="space-y-2">
              {trainers.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => navigate(`/trainers/${tr.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors active:scale-[0.98] text-left focus:outline-none"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: 'none' }}
                  aria-label={t('publicTrainerProfile.viewProfile', { defaultValue: 'View profile' })}
                >
                  <UserAvatar user={tr} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {tr.full_name || tr.username || t('publicTrainerProfile.trainerLabel', { defaultValue: 'Trainer' })}
                    </p>
                    {(tr.trainer_tagline || tr.trainer_years_exp != null) && (
                      <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {tr.trainer_tagline ||
                          (tr.trainer_years_exp != null
                            ? t('publicTrainerProfile.yrsExp', { n: tr.trainer_years_exp, defaultValue: '{{n}} yrs' })
                            : '')}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--color-text-faint)' }} />
                </button>
              ))}
            </div>
          )}
        </section>


        {/* Offers */}
        {offers.length > 0 && (
          <section className="rounded-[22px] p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Tag size={16} style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-[17px]" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontWeight: 800, letterSpacing: '-0.3px' }}>{t('myGym.offers')}</h2>
            </div>
            <div className="space-y-3">
              {offers.map(offer => {
                const title = isEs && offer.title_es ? offer.title_es : offer.title;
                const description = isEs && offer.description_es ? offer.description_es : offer.description;
                const typeColor = OFFER_TYPE_COLOR[offer.offer_type] || OFFER_TYPE_COLOR.custom;
                return (
                  <div
                    key={offer.id}
                    className="relative rounded-xl p-4"
                    style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                  >
                    {/* Badge label */}
                    {offer.badge_label && (
                      <span
                        className="absolute top-3 right-3 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: typeColor }}
                      >
                        {offer.badge_label}
                      </span>
                    )}
                    {/* Title */}
                    <p className="text-[14px] font-semibold pr-16 mb-1" style={{ color: 'var(--color-text-primary)' }}>{title}</p>
                    {/* Description */}
                    {description && (
                      <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--color-text-muted)' }}>{description}</p>
                    )}
                    {/* Footer: valid date + type badge */}
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: 'var(--color-text-faint)' }}>
                        {offer.valid_until
                          ? `${t('myGym.validUntil')} ${format(new Date(offer.valid_until + 'T00:00:00'), 'MMM d', dateFnsLocale)}`
                          : t('myGym.noExpiry')}
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${typeColor}18`, color: typeColor }}
                      >
                        {t(`memberOffers.types.${offer.offer_type}`, offer.offer_type?.replace(/_/g, ' '))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
