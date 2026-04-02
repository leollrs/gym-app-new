import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Clock, MapPin, Calendar, Megaphone, Info, CalendarCheck, ChevronRight, Tag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { sanitize } from '../lib/sanitize';
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
  const [gym, setGym] = useState(null);
  const [hours, setHours] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [upcomingClasses, setUpcomingClasses] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.gym_id) return;
    const load = async () => {
      const [gymRes, hoursRes, holidaysRes, annRes] = await Promise.all([
        supabase.from('gyms').select('*').eq('id', profile.gym_id).maybeSingle(),
        supabase.from('gym_hours').select('*').eq('gym_id', profile.gym_id).order('day_of_week'),
        supabase.from('gym_holidays').select('*').eq('gym_id', profile.gym_id).gte('date', new Date().toISOString().split('T')[0]).order('date').limit(5),
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
      setHolidays(holidaysRes.data || []);
      setAnnouncements(annRes.data || []);

      // Fetch upcoming classes if enabled
      if (gymConfig?.classesEnabled) {
        const todayDow = new Date().getDay();
        const classRes = await supabase
          .from('gym_class_schedules')
          .select('*, gym_classes(*)')
          .eq('gym_id', profile.gym_id)
          .eq('day_of_week', todayDow)
          .order('start_time')
          .limit(3);
        setUpcomingClasses(classRes.data || []);
      }

      // Fetch active offers
      const offersRes = await supabase
        .from('gym_offers')
        .select('*')
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .or('valid_until.is.null,valid_until.gte.' + new Date().toISOString().slice(0, 10))
        .order('sort_order');
      setOffers(offersRes.data || []);

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
        <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Go back" className="p-2 -ml-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
          {gymLogoUrl && (
            <img src={gymLogoUrl} alt={gym?.name} className="h-9 w-9 rounded-xl object-contain flex-shrink-0" style={{ border: '1px solid var(--color-border-default)', backgroundColor: 'var(--color-bg-secondary)' }} />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{gym?.name || gymName}</h1>
            <p className="text-[12px]" style={{ color: isOpenToday ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {isOpenToday
                ? `${t('myGym.openToday')} · ${fmt(todayHours?.open_time || gym?.open_time)} – ${fmt(todayHours?.close_time || gym?.close_time)}`
                : t('myGym.closedToday')}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl mx-auto px-4 py-5 space-y-5">

        {/* Hours Card — per-day */}
        <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('myGym.hoursSchedule')}</h2>
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
        <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('myGym.upcomingHolidays')}</h2>
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
        {gymConfig?.classesEnabled && upcomingClasses.length > 0 && (
          <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CalendarCheck size={16} style={{ color: 'var(--color-accent)' }} />
                <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('classes.upcomingClasses')}</h2>
              </div>
              <button
                onClick={() => navigate('/classes')}
                className="flex items-center gap-1 text-[12px] font-semibold min-h-[44px] min-w-[44px] justify-end focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
                style={{ color: 'var(--color-accent)' }}
              >
                {t('classes.viewAll')}
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="space-y-2">
              {upcomingClasses.map(sched => {
                const cls = sched.gym_classes;
                if (!cls) return null;
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
                        {fmt(sched.start_time)} – {fmt(sched.end_time)}
                        {cls.instructor ? ` · ${cls.instructor}` : ''}
                      </p>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--color-text-faint)' }} />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Gym Info Card */}
        <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Info size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('myGym.gymInfo')}</h2>
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

        {/* Recent News */}
        <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Megaphone size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('myGym.recentNews')}</h2>
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

        {/* Offers */}
        {offers.length > 0 && (
          <section className="rounded-2xl p-5 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Tag size={16} style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('myGym.offers')}</h2>
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
                        {offer.offer_type?.replace(/_/g, ' ')}
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
