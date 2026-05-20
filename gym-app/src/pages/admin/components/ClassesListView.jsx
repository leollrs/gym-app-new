import { useState, useMemo } from 'react';
import { CalendarDays, Clock, Calendar, Users, Search, Edit3, Trash2, UserCheck } from 'lucide-react';
import { AdminCard, FadeIn, StatCard, Toggle } from '../../../components/admin';
import { classImageUrl } from '../../../lib/classImageUrl';
import CoverPreview from './CoverPreview';

/**
 * Build a compact one-line schedule summary like "Mon, Wed, Fri 09:00-10:00"
 * for the class card. Specific-date slots count is appended if more than
 * two; otherwise each is spelled out.
 */
function buildScheduleSummary(classItem, dayLabel, t, lang) {
  const schedules = classItem.gym_class_schedules || [];
  if (schedules.length === 0) return null;

  const recurring = schedules.filter(s => !s.specific_date);
  const specific = schedules.filter(s => s.specific_date);

  // Group recurring by time range
  const sorted = [...recurring].sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time));
  const byTime = {};
  for (const s of sorted) {
    const timeKey = `${s.start_time?.slice(0, 5)}-${s.end_time?.slice(0, 5)}`;
    if (!byTime[timeKey]) byTime[timeKey] = [];
    byTime[timeKey].push(s.day_of_week);
  }

  const parts = [];
  for (const [time, days] of Object.entries(byTime)) {
    const dayNames = days.map(d => dayLabel(d)?.slice(0, 3)).join(', ');
    parts.push(`${dayNames} ${time}`);
  }

  // Append specific date count if any
  if (specific.length > 0) {
    const sortedDates = [...specific].sort((a, b) => a.specific_date.localeCompare(b.specific_date));
    if (specific.length <= 2) {
      for (const s of sortedDates) {
        const d = new Date(s.specific_date + 'T00:00:00');
        parts.push(`${d.toLocaleDateString(lang, { month: 'short', day: 'numeric' })} ${s.start_time?.slice(0, 5)}`);
      }
    } else {
      parts.push(t('admin.classes.plusDates', '+{{count}} dates', { count: specific.length }));
    }
  }

  return parts.join(' | ');
}

/**
 * "Classes" tab on the AdminClasses page — the simplified card grid with
 * top-of-page stat cards, search, and per-class action row (active toggle,
 * edit pencil, delete trash). Tap a card body to open the ClassDetailModal.
 *
 * The card prefers (in order): uploaded image, cover preset gradient,
 * fallback accent-color block with calendar icon.
 */
export default function ClassesListView({ classes, onEdit, onDelete, onToggleActive, onOpenDetail, dayLabel, todaysClasses, upcomingBookings, t, tc, lang }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return classes;
    const q = search.toLowerCase();
    return classes.filter(c => c.name.toLowerCase().includes(q) || c.instructor?.toLowerCase().includes(q));
  }, [classes, search]);

  // Summary stats
  const totalSlots = classes.reduce((sum, c) => sum + (c.gym_class_schedules?.length || 0), 0);
  const activeCount = classes.filter(c => c.is_active).length;

  return (
    <div className="space-y-4">
      {/* Top stat cards */}
      <span className="admin-eyebrow">{t('admin.classes.eyebrowAtAGlance', { defaultValue: 'At a glance' })}</span>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3">
        <StatCard
          label={t('admin.classes.statActiveClasses')}
          value={activeCount}
          icon={CalendarDays}
          borderColor="var(--color-success)"
          delay={0}
        />
        <StatCard
          label={t('admin.classes.statWeeklySlots')}
          value={totalSlots}
          icon={Clock}
          borderColor="var(--color-info)"
          delay={40}
        />
        <StatCard
          label={t('admin.classes.statTodaysClasses')}
          value={todaysClasses}
          icon={Calendar}
          borderColor="var(--color-accent)"
          delay={80}
        />
        <StatCard
          label={t('admin.classes.statUpcomingBookings')}
          value={upcomingBookings}
          icon={Users}
          borderColor="var(--color-coach)"
          delay={120}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input type="text" placeholder={t('admin.classes.searchClasses')} aria-label={t('admin.classes.searchClasses')} value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl pl-9 pr-4 py-2.5 text-[13px] outline-none transition-all duration-200"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {filtered.map((cls, idx) => {
          const scheduleSummary = buildScheduleSummary(cls, dayLabel, t, lang);
          return (
            <FadeIn key={cls.id} delay={idx * 40}>
              <AdminCard hover padding="p-0" borderLeft={cls.accent_color}>
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer"
                  onClick={() => onOpenDetail(cls)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(cls); } }}
                >
                  {classImageUrl(cls.image_path) ? (
                    <img src={classImageUrl(cls.image_path)} alt={cls.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border-subtle)' }} />
                  ) : cls.cover_preset ? (
                    <CoverPreview preset={cls.cover_preset} size="md" className="flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center"
                      style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: `${cls.accent_color}15` }}>
                      <CalendarDays size={20} style={{ color: cls.accent_color }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</h3>
                      {!cls.is_active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                          {t('admin.classes.inactive')}
                        </span>
                      )}
                    </div>
                    {cls.instructor && <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{cls.instructor}</p>}
                    {cls.trainer && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {cls.trainer.avatar_url ? (
                          <img src={cls.trainer.avatar_url} alt={cls.trainer.full_name || t('admin.classes.trainerAvatarAlt', 'Trainer avatar')} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                            <span className="text-[7px] font-bold" style={{ color: 'var(--color-accent)' }}>{cls.trainer.full_name?.[0]?.toUpperCase() || '?'}</span>
                          </div>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                          <UserCheck size={11} className="inline mr-0.5" style={{ color: 'var(--color-accent)' }} />
                          {cls.trainer.full_name}
                        </span>
                      </div>
                    )}
                    {/* Schedule summary */}
                    {scheduleSummary && (
                      <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                        <CalendarDays size={11} className="flex-shrink-0" />
                        <span className="truncate">{scheduleSummary}</span>
                      </p>
                    )}
                    {!scheduleSummary && (
                      <p className="text-[11px] italic mt-1.5" style={{ color: 'var(--color-text-faint)' }}>{t('admin.classes.noScheduleSlots')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Toggle checked={cls.is_active} onChange={() => onToggleActive(cls)} label={t('admin.classes.toggleActive')} />
                    <button onClick={() => onEdit(cls)} className="p-1.5 sm:p-2 rounded-lg transition-all duration-200 hover:scale-110" style={{ color: 'var(--color-text-muted)' }} aria-label={tc('edit')}><Edit3 size={15} /></button>
                    <button onClick={() => onDelete(cls)} className="p-1.5 sm:p-2 rounded-lg transition-all duration-200 hover:scale-110" style={{ color: 'var(--color-danger, #EF4444)' }} aria-label={tc('delete')}><Trash2 size={15} /></button>
                  </div>
                </div>
              </AdminCard>
            </FadeIn>
          );
        })}
      </div>
    </div>
  );
}
