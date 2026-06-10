import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, Users, Clock, Dumbbell, BarChart3, Star, Plus,
  Trash2, Search, Check, UserCheck, X, ChevronRight, ChevronLeft,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import posthog from 'posthog-js';
import logger from '../../lib/logger';
import { format, addDays, addMonths, startOfDay, startOfMonth, startOfWeek, endOfWeek, endOfMonth, getDay, getDaysInMonth, isSameDay } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import UnderlineTabs from '../../components/UnderlineTabs';
import Skeleton from '../../components/Skeleton';
import TrainerEmptyState from './components/TrainerEmptyState';
import { TT, TFont } from './components/designTokens';
import {
  TCard, TEyebrow, TPageTitle, TDarkButton, TPrimaryButton, TPill,
} from './components/designPrimitives';

// Shared form styles (match TrainerProfile)
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  fontSize: 13.5, border: `1px solid ${TT.borderSolid}`,
  background: TT.surface, color: TT.text, outline: 'none',
  fontFamily: 'inherit',
};
const labelStyle = {
  fontSize: 11.5, fontWeight: 800, color: TT.textSub,
  letterSpacing: 0.4, textTransform: 'uppercase',
  marginBottom: 6, display: 'block',
};

const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'days.sunday' },
  { value: 1, labelKey: 'days.monday' },
  { value: 2, labelKey: 'days.tuesday' },
  { value: 3, labelKey: 'days.wednesday' },
  { value: 4, labelKey: 'days.thursday' },
  { value: 5, labelKey: 'days.friday' },
  { value: 6, labelKey: 'days.saturday' },
];

const TABS = ['myClasses', 'bookings', 'analytics'];

// ── Shared spinner ──
function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center">
      <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TT.accent, borderTopColor: 'transparent' }} />
      <span style={{ fontSize: 12, color: TT.textMute }}>{label}</span>
    </div>
  );
}

