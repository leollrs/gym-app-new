import { useState } from 'react';
import { Calendar, BarChart3, Users, CalendarDays, Clock, UserCheck, Repeat } from 'lucide-react';
import { AdminModal } from '../../../components/admin';
import { classImageUrl } from '../../../lib/classImageUrl';
import { slotDayLabel, format12h } from '../../../lib/admin/classScheduleHelpers';
import CoverPreview from './CoverPreview';
import ClassAnalytics from './ClassAnalytics';
import BookingsView from './BookingsView';

/**
 * Three-tab modal the admin sees when they click a class row: Schedule
 * (read-only summary + slot list), Analytics (ClassAnalytics — 30-day
 * stats), Bookings (BookingsView — date picker with per-slot attendee
 * lists and inline cancel).
 *
 * The slot list here is read-only — edits go through the pencil button
 * on the parent page, which opens ClassFormModal. Keeping this surface
 * read-only avoids two ways to mutate the same data.
 */
export default function ClassDetailModal({ classItem, onClose, dayLabel, gymId, t, tc, lang }) {
  const [detailTab, setDetailTab] = useState('schedule');

  const DETAIL_TABS = [
    { key: 'schedule', label: t('admin.classes.tabSchedule'), icon: Calendar },
    { key: 'analytics', label: t('admin.classes.analytics'), icon: BarChart3 },
    { key: 'bookings', label: t('admin.classes.bookings'), icon: Users },
  ];

  return (
    <AdminModal isOpen onClose={onClose} title={classItem.name} size="lg">
      {/* Detail tabs */}
      <div className="flex gap-1 mb-4 -mt-1 overflow-x-auto scrollbar-hide" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
        {DETAIL_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = detailTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setDetailTab(tab.key)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] sm:text-[12px] font-semibold transition-all duration-200 border-b-2 -mb-px whitespace-nowrap"
              style={{
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderColor: isActive ? 'var(--color-accent)' : 'transparent',
              }}>
              <Icon size={13} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Schedule tab */}
      {detailTab === 'schedule' && (
        <div className="space-y-3">
          {/* Class info — read-only summary of the class. Edits are done via
              the pencil icon (Edit class form), not here. */}
          <div
            className="rounded-xl p-3 flex items-start gap-3"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
          >
            {classImageUrl(classItem.image_path) ? (
              <img
                src={classImageUrl(classItem.image_path)}
                alt={classItem.name}
                className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                style={{ border: '1px solid var(--color-border-subtle)' }}
              />
            ) : classItem.cover_preset ? (
              <CoverPreview preset={classItem.cover_preset} size="md" className="flex-shrink-0" />
            ) : (
              <div
                className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${classItem.accent_color || 'var(--color-accent)'}20` }}
              >
                <CalendarDays size={20} style={{ color: classItem.accent_color || 'var(--color-accent)' }} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 style={{ fontFamily: 'var(--admin-font-display, "Archivo", system-ui, sans-serif)', fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--color-text-primary)' }}>
                  {(lang === 'es' && classItem.name_es) ? classItem.name_es : classItem.name}
                </h3>
                {!classItem.is_active && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                    {t('admin.classes.inactive')}
                  </span>
                )}
              </div>
              {((lang === 'es' && classItem.description_es) || classItem.description) && (
                <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {(lang === 'es' && classItem.description_es) ? classItem.description_es : classItem.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap" style={{ color: 'var(--color-text-muted)' }}>
                {(classItem.trainer?.full_name || classItem.instructor || classItem.instructor_name) && (
                  <span className="inline-flex items-center gap-1">
                    <UserCheck size={11} style={{ color: 'var(--color-accent)' }} />
                    {classItem.trainer?.full_name || classItem.instructor || classItem.instructor_name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} /> {classItem.duration_minutes} min
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users size={11} /> {classItem.max_capacity}
                </span>
              </div>
            </div>
          </div>

          {/* Schedule slots — READ-ONLY in the detail modal. To edit slots,
              the admin uses the pencil button → Edit class form. */}
          {classItem.gym_class_schedules?.length > 0 ? (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }}>
              {classItem.gym_class_schedules
                .slice()
                .sort((a, b) => {
                  if (a.specific_date && !b.specific_date) return 1;
                  if (!a.specific_date && b.specific_date) return -1;
                  if (a.specific_date && b.specific_date) return a.specific_date.localeCompare(b.specific_date);
                  return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time);
                })
                .map((slot, i) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between px-3 py-2.5"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {slot.specific_date ? (
                        <CalendarDays size={12} style={{ color: 'var(--color-info)' }} />
                      ) : (
                        <Repeat size={12} style={{ color: 'var(--color-accent)' }} />
                      )}
                      <span className="text-[12.5px] font-semibold capitalize truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {slotDayLabel(slot, dayLabel, lang)}
                      </span>
                    </div>
                    <span className="text-[12px] tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                      {format12h(slot.start_time)} – {format12h(slot.end_time)}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[12px] italic py-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noScheduleSlots')}</p>
          )}
        </div>
      )}

      {/* Analytics tab */}
      {detailTab === 'analytics' && (
        <ClassAnalytics classItem={classItem} t={t} lang={lang} />
      )}

      {/* Bookings tab */}
      {detailTab === 'bookings' && (
        <BookingsView classItem={classItem} gymId={gymId} t={t} tc={tc} />
      )}
    </AdminModal>
  );
}
