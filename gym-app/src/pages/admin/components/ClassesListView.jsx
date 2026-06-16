import { useState, useMemo } from 'react';
import { CalendarDays, Clock, Zap, Users, Search, Edit3, Trash2, UserCheck, Check } from 'lucide-react';
import { FadeIn } from '../../../components/admin';
import { ToneIconChip } from '../../../lib/admin/adminTones';
import { classImageUrl } from '../../../lib/classImageUrl';
import CoverPreview from './CoverPreview';
import usePagedVisible from '../../../hooks/usePagedVisible';
import PaginationFooter from '../../../components/admin/PaginationFooter';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

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
    parts.push({ days: dayNames, time });
  }

  // Append specific date count if any
  if (specific.length > 0) {
    const sortedDates = [...specific].sort((a, b) => a.specific_date.localeCompare(b.specific_date));
    if (specific.length <= 2) {
      for (const s of sortedDates) {
        const d = new Date(s.specific_date + 'T00:00:00');
        parts.push({ days: d.toLocaleDateString(lang, { month: 'short', day: 'numeric' }), time: s.start_time?.slice(0, 5) });
      }
    } else {
      parts.push({ days: t('admin.classes.plusDates', '+{{count}} dates', { count: specific.length }), time: '' });
    }
  }

  return parts;
}

/** Connected 4-column stat strip (the Restyle "De un vistazo" band). */
function StatStrip({ stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,20,25,0.03), 0 6px 20px rgba(15,20,25,0.04)' }}>
      {stats.map((s, i) => (
        <div key={i} className="flex items-start justify-between gap-3"
          style={{ padding: '16px 18px', borderRight: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div className="min-w-0">
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 28, fontWeight: 800, letterSpacing: '-1.2px', lineHeight: 1, color: 'var(--color-admin-text)' }}>{s.value}</div>
            <div className="truncate" style={{ fontSize: 12, color: 'var(--color-admin-text-muted)', marginTop: 7, fontWeight: 600 }}>{s.label}</div>
          </div>
          <ToneIconChip icon={s.icon} tone={s.tone} size={30} radius={9} iconScale={0.5} />
        </div>
      ))}
    </div>
  );
}

/** Striped accent fallback thumbnail when a class has no image or cover preset. */
function ClassThumbFallback({ size = 56 }) {
  return (
    <div className="grid place-items-center flex-shrink-0"
      style={{
        width: size, height: size, borderRadius: 14,
        background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
        backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 7px, color-mix(in srgb, var(--color-accent) 7%, transparent) 7px, color-mix(in srgb, var(--color-accent) 7%, transparent) 8px)',
      }}>
      <CalendarDays size={Math.round(size * 0.4)} strokeWidth={1.9} style={{ color: 'var(--color-accent)' }} />
    </div>
  );
}