// ── Class Detail Drawer (for My Classes tab) ──
function ClassDetailDrawer({ cls, gymId, onClose, t, tc }) {
  const [adding, setAdding] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const schedules = (cls.gym_class_schedules || [])
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));

  const handleAddSlot = async () => {
    const { error } = await supabase.from('gym_class_schedules').insert({
      class_id: cls.id,
      gym_id: gymId,
      ...newSlot,
    });
    if (error) {
      logger.error('TrainerClasses: add slot error', error);
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
      setAdding(false);
      setNewSlot({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
    }
  };

  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId);
    if (error) {
      showToast(t('trainerClasses.errorDeleteSlot', 'Failed to delete slot'), 'error');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
  };

  const accentColor = cls.accent_color || TT.accent;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 480, maxHeight: '90vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: TT.shadowLg,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${TT.border}`, flexShrink: 0,
        }}>
          <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {t('trainerClasses.classDetails')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('trainerClasses.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Class info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {cls.image_url ? (
              <img src={cls.image_url} alt={cls.name} style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', flexShrink: 0, border: `1px solid ${TT.border}` }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', flexShrink: 0, background: accentColor + '20' }}>
                <CalendarDays size={22} style={{ color: accentColor }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cls.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: TT.textSub, fontWeight: 600 }}>
                  <Clock size={12} /> {cls.duration_minutes} {t('trainerClasses.minutesShort', 'min')}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: TT.textSub, fontWeight: 600 }}>
                  <Users size={12} /> {cls.max_capacity}
                </span>
              </div>
            </div>
          </div>

          {/* Schedule slots */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2 }}>
                {t('trainerClasses.schedule')} ({schedules.length})
              </div>
              {!adding && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: TT.accentDark, background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 44, padding: '0 2px' }}
                >
                  <Plus size={13} /> {t('trainerClasses.addSlot')}
                </button>
              )}
            </div>

            {schedules.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {schedules.map(slot => (
                  <div key={slot.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', background: TT.surface2, borderRadius: 10, border: `1px solid ${TT.border}` }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: TT.text, flexShrink: 0 }}>
                      {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey || '')}
                    </span>
                    <span style={{ fontFamily: TFont.mono, fontSize: 12, color: TT.textSub, flex: 1, textAlign: 'right', letterSpacing: -0.3 }}>
                      {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteSlot(slot.id)}
                      aria-label={t('trainerClasses.errorDeleteSlot', 'Failed to delete slot')}
                      style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'transparent', color: TT.textMute, cursor: 'pointer' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {adding && (
              <div style={{ padding: 12, background: TT.surface2, borderRadius: 12, border: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t('trainerClasses.day')}</label>
                  <select
                    value={newSlot.day_of_week}
                    onChange={e => setNewSlot(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                    style={inputStyle}
                  >
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label style={labelStyle}>{t('trainerClasses.start')}</label>
                    <input
                      type="time"
                      value={newSlot.start_time}
                      onChange={e => setNewSlot(s => ({ ...s, start_time: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{t('trainerClasses.end')}</label>
                    <input
                      type="time"
                      value={newSlot.end_time}
                      onChange={e => setNewSlot(s => ({ ...s, end_time: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TPrimaryButton onClick={handleAddSlot} style={{ minHeight: 44 }}>
                    {t('trainerClasses.save')}
                  </TPrimaryButton>
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    style={{ padding: '10px 14px', borderRadius: 10, background: 'transparent', color: TT.textSub, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', minHeight: 44 }}
                  >
                    {t('trainerClasses.cancel')}
                  </button>
                </div>
              </div>
            )}

            {schedules.length === 0 && !adding && (
              <p style={{ fontSize: 12, color: TT.textMute, fontStyle: 'italic' }}>{t('trainerClasses.noScheduleSlots')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: My Classes ──
function MyClassesTab({ classes, gymId, t, tc, dateLocale }) {
  const [selectedClass, setSelectedClass] = useState(null);
  const [view, setView] = useState('week'); // day | week | month
  const [dayDate, setDayDate] = useState(() => startOfDay(new Date()));
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const dowLabel = (dow) => tc(DAYS_OF_WEEK.find(d => d.value === dow)?.labelKey || '');
  const todayDow = new Date().getDay();

  // Explode classes into slot-instances grouped by weekday.
  const slotsByDow = useMemo(() => {
    const map = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    classes.forEach(cls => {
      (cls.gym_class_schedules || []).forEach(slot => {
        if (slot.day_of_week == null || !map[slot.day_of_week]) return;
        map[slot.day_of_week].push({ cls, slot });
      });
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.slot.start_time || '').localeCompare(b.slot.start_time || '')));
    return map;
  }, [classes]);

  const totalSlots = useMemo(() => Object.values(slotsByDow).reduce((n, a) => n + a.length, 0), [slotsByDow]);

  const SlotRow = ({ entry }) => {
    const { cls, slot } = entry;
    const accent = cls.accent_color || TT.accent;
    return (
      <button type="button" onClick={() => setSelectedClass(cls)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 12, background: TT.surface, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, cursor: 'pointer', textAlign: 'left', marginBottom: 8 }}>
        <div style={{ width: 4, alignSelf: 'stretch', minHeight: 34, borderRadius: 999, background: accent, flexShrink: 0 }} />
        <div style={{ fontFamily: TFont.mono, fontSize: 12, fontWeight: 800, color: TT.text, width: 94, flexShrink: 0, letterSpacing: -0.3 }}>
          {slot.start_time?.slice(0, 5)}<span style={{ color: TT.textMute }}>–{slot.end_time?.slice(0, 5)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cls.name}</div>
          <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
            {cls.max_capacity} {t('trainerClasses.spots', 'spots')} · {cls.duration_minutes} {t('trainerClasses.minutesShort', 'min')}
          </div>
        </div>
        <ChevronRight size={14} color={TT.textMute} style={{ flexShrink: 0 }} />
      </button>
    );
  };

  const Stepper = ({ label, onPrev, onNext }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button type="button" onClick={onPrev} aria-label={t('trainerClasses.prev', 'Previous')}
        style={{ width: 36, height: 36, borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer', flexShrink: 0 }}>
        <ChevronLeft size={18} />
      </button>
      <div style={{ flex: 1, textAlign: 'center', fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.4, textTransform: 'capitalize' }}>{label}</div>
      <button type="button" onClick={onNext} aria-label={t('trainerClasses.next', 'Next')}
        style={{ width: 36, height: 36, borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer', flexShrink: 0 }}>
        <ChevronRight size={18} />
      </button>
    </div>
  );

  // ── Day view ──
  const renderDay = () => {
    const entries = slotsByDow[dayDate.getDay()] || [];
    return (
      <>
        <Stepper
          label={cap(format(dayDate, 'EEEE d MMM', { locale: dateLocale }))}
          onPrev={() => setDayDate(d => addDays(d, -1))}
          onNext={() => setDayDate(d => addDays(d, 1))}
        />
        {entries.length === 0
          ? <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 13, color: TT.textMute }}>{t('trainerClasses.noClassesDay', 'No classes this day')}</div>
          : entries.map((e, i) => <SlotRow key={i} entry={e} />)}
      </>
    );
  };

  // ── Week view (Mon-first agenda) ──
  const renderWeek = () => (
    <div>
      {[1, 2, 3, 4, 5, 6, 0].map(dow => {
        const entries = slotsByDow[dow] || [];
        const isToday = dow === todayDow;
        return (
          <div key={dow} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: TFont.display, fontSize: 12.5, fontWeight: 800, color: isToday ? TT.accent : TT.text, letterSpacing: 0.3, textTransform: 'uppercase' }}>{dowLabel(dow)}</span>
              {isToday && <span style={{ fontSize: 9, fontWeight: 800, color: '#06363B', background: TT.accent, padding: '2px 7px', borderRadius: 999, letterSpacing: 0.5, textTransform: 'uppercase' }}>{t('trainerClasses.filterToday', 'Today')}</span>}
              {entries.length > 0 && <span style={{ fontSize: 11, color: TT.textMute, fontWeight: 600 }}>{entries.length}</span>}
            </div>
            {entries.length === 0
              ? <div style={{ fontSize: 11.5, color: TT.textMute, paddingLeft: 2, paddingBottom: 2 }}>{t('trainerClasses.free', 'Free')}</div>
              : entries.map((e, i) => <SlotRow key={i} entry={e} />)}
          </div>
        );
      })}
    </div>
  );

  // ── Month view (calendar; tap a day → day view) ──
  const renderMonth = () => {
    const first = startOfMonth(monthDate);
    const lead = (getDay(first) + 6) % 7; // Monday-first offset
    const days = getDaysInMonth(monthDate);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), d));
    const weekdayLabels = [1, 2, 3, 4, 5, 6, 0].map(d => format(new Date(2024, 0, 7 + d), 'EEEEE', { locale: dateLocale }));
    return (
      <>
        <Stepper
          label={cap(format(monthDate, 'MMMM yyyy', { locale: dateLocale }))}
          onPrev={() => setMonthDate(m => addMonths(m, -1))}
          onNext={() => setMonthDate(m => addMonths(m, 1))}
        />
        <TCard padded={12}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
            {weekdayLabels.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase' }}>{w}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const count = (slotsByDow[d.getDay()] || []).length;
              const today = isSameDay(d, new Date());
              const has = count > 0;
              return (
                <button key={i} type="button" disabled={!has}
                  onClick={() => { setDayDate(startOfDay(d)); setView('day'); }}
                  style={{ aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 9, border: today ? `2px solid ${TT.text}` : '1px solid transparent', background: has ? TT.accentSoft : 'transparent', color: has ? TT.accentInk : TT.textMute, cursor: has ? 'pointer' : 'default' }}>
                  <span style={{ fontSize: 12, fontWeight: has ? 800 : 500 }}>{d.getDate()}</span>
                  {has && <span style={{ fontSize: 8.5, fontWeight: 800 }}>{count}</span>}
                </button>
              );
            })}
          </div>
        </TCard>
      </>
    );
  };

  return (
    <>
      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['day', t('trainerClasses.viewDay', 'Day')], ['week', t('trainerClasses.viewWeek', 'Week')], ['month', t('trainerClasses.viewMonth', 'Month')]].map(([k, label]) => {
          const on = view === k;
          return (
            <button key={k} type="button" onClick={() => setView(k)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 11, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.text : TT.surface, color: on ? TT.onInverse : TT.textSub }}>
              {label}
            </button>
          );
        })}
      </div>

      {totalSlots === 0 ? (
        <TrainerEmptyState
          icon={CalendarDays}
          title={t('trainerClasses.noClasses', 'No classes assigned')}
          description={t('trainerClasses.emptyDesc', 'Once your gym admin assigns classes to you, they will appear here.')}
        />
      ) : view === 'day' ? renderDay() : view === 'week' ? renderWeek() : renderMonth()}

      {selectedClass && (
        <ClassDetailDrawer cls={selectedClass} gymId={gymId} onClose={() => setSelectedClass(null)} t={t} tc={tc} />
      )}
    </>
  );
}

// ── Tab 2: Bookings ──
function BookingsTab({ classes, t, dateLocale }) {
  const [view, setView] = useState('day'); // day | week | month
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const classIds = classes.map(c => c.id);

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  const [rangeStart, rangeEnd] = useMemo(() => {
    if (view === 'week') return [startOfWeek(anchorDate, { weekStartsOn: 1 }), endOfWeek(anchorDate, { weekStartsOn: 1 })];
    if (view === 'month') return [startOfMonth(anchorDate), endOfMonth(anchorDate)];
    return [anchorDate, anchorDate];
  }, [view, anchorDate]);
  const rangeStartStr = format(rangeStart, 'yyyy-MM-dd');
  const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd');

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['trainer', 'all-class-bookings', rangeStartStr, rangeEndStr, classIds],
    queryFn: async () => {
      if (classIds.length === 0) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, status, attended, booked_date, class_id, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .gte('booked_date', rangeStartStr)
        .lte('booked_date', rangeEndStr)
        .order('booked_date');
      return data || [];
    },
    enabled: classIds.length > 0,
    staleTime: 30 * 1000,
  });

  const handleMarkAttended = async (bookingId) => {
    const { error } = await supabase
      .from('gym_class_bookings')
      .update({ attended: true, attended_at: new Date().toISOString() })
      .eq('id', bookingId);
    if (error) {
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'all-class-bookings'] });
    }
  };

  const classMap = {};
  for (const c of classes) classMap[c.id] = c;

  const byDate = useMemo(() => {
    const m = {};
    for (const b of bookings) { (m[b.booked_date] = m[b.booked_date] || []).push(b); }
    return m;
  }, [bookings]);

  const renderStepper = ({ label, onPrev, onNext }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button type="button" onClick={onPrev} aria-label={t('trainerClasses.prev', 'Previous')}
        style={{ width: 36, height: 36, borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer', flexShrink: 0 }}>
        <ChevronLeft size={18} />
      </button>
      <div style={{ flex: 1, textAlign: 'center', fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.4, textTransform: 'capitalize' }}>{label}</div>
      <button type="button" onClick={onNext} aria-label={t('trainerClasses.next', 'Next')}
        style={{ width: 36, height: 36, borderRadius: 11, border: `1px solid ${TT.border}`, background: TT.surface, display: 'grid', placeItems: 'center', color: TT.text, cursor: 'pointer', flexShrink: 0 }}>
        <ChevronRight size={18} />
      </button>
    </div>
  );

  // Bookings for one date, grouped by class.
  const renderDayBookings = (dateStr) => {
    const dayBookings = byDate[dateStr] || [];
    const grouped = dayBookings.reduce((acc, b) => {
      (acc[b.class_id] = acc[b.class_id] || []).push(b);
      return acc;
    }, {});
    if (Object.keys(grouped).length === 0) {
      return (
        <TrainerEmptyState
          icon={Users}
          title={t('trainerClasses.noBookings', 'No bookings yet')}
          description={t('trainerClasses.noBookingsDesc', 'When members book this day, they will show up here ready to mark attendance.')}
          compact
        />
      );
    }
    return (
      <div className="space-y-4">
        {Object.entries(grouped).map(([classId, classBookings]) => {
          const cls = classMap[classId];
          const accentColor = cls?.accent_color || TT.accent;
          return (
            <div key={classId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, background: accentColor + '20' }}>
                  <CalendarDays size={12} style={{ color: accentColor }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{cls?.name || t('trainerClasses.unknown')}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: TT.textMute, marginLeft: 'auto' }}>{classBookings.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {classBookings.map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: TT.surface, borderRadius: 12, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, overflow: 'hidden' }}>
                    {b.profiles?.avatar_url ? (
                      <img src={b.profiles.avatar_url} alt={b.profiles?.full_name || t('trainerClasses.members')} style={{ width: 32, height: 32, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: TT.accentSoft }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: TT.accentInk }}>{b.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.profiles?.full_name || t('trainerClasses.unknown')}</span>
                    {b.attended ? (
                      <TPill tone="good" size="m"><Check size={11} /> {t('trainerClasses.attended')}</TPill>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleMarkAttended(b.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: TT.accentInk, background: TT.accentSoft, padding: '7px 11px', borderRadius: 999, border: 'none', cursor: 'pointer', minHeight: 44, whiteSpace: 'nowrap' }}
                        className="sm:!min-h-[32px]"
                      >
                        <UserCheck size={11} /> {t('trainerClasses.markAttended')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Week view: 7 day-summary rows ──
  const renderWeek = () => {
    const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {days.map(day => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const dayB = byDate[dayStr] || [];
          const attended = dayB.filter(b => b.attended).length;
          const isToday = isSameDay(day, new Date());
          return (
            <button key={dayStr} type="button" onClick={() => { setAnchorDate(startOfDay(day)); setView('day'); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: TT.surface, border: `1px solid ${isToday ? TT.accent : TT.border}`, boxShadow: TT.shadow, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 42, flexShrink: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: isToday ? TT.accent : TT.textMute, textTransform: 'uppercase' }}>{format(day, 'EEE', { locale: dateLocale })}</div>
                <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4, lineHeight: 1 }}>{format(day, 'd')}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {dayB.length === 0 ? (
                  <span style={{ fontSize: 12.5, color: TT.textMute }}>{t('trainerClasses.free', 'Free')}</span>
                ) : (
                  <span style={{ fontSize: 12.5, color: TT.text, fontWeight: 600 }}>
                    {t('trainerClasses.weekDaySummary', '{{n}} booked · {{a}} attended', { n: dayB.length, a: attended })}
                  </span>
                )}
              </div>
              {dayB.length > 0 && <ChevronRight size={14} color={TT.textMute} style={{ flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
    );
  };

  // ── Month view: calendar with booking-count badges ──
  const renderMonth = () => {
    const first = startOfMonth(anchorDate);
    const lead = (getDay(first) + 6) % 7;
    const daysIn = getDaysInMonth(anchorDate);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), d));
    const weekdayLabels = [1, 2, 3, 4, 5, 6, 0].map(d => format(new Date(2024, 0, 7 + d), 'EEEEE', { locale: dateLocale }));
    return (
      <TCard padded={12}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
          {weekdayLabels.map((w, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 800, color: TT.textMute, textTransform: 'uppercase' }}>{w}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const count = (byDate[format(d, 'yyyy-MM-dd')] || []).length;
            const today = isSameDay(d, new Date());
            const has = count > 0;
            return (
              <button key={i} type="button" disabled={!has}
                onClick={() => { setAnchorDate(startOfDay(d)); setView('day'); }}
                style={{ aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 9, border: today ? `2px solid ${TT.text}` : '1px solid transparent', background: has ? TT.accentSoft : 'transparent', color: has ? TT.accentInk : TT.textMute, cursor: has ? 'pointer' : 'default' }}>
                <span style={{ fontSize: 12, fontWeight: has ? 800 : 500 }}>{d.getDate()}</span>
                {has && <span style={{ fontSize: 8.5, fontWeight: 800 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </TCard>
    );
  };

  const weekLabel = `${format(rangeStart, 'd MMM', { locale: dateLocale })} – ${format(rangeEnd, 'd MMM', { locale: dateLocale })}`;

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[['day', t('trainerClasses.viewDay', 'Day')], ['week', t('trainerClasses.viewWeek', 'Week')], ['month', t('trainerClasses.viewMonth', 'Month')]].map(([k, label]) => {
          const on = view === k;
          return (
            <button key={k} type="button" onClick={() => setView(k)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 11, fontSize: 13, fontWeight: 800, cursor: 'pointer', border: on ? 'none' : `1px solid ${TT.border}`, background: on ? TT.text : TT.surface, color: on ? TT.onInverse : TT.textSub }}>
              {label}
            </button>
          );
        })}
      </div>

      {view === 'day' && renderStepper({ label: cap(format(anchorDate, 'EEEE d MMM', { locale: dateLocale })), onPrev: () => setAnchorDate(d => addDays(d, -1)), onNext: () => setAnchorDate(d => addDays(d, 1)) })}
      {view === 'week' && renderStepper({ label: weekLabel, onPrev: () => setAnchorDate(d => addDays(d, -7)), onNext: () => setAnchorDate(d => addDays(d, 7)) })}
      {view === 'month' && renderStepper({ label: cap(format(anchorDate, 'MMMM yyyy', { locale: dateLocale })), onPrev: () => setAnchorDate(d => addMonths(d, -1)), onNext: () => setAnchorDate(d => addMonths(d, 1)) })}

      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : view === 'day' ? renderDayBookings(format(anchorDate, 'yyyy-MM-dd'))
        : view === 'week' ? renderWeek()
        : renderMonth()}
    </div>
  );
}

// ── Tab 3: Analytics ──
function AnalyticsTab({ classes, t, dateLocale }) {
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || null);
  const selectedClass = classes.find(c => c.id === selectedClassId);
  const hasTemplate = !!selectedClass?.workout_template_id;

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['trainer', 'class-analytics', selectedClassId],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();

      const { data: allBookings } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating')
        .eq('class_id', selectedClassId)
        .gte('booked_at', since);

      const bookings = allBookings || [];
      const total = bookings.length;
      const attended = bookings.filter(b => b.attended).length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      const rated = bookings.filter(b => b.rating != null && b.attended);
      const avgRating = rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : null;

      const starDist = [0, 0, 0, 0, 0];
      rated.forEach(b => {
        const idx = Math.max(0, Math.min(4, Math.round(b.rating) - 1));
        starDist[idx]++;
      });

      let recentResults = [];
      if (hasTemplate) {
        const { data: resultBookings } = await supabase
          .from('gym_class_bookings')
          .select('profile_id, rating, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
          .eq('class_id', selectedClassId)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        recentResults = resultBookings || [];
      }

      return { total, attended, attendanceRate, avgRating, starDist, recentResults };
    },
    enabled: !!selectedClassId,
    staleTime: 60 * 1000,
  });

  if (classes.length === 0) {
    return (
      <TrainerEmptyState
        icon={BarChart3}
        title={t('trainerClasses.noClasses', 'No classes assigned')}
        description={t('trainerClasses.analyticsEmptyDesc', 'Once you have classes, attendance and rating analytics appear here.')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Class selector */}
      <div className="mb-5">
        <UnderlineTabs
          tabs={classes.map(cls => ({ key: cls.id, label: cls.name }))}
          activeIndex={Math.max(0, classes.findIndex(cls => cls.id === selectedClassId))}
          onChange={(i) => setSelectedClassId(classes[i].id)}
          scrollable
        />
      </div>

      {/* Analytics content */}
      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : !analytics || analytics.total === 0 ? (
        <TrainerEmptyState
          icon={BarChart3}
          title={t('trainerClasses.noData', 'No data yet')}
          description={t('trainerClasses.noDataDesc', 'Booking and attendance data will appear here once members start booking.')}
          compact
        />
      ) : (
        <>
          {/* Attendance rate + avg rating cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TCard padded={16} style={{ borderRadius: 18 }}>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: TT.textMute, marginBottom: 6 }}>{t('trainerClasses.attendanceRate')}</p>
              <p style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>{analytics.attendanceRate}%</p>
              <p style={{ fontFamily: TFont.mono, fontSize: 11, color: TT.textMute, marginTop: 4 }}>
                {analytics.attended}/{analytics.total}
              </p>
            </TCard>
            <TCard padded={16} style={{ borderRadius: 18 }}>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: TT.textMute, marginBottom: 6 }}>{t('trainerClasses.avgRating')}</p>
              {analytics.avgRating ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <p style={{ fontFamily: TFont.display, fontSize: 26, fontWeight: 800, color: TT.text, letterSpacing: -1, lineHeight: 1 }}>{analytics.avgRating}</p>
                    <Star size={18} style={{ color: TT.accent, fill: TT.accent }} />
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[5, 4, 3, 2, 1].map(star => {
                      const count = analytics.starDist[star - 1];
                      const maxCount = Math.max(...analytics.starDist, 1);
                      return (
                        <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: TFont.mono, fontSize: 9, color: TT.textMute, width: 12, textAlign: 'right' }}>{star}</span>
                          <Star size={8} style={{ color: TT.accent, fill: TT.accent, flexShrink: 0 }} />
                          <div style={{ flex: 1, height: 6, background: TT.surface2, borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 999, background: TT.accent, width: `${(count / maxCount) * 100}%` }} />
                          </div>
                          <span style={{ fontFamily: TFont.mono, fontSize: 9, color: TT.textMute, width: 16 }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 14, color: TT.textMute }}>--</p>
              )}
            </TCard>
          </div>

          {/* Recent attendees */}
          {hasTemplate && analytics.recentResults.length > 0 && (
            <div>
              <p style={{ fontFamily: TFont.display, fontSize: 14, fontWeight: 800, color: TT.text, letterSpacing: -0.2, marginBottom: 10 }}>{t('trainerClasses.recentAttendees')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {analytics.recentResults.map((r, i) => (
                  <div
                    key={`${r.profile_id}-${i}`}
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, background: TT.surface, borderRadius: 12, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, overflow: 'hidden' }}
                  >
                    {r.profiles?.avatar_url ? (
                      <img src={r.profiles.avatar_url} alt={r.profiles?.full_name || t('trainerClasses.members')} style={{ width: 32, height: 32, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: TT.accentSoft }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: TT.accentInk }}>
                          {r.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.profiles?.full_name || t('trainerClasses.unknown')}
                      </span>
                      {r.attended_at && (
                        <span style={{ fontSize: 10, color: TT.textMute }}>
                          {format(new Date(r.attended_at), 'MMM d', { locale: dateLocale })}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {r.workout_sessions?.total_volume_lbs != null && (
                        <span style={{ fontSize: 11, color: TT.textSub, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <Dumbbell size={11} />
                          <span style={{ fontFamily: TFont.mono }}>{Number(r.workout_sessions.total_volume_lbs).toLocaleString()}</span> {t('trainerClasses.lbs')}
                        </span>
                      )}
                      {r.rating != null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star
                              key={s}
                              size={10}
                              style={s <= Math.round(r.rating) ? { color: TT.accent, fill: TT.accent } : { color: TT.textFaint }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Routine Selector (reused from original) ──
function RoutineSelector({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');

  const { data: routines = [] } = useQuery({
    queryKey: ['trainer', 'routines-for-classes', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(count)')
        .eq('gym_id', gymId)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = routines.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selected = routines.find(r => r.id === value);

  return (
    <div>
      {selected ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, background: TT.surface, border: `1px solid ${TT.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <Dumbbell size={14} style={{ color: TT.accent, flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TT.text, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selected.name}
            <span style={{ color: TT.textMute, marginLeft: 6 }}>
              ({t('trainerClasses.exerciseCount', { count: selected.routine_exercises?.[0]?.count || 0 })})
            </span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => onChange(null)}
              style={{ fontSize: 11, fontWeight: 700, color: TT.accentDark, background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 44, minWidth: 44, padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t('trainerClasses.changeTemplate')}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              style={{ fontSize: 11, fontWeight: 700, color: TT.hot, background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 44, minWidth: 44, padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t('trainerClasses.removeTemplate')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: TT.textMute }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('trainerClasses.changeTemplate')}
              style={{ ...inputStyle, paddingLeft: 32 }}
            />
          </div>
          {search && filtered.length > 0 && (
            <div style={{ maxHeight: 192, overflowY: 'auto', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface }}>
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, color: TT.text, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}
                >
                  <Dumbbell size={12} style={{ color: TT.textMute, flexShrink: 0 }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ color: TT.textMute, marginLeft: 'auto', flexShrink: 0, fontFamily: TFont.mono }}>
                    {r.routine_exercises?.[0]?.count || 0}
                  </span>
                </button>
              ))}
            </div>
          )}
          {search && filtered.length === 0 && (
            <p style={{ fontSize: 11, color: TT.textMute, fontStyle: 'italic', paddingLeft: 2 }}>{t('trainerClasses.noTemplatesFound')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Template Preview ──
function TemplatePreview({ templateId, t }) {
  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['trainer', 'template-exercises', templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('routine_exercises')
        .select('id, sets, reps, exercises(name)')
        .eq('routine_id', templateId)
        .order('order_index');
      return data || [];
    },
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
  });

  if (!templateId) return null;
  if (isLoading) return <Spinner label={t('trainerClasses.loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {exercises.map((ex, i) => (
        <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: TT.surface, borderRadius: 10, border: `1px solid ${TT.border}` }}>
          <span style={{ fontFamily: TFont.mono, fontSize: 10, color: TT.textMute, width: 16, textAlign: 'right' }}>{i + 1}.</span>
          <span style={{ flex: 1, fontSize: 12, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ex.exercises?.name || t('trainerClasses.unknown')}</span>
          <span style={{ fontFamily: TFont.mono, fontSize: 10, color: TT.textMute }}>{ex.sets}x{ex.reps}</span>
        </div>
      ))}
      {exercises.length === 0 && (
        <p style={{ fontSize: 11, color: TT.textMute, fontStyle: 'italic' }}>{t('trainerClasses.noExercises')}</p>
      )}
    </div>
  );
}

// ── Tab 4: Templates ──
function TemplatesTab({ classes, gymId, t }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Get routine names for classes that have templates
  const templateIds = classes.filter(c => c.workout_template_id).map(c => c.workout_template_id);

  const { data: routineNames = {} } = useQuery({
    queryKey: ['trainer', 'routine-names', templateIds],
    queryFn: async () => {
      if (templateIds.length === 0) return {};
      const { data } = await supabase
        .from('routines')
        .select('id, name')
        .in('id', templateIds);
      const map = {};
      (data || []).forEach(r => { map[r.id] = r.name; });
      return map;
    },
    enabled: templateIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const handleChangeTemplate = async (classId, templateId) => {
    const { error } = await supabase
      .from('gym_classes')
      .update({ workout_template_id: templateId, updated_at: new Date().toISOString() })
      .eq('id', classId);
    if (error) {
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  const [expandedClass, setExpandedClass] = useState(null);

  if (classes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 0' }}>
        <Dumbbell size={40} style={{ margin: '0 auto 12px', color: TT.textMute }} />
        <p style={{ fontSize: 15, color: TT.textMute }}>{t('trainerClasses.noClasses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {classes.map(cls => {
        const isExpanded = expandedClass === cls.id;
        const templateName = cls.workout_template_id
          ? (routineNames[cls.workout_template_id] || t('trainerClasses.template'))
          : null;
        const accentColor = cls.accent_color || TT.accent;

        return (
          <div key={cls.id} style={{ background: TT.surface, borderRadius: 18, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setExpandedClass(isExpanded ? null : cls.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 16, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              {cls.image_url ? (
                <img src={cls.image_url} alt={cls.name} style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover', flexShrink: 0, border: `1px solid ${TT.border}` }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0, background: accentColor + '20' }}>
                  <CalendarDays size={16} style={{ color: accentColor }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cls.name}</div>
                {templateName ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: TT.accentDark, marginTop: 2 }}>
                    <Dumbbell size={11} /> {templateName}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: TT.textMute, marginTop: 2, display: 'block' }}>{t('trainerClasses.noTemplate')}</span>
                )}
              </div>
              <ChevronRight size={16} style={{ color: TT.textMute, flexShrink: 0, transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }} />
            </button>

            {isExpanded && (
              <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${TT.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <RoutineSelector
                  gymId={gymId}
                  value={cls.workout_template_id}
                  onChange={(templateId) => handleChangeTemplate(cls.id, templateId)}
                  t={t}
                />
                <TemplatePreview templateId={cls.workout_template_id} t={t} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Propose New Class Modal ──
function ProposeClassModal({ gymId, trainerId, onClose, t, tc }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', description: '', day_of_week: 1, start_time: '09:00', duration: 60 });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('log_admin_action', {
        p_action: 'class_proposal',
        p_entity_type: 'class',
        p_entity_id: null,
        p_details: {
          class_name: form.name.trim(),
          description: form.description.trim(),
          suggested_day: form.day_of_week,
          suggested_time: form.start_time,
          duration_minutes: form.duration,
        },
      });
      if (error) throw error;
      posthog?.capture('trainer_class_proposed');
      showToast(t('trainerClasses.proposalSent', 'Proposal sent to admin'), 'success');
      onClose();
    } catch (err) {
      logger.error('ProposeClass: error', err);
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(11,15,18,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: TT.surface, borderRadius: 18,
          width: '100%', maxWidth: 420, maxHeight: '90vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: TT.shadowLg,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: `1px solid ${TT.border}`, flexShrink: 0,
        }}>
          <div style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
            {t('trainerClasses.proposeClass', 'Propose New Class')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('trainerClasses.close', 'Close')}
            style={{
              width: 32, height: 32, borderRadius: 999, border: 'none',
              background: TT.surface2, color: TT.textSub,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Class name */}
          <div>
            <label style={labelStyle}>{t('trainerClasses.className', 'Class Name')}</label>
            <input
              value={form.name}
              onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
              placeholder={t('trainerClasses.classNamePlaceholder', 'e.g. HIIT Cardio')}
              autoFocus
              style={inputStyle}
            />
          </div>
          {/* Description */}
          <div>
            <label style={labelStyle}>{t('trainerClasses.classDescription', 'Description')}</label>
            <textarea
              value={form.description}
              onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
              placeholder={t('trainerClasses.classDescPlaceholder', 'Describe the class...')}
              rows={3}
              style={{ ...inputStyle, resize: 'none' }}
            />
          </div>
          {/* Day + Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label style={labelStyle}>{t('trainerClasses.suggestedDay', 'Day')}</label>
              <select
                value={form.day_of_week}
                onChange={e => setForm(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                style={inputStyle}
              >
                {DAYS_OF_WEEK.map(d => (
                  <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('trainerClasses.suggestedTime', 'Time')}</label>
              <input
                type="time"
                value={form.start_time}
                onChange={e => setForm(s => ({ ...s, start_time: e.target.value }))}
                style={inputStyle}
              />
            </div>
          </div>
          {/* Duration */}
          <div>
            <label style={labelStyle}>{t('trainerClasses.duration', 'Duration (min)')}</label>
            <input
              type="number"
              value={form.duration}
              onChange={e => setForm(s => ({ ...s, duration: Number(e.target.value) }))}
              min={15}
              max={180}
              style={inputStyle}
            />
          </div>
          {/* Submit */}
          <TPrimaryButton
            onClick={handleSubmit}
            disabled={!form.name.trim() || submitting}
            style={{ width: '100%', padding: '13px 14px', fontSize: 14, minHeight: 48, marginTop: 4 }}
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(6,54,59,0.3)', borderTopColor: '#06363B' }} />
            ) : (
              <>
                <Plus size={16} />
                {t('trainerClasses.submitProposal', 'Submit Proposal')}
              </>
            )}
          </TPrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function TrainerClasses() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;
  const trainerId = profile?.id;
  const [activeTab, setActiveTab] = useState('myClasses');
  const [showProposeClass, setShowProposeClass] = useState(false);
  const dateLocale = i18n.language === 'es' ? es : enUS;

  useEffect(() => { document.title = t('trainerClasses.documentTitle'); }, [t]);

  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['trainer', 'my-classes', trainerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_classes')
        .select('*, gym_class_schedules(id, day_of_week, start_time, end_time, override_capacity)')
        .eq('trainer_id', trainerId)
        .eq('is_active', true)
        .order('name');
      if (error) logger.error('TrainerClasses: fetch error', error);

      // Resolve signed image URLs
      if (data) {
        for (const cls of data) {
          if (cls.image_url && cls.image_url.startsWith('class-images/')) {
            const { data: signedData } = await supabase.storage
              .from('class-images')
              .createSignedUrl(cls.image_url.replace('class-images/', ''), 3600);
            if (signedData?.signedUrl) cls.image_url = signedData.signedUrl;
          }
        }
      }

      return data || [];
    },
    enabled: !!trainerId,
    staleTime: 60 * 1000,
  });

  const tabKeys = {
    myClasses: 'tabMyClasses',
    bookings: 'tabBookings',
    analytics: 'tabAnalytics',
    templates: 'tabTemplates',
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%', paddingBottom: 100 }}>
      <div className="max-w-4xl mx-auto" style={{ padding: '14px 16px 24px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          gap: 14, marginBottom: 14,
        }}>
          <div>
            <TEyebrow>
              {t('trainerClasses.eyebrow', 'Classes · {{count}}', { count: classes.length })}
            </TEyebrow>
            <TPageTitle>{t('trainerClasses.title')}</TPageTitle>
          </div>
          <TDarkButton onClick={() => setShowProposeClass(true)}>
            <Plus size={14} strokeWidth={2.4} />
            <span className="hidden sm:inline">{t('trainerClasses.addClass', '+ Add class')}</span>
            <span className="sm:hidden">{t('trainerClasses.propose', 'Propose')}</span>
          </TDarkButton>
        </div>

        {/* Tab bar — sub-tab navigation */}
        <div style={{ marginBottom: 14 }}>
          <UnderlineTabs
            tabs={TABS.map(tab => ({ key: tab, label: t(`trainerClasses.${tabKeys[tab]}`) }))}
            activeIndex={TABS.indexOf(activeTab) >= 0 ? TABS.indexOf(activeTab) : 0}
            onChange={(i) => setActiveTab(TABS[i])}
          />
        </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton variant="list-item" />
          <Skeleton variant="list-item" />
          <Skeleton variant="list-item" />
        </div>
      )}

      {/* Tab content */}
      {!isLoading && activeTab === 'myClasses' && (
        <MyClassesTab classes={classes} gymId={gymId} t={t} tc={tc} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'bookings' && (
        <BookingsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'analytics' && (
        <AnalyticsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'templates' && (
        <TemplatesTab classes={classes} gymId={gymId} t={t} />
      )}

      {showProposeClass && (
        <ProposeClassModal
          gymId={gymId}
          trainerId={trainerId}
          onClose={() => setShowProposeClass(false)}
          t={t}
          tc={tc}
        />
      )}
      </div>
    </div>
  );
}