/** Bordered ghost icon button (edit / delete). */
function GhostIcon({ icon: Icon, onClick, danger, label }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="grid place-items-center flex-shrink-0 transition-colors hover:bg-[var(--color-bg-hover)]"
      style={{ width: 40, height: 40, borderRadius: 10, background: 'transparent', border: '1px solid var(--color-admin-border)', color: danger ? 'var(--color-danger)' : 'var(--color-admin-text-muted)' }}>
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

/**
 * "Classes" tab on the AdminClasses page — Restyle list: a connected stat
 * strip, a search bar, and full-width class rows (accent edge bar, cover
 * thumb, status pill, instructor, schedule summary, active toggle + ghost
 * edit/delete). Tap a row body to open the ClassDetailModal.
 */
export default function ClassesListView({ classes, onEdit, onDelete, onToggleActive, onOpenDetail, dayLabel, todaysClasses, upcomingBookings, t, tc, lang }) {
  const [search, setSearch] = useState('');
  const pager = usePagedVisible({ initial: 10, step: 10 });

  const filtered = useMemo(() => {
    if (!search) return classes;
    const q = search.toLowerCase();
    return classes.filter(c => c.name.toLowerCase().includes(q) || c.instructor?.toLowerCase().includes(q));
  }, [classes, search]);

  // Summary stats
  const totalSlots = classes.reduce((sum, c) => sum + (c.gym_class_schedules?.length || 0), 0);
  const activeCount = classes.filter(c => c.is_active).length;

  const stats = [
    { value: activeCount, label: t('admin.classes.statActiveClasses'), icon: CalendarDays, tone: 'teal' },
    { value: totalSlots, label: t('admin.classes.statWeeklySlots'), icon: Clock, tone: 'info' },
    { value: todaysClasses, label: t('admin.classes.statTodaysClasses'), icon: Zap, tone: 'warn' },
    { value: upcomingBookings, label: t('admin.classes.statUpcomingBookings'), icon: Users, tone: 'coach' },
  ];

  return (
    <div className="space-y-4">
      {/* At a glance — connected stat strip */}
      <span className="admin-eyebrow">{t('admin.classes.eyebrowAtAGlance', { defaultValue: 'At a glance' })}</span>
      <StatStrip stats={stats} />

      {/* Search */}
      <div className="flex items-center gap-2.5"
        style={{ height: 46, padding: '0 16px', background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 13 }}>
        <Search size={17} strokeWidth={2} style={{ color: 'var(--color-admin-text-faint)' }} />
        <input type="text" placeholder={t('admin.classes.searchClasses')} aria-label={t('admin.classes.searchClasses')}
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-0 bg-transparent outline-none text-[14px]"
          style={{ color: 'var(--color-admin-text)' }} />
      </div>

      {/* Class rows */}
      <div className="space-y-3">
        {filtered.slice(0, pager.visibleCount).map((cls, idx) => {
          const parts = buildScheduleSummary(cls, dayLabel, t, lang);
          const trainerName = cls.trainer?.full_name || cls.instructor;
          return (
            <FadeIn key={cls.id} delay={idx * 40}>
              <div
                className="relative flex items-center gap-4 cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => onOpenDetail(cls)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(cls); } }}
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 16, padding: '16px 18px 16px 16px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,20,25,0.03), 0 6px 20px rgba(15,20,25,0.04)' }}
              >
                {/* accent edge bar */}
                <span className="absolute left-0 top-0 bottom-0" style={{ width: 4, background: cls.is_active ? 'var(--color-accent)' : 'var(--color-admin-border)' }} />

                {classImageUrl(cls.image_path) ? (
                  <img src={classImageUrl(cls.image_path)} alt={cls.name} className="w-14 h-14 rounded-[14px] object-cover flex-shrink-0" style={{ border: '1px solid var(--color-admin-border)' }} />
                ) : cls.cover_preset ? (
                  <CoverPreview preset={cls.cover_preset} size="md" className="flex-shrink-0 !rounded-[14px]" />
                ) : (
                  <ClassThumbFallback />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 17, letterSpacing: '-0.3px', color: 'var(--color-admin-text)' }}>{cls.name}</h3>
                    {cls.is_active ? (
                      <span className="inline-flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-success-ink)', background: 'var(--color-success-soft)', padding: '3px 9px', borderRadius: 999 }}>
                        <Check size={11} strokeWidth={2.6} /> {t('admin.classes.active', 'Activa')}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-admin-text-sub)', background: 'var(--color-admin-panel)', padding: '3px 9px', borderRadius: 999 }}>
                        {t('admin.classes.inactive')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-x-4 gap-y-1.5 mt-2 flex-wrap">
                    {trainerName && (
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        {cls.trainer?.avatar_url ? (
                          <img src={cls.trainer.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}>
                            <UserCheck size={11} style={{ color: 'var(--color-accent)' }} />
                          </span>
                        )}
                        <span className="truncate" style={{ fontSize: 13, color: 'var(--color-admin-text-sub)', fontWeight: 600 }}>{trainerName}</span>
                      </span>
                    )}
                    {parts && parts.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 min-w-0" style={{ fontSize: 13, color: 'var(--color-admin-text-muted)' }}>
                        <CalendarDays size={14} strokeWidth={2} className="flex-shrink-0" />
                        <span className="truncate">{parts[0].days}</span>
                        {parts[0].time && <span style={{ fontFamily: MONO_FONT, color: 'var(--color-admin-text-sub)', fontWeight: 600 }}>{parts[0].time}</span>}
                        {parts.length > 1 && <span style={{ color: 'var(--color-admin-text-faint)' }}>+{parts.length - 1}</span>}
                      </span>
                    ) : (
                      <span className="italic" style={{ fontSize: 12.5, color: 'var(--color-admin-text-faint)' }}>{t('admin.classes.noScheduleSlots')}</span>
                    )}
                  </div>
                </div>

                {/* actions */}
                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onToggleActive(cls)}
                    role="switch"
                    aria-checked={cls.is_active}
                    aria-label={t('admin.classes.toggleActive')}
                    className="relative flex-shrink-0 transition-colors"
                    style={{ width: 42, height: 24, borderRadius: 999, padding: 3, background: cls.is_active ? 'var(--color-accent)' : 'var(--color-admin-border)' }}
                  >
                    <span className="block rounded-full transition-transform" style={{ width: 18, height: 18, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transform: cls.is_active ? 'translateX(18px)' : 'translateX(0)' }} />
                  </button>
                  <GhostIcon icon={Edit3} onClick={() => onEdit(cls)} label={tc('edit')} />
                  <GhostIcon icon={Trash2} onClick={() => onDelete(cls)} danger label={tc('delete')} />
                </div>
              </div>
            </FadeIn>
          );
        })}
      </div>
      <PaginationFooter pager={pager} total={filtered.length} />
    </div>
  );
}
