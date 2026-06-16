import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, Users, Clock, Dumbbell, BarChart3, Star, Plus,
  Trash2, Search, Check, UserCheck, X, ChevronRight, ChevronLeft,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cacheGet, cacheSet, trainerKey } from '../../hooks/useTrainerCache';
import { useScrollLock } from '../../hooks/useScrollLock';
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
  width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box', minWidth: 0,
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

const TABS = ['myClasses', 'bookings', 'analytics', 'templates'];

// A booking row counts for rosters/analytics only when it's a real spot.
// Waitlisted rows render separately; cancelled rows never render (P1-6).
const isActiveBooking = (b) => b?.status === 'confirmed' || b?.status === 'attended';
const isWaitlisted = (b) => b?.status === 'waitlisted';
// Two half-synced attendance signals exist (trainer sets `attended`, member
// self-check-in sets status='attended') — treat either as attended.
const isAttended = (b) => b?.attended === true || b?.status === 'attended';

// ── Shared spinner ──
function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center">
      <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: TT.accent, borderTopColor: 'transparent' }} />
      <span style={{ fontSize: 12, color: TT.textMute }}>{label}</span>
    </div>
  );
}

// ── Safe-profile backfill ──
// RLS on profiles (migration 0289) only lets trainers read their assigned 1:1
// clients, so the embedded profiles(...) join comes back null for everyone else.
// Backfill names/avatars for those rows from the gym_member_profiles_safe view
// (migration 0289), which any same-gym user can read.
async function mergeSafeProfiles(rows) {
  const missingIds = [...new Set(
    rows.filter(r => !r.profiles && r.profile_id).map(r => r.profile_id),
  )];
  if (missingIds.length === 0) return rows;
  const { data: safeProfiles, error } = await supabase
    .from('gym_member_profiles_safe')
    .select('id, full_name, avatar_url')
    .in('id', missingIds);
  if (error) {
    logger.error('TrainerClasses: safe profiles fetch error', error);
    return rows;
  }
  const byId = {};
  for (const p of safeProfiles || []) byId[p.id] = p;
  return rows.map(r => (!r.profiles && byId[r.profile_id]) ? { ...r, profiles: byId[r.profile_id] } : r);
}

// ── Class Detail Drawer (for My Classes tab) ──
function ClassDetailDrawer({ cls, gymId, onClose, t, tc, dateLocale }) {
  useScrollLock(true);
  const [adding, setAdding] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Weekly slots first (by day/time), then one-off slots (by date) — P2-9:
  // specific_date slots used to be invisible here.
  const schedules = (cls.gym_class_schedules || [])
    .slice()
    .sort((a, b) => {
      const aOne = a.specific_date != null, bOne = b.specific_date != null;
      if (aOne !== bOne) return aOne ? 1 : -1;
      if (aOne) return a.specific_date.localeCompare(b.specific_date) || (a.start_time || '').localeCompare(b.start_time || '');
      return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || (a.start_time || '').localeCompare(b.start_time || '');
    });

  const slotLabel = (slot) => slot.specific_date
    ? format(new Date(`${slot.specific_date}T12:00:00`), 'd MMM yyyy', { locale: dateLocale })
    : tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey || '');

  const handleAddSlot = async () => {
    // Slot sanity: a class can't end before it starts.
    if (!newSlot.start_time || !newSlot.end_time || newSlot.end_time <= newSlot.start_time) {
      showToast(t('trainerClasses.errorEndAfterStart', 'End time must be after the start time'), 'error');
      return;
    }
    const { error } = await supabase.from('gym_class_schedules').insert({
      class_id: cls.id,
      gym_id: gymId,
      ...newSlot,
    });
    if (error) {
      logger.error('TrainerClasses: add slot error', error);
      showToast(t('trainerClasses.errorAddSlot', 'Could not add the slot'), 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
      setAdding(false);
      setNewSlot({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
    }
  };

  // Deleting a schedule slot cascades to its bookings (attendance + ratings),
  // so it always goes through the confirm dialog below.
  const [confirmDeleteSlot, setConfirmDeleteSlot] = useState(null);

  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId);
    setConfirmDeleteSlot(null);
    if (error) {
      logger.error('TrainerClasses: delete slot error', error);
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: TT.text, flexShrink: 0 }}>
                      {slotLabel(slot)}
                      {slot.specific_date && <TPill tone="teal" size="s">{t('trainerClasses.oneOff', 'One-off')}</TPill>}
                    </span>
                    <span style={{ fontFamily: TFont.mono, fontSize: 12, color: TT.textSub, flex: 1, textAlign: 'right', letterSpacing: -0.3 }}>
                      {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSlot(slot)}
                      aria-label={t('trainerClasses.deleteSlot', 'Delete slot')}
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

        {/* Delete-slot confirmation (bookings cascade with the slot) */}
        {confirmDeleteSlot && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteSlot(null)} />
            <div className="relative w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, boxShadow: TT.shadowLg }}>
              <h3 className="text-[16px] font-bold" style={{ color: TT.text }}>
                {t('trainerClasses.confirmDeleteSlot', 'Delete this schedule slot?')}
              </h3>
              <p className="text-[13px]" style={{ color: TT.textSub }}>
                <span style={{ display: 'block', fontWeight: 700, color: TT.text, marginBottom: 4 }}>
                  {slotLabel(confirmDeleteSlot)} · {confirmDeleteSlot.start_time?.slice(0, 5)} – {confirmDeleteSlot.end_time?.slice(0, 5)}
                </span>
                {t('trainerClasses.confirmDeleteSlotDescription', 'Bookings and attendance history for this slot will also be deleted. This cannot be undone.')}
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteSlot(null)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                  style={{ background: TT.surface2, color: TT.textSub, border: `1px solid ${TT.border}` }}
                >
                  {t('trainerClasses.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSlot(confirmDeleteSlot.id)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors min-h-[44px]"
                  style={{ background: TT.hotSoft, color: TT.hot }}
                >
                  {t('trainerClasses.deleteSlot', 'Delete slot')}
                </button>
              </div>
            </div>
          </div>
        )}
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

  // Explode classes into slot-instances grouped by weekday (recurring) and by
  // exact date (one-off `specific_date` slots — P2-9: these were invisible).
  const { slotsByDow, oneOffByDate } = useMemo(() => {
    const byDow = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const byDate = {};
    classes.forEach(cls => {
      (cls.gym_class_schedules || []).forEach(slot => {
        if (slot.specific_date) {
          (byDate[slot.specific_date] = byDate[slot.specific_date] || []).push({ cls, slot, oneOff: true });
          return;
        }
        if (slot.day_of_week == null || !byDow[slot.day_of_week]) return;
        byDow[slot.day_of_week].push({ cls, slot });
      });
    });
    const byTime = (a, b) => (a.slot.start_time || '').localeCompare(b.slot.start_time || '');
    Object.values(byDow).forEach(arr => arr.sort(byTime));
    Object.values(byDate).forEach(arr => arr.sort(byTime));
    return { slotsByDow: byDow, oneOffByDate: byDate };
  }, [classes]);

  const totalSlots = useMemo(
    () => Object.values(slotsByDow).reduce((n, a) => n + a.length, 0)
      + Object.values(oneOffByDate).reduce((n, a) => n + a.length, 0),
    [slotsByDow, oneOffByDate],
  );

  // Recurring + one-off entries for one concrete date, time-sorted.
  const entriesForDate = (date) => {
    const weekly = slotsByDow[date.getDay()] || [];
    const oneOffs = oneOffByDate[format(date, 'yyyy-MM-dd')] || [];
    return [...weekly, ...oneOffs]
      .sort((a, b) => (a.slot.start_time || '').localeCompare(b.slot.start_time || ''));
  };

  const SlotRow = ({ entry }) => {
    const { cls, slot, oneOff } = entry;
    const accent = cls.accent_color || TT.accent;
    return (
      <button type="button" onClick={() => setSelectedClass(cls)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 12, background: TT.surface, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, cursor: 'pointer', textAlign: 'left', marginBottom: 8 }}>
        <div style={{ width: 4, alignSelf: 'stretch', minHeight: 34, borderRadius: 999, background: accent, flexShrink: 0 }} />
        <div style={{ fontFamily: TFont.mono, fontSize: 12, fontWeight: 800, color: TT.text, width: 94, flexShrink: 0, letterSpacing: -0.3 }}>
          {slot.start_time?.slice(0, 5)}<span style={{ color: TT.textMute }}>–{slot.end_time?.slice(0, 5)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cls.name}</span>
            {oneOff && <TPill tone="teal" size="s">{t('trainerClasses.oneOff', 'One-off')}</TPill>}
          </div>
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
    const entries = entriesForDate(dayDate);
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

  // ── Week view (Mon-first agenda; current week, so one-off dates land) ──
  const renderWeek = () => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return (
      <div>
        {[0, 1, 2, 3, 4, 5, 6].map(offset => {
          const date = addDays(weekStart, offset);
          const dow = date.getDay();
          const entries = entriesForDate(date);
          const isToday = dow === todayDow;
          return (
            <div key={offset} style={{ marginBottom: 14 }}>
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
  };

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
              const count = entriesForDate(d).length;
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
        <ClassDetailDrawer cls={selectedClass} gymId={gymId} onClose={() => setSelectedClass(null)} t={t} tc={tc} dateLocale={dateLocale} />
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

  const { data: bookings = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['trainer', 'all-class-bookings', rangeStartStr, rangeEndStr, classIds],
    queryFn: async () => {
      if (classIds.length === 0) return [];
      const { data, error } = await supabase
        .from('gym_class_bookings')
        .select('id, status, attended, booking_date, waitlist_position, class_id, profile_id, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .gte('booking_date', rangeStartStr)
        .lte('booking_date', rangeEndStr)
        .order('booking_date');
      if (error) {
        logger.error('TrainerClasses: bookings fetch error', error);
        throw error;
      }
      return mergeSafeProfiles(data || []);
    },
    enabled: classIds.length > 0,
    staleTime: 30 * 1000,
  });

  // Marking also sets status='attended' so the trainer mark and the member
  // self-check-in signal stay consistent (they were two half-synced flags).
  const handleMarkAttended = async (bookingId) => {
    const { error } = await supabase
      .from('gym_class_bookings')
      .update({ attended: true, attended_at: new Date().toISOString(), status: 'attended' })
      .eq('id', bookingId);
    if (error) {
      logger.error('TrainerClasses: mark attended error', error);
      showToast(t('trainerClasses.errorMarkAttended', 'Could not mark attendance'), 'error');
    } else {
      posthog?.capture('trainer_class_attendance_marked');
      queryClient.invalidateQueries({ queryKey: ['trainer', 'all-class-bookings'] });
    }
  };

  // Un-mark (mis-taps happen): back to a plain confirmed booking.
  const handleUnmarkAttended = async (bookingId) => {
    const { error } = await supabase
      .from('gym_class_bookings')
      .update({ attended: false, attended_at: null, status: 'confirmed' })
      .eq('id', bookingId);
    if (error) {
      logger.error('TrainerClasses: unmark attended error', error);
      showToast(t('trainerClasses.errorMarkAttended', 'Could not mark attendance'), 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'all-class-bookings'] });
    }
  };

  // Promote a waitlisted member into the class.
  const handlePromote = async (bookingId) => {
    const { error } = await supabase
      .from('gym_class_bookings')
      .update({ status: 'confirmed', waitlist_position: null, promoted_at: new Date().toISOString() })
      .eq('id', bookingId);
    if (error) {
      logger.error('TrainerClasses: promote waitlist error', error);
      showToast(t('trainerClasses.errorPromote', 'Could not confirm this member'), 'error');
    } else {
      posthog?.capture('trainer_class_waitlist_promoted');
      showToast(t('trainerClasses.promoted', 'Member confirmed'), 'success');
      queryClient.invalidateQueries({ queryKey: ['trainer', 'all-class-bookings'] });
    }
  };

  const classMap = {};
  for (const c of classes) classMap[c.id] = c;

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // P1-6: cancelled bookings NEVER render; waitlisted rows live in their own
  // group; only confirmed/attended count for rosters and day/week/month totals.
  const { activeByDate, waitlistByDate } = useMemo(() => {
    const act = {}, wait = {};
    for (const b of bookings) {
      if (isActiveBooking(b)) (act[b.booking_date] = act[b.booking_date] || []).push(b);
      else if (isWaitlisted(b)) (wait[b.booking_date] = wait[b.booking_date] || []).push(b);
    }
    return { activeByDate: act, waitlistByDate: wait };
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

  // One member row (active roster or waitlist).
  const BookingRow = ({ b, isFuture, waitlisted }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: TT.surface, borderRadius: 12, border: `1px solid ${TT.border}`, boxShadow: TT.shadow, overflow: 'hidden' }}>
      {b.profiles?.avatar_url ? (
        <img src={b.profiles.avatar_url} alt={b.profiles?.full_name || t('trainerClasses.members')} style={{ width: 32, height: 32, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', flexShrink: 0, background: TT.accentSoft }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: TT.accentInk }}>{b.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
        </div>
      )}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.profiles?.full_name || t('trainerClasses.unknown')}</span>
      {waitlisted ? (
        <button
          type="button"
          onClick={() => handlePromote(b.id)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: TT.accentInk, background: TT.accentSoft, padding: '7px 11px', borderRadius: 999, border: 'none', cursor: 'pointer', minHeight: 44, whiteSpace: 'nowrap' }}
          className="sm:!min-h-[32px]"
        >
          <Check size={11} /> {t('trainerClasses.promote', 'Confirm')}
        </button>
      ) : isAttended(b) ? (
        // Tappable to undo a mis-tap.
        <button
          type="button"
          onClick={() => handleUnmarkAttended(b.id)}
          title={t('trainerClasses.unmarkAttended', 'Tap to unmark')}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          <TPill tone="good" size="m"><Check size={11} /> {t('trainerClasses.attended')}</TPill>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => handleMarkAttended(b.id)}
          disabled={isFuture}
          title={isFuture ? t('trainerClasses.futureAttendance', 'You can mark attendance once the day arrives') : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: TT.accentInk, background: TT.accentSoft, padding: '7px 11px', borderRadius: 999, border: 'none', cursor: isFuture ? 'not-allowed' : 'pointer', opacity: isFuture ? 0.45 : 1, minHeight: 44, whiteSpace: 'nowrap' }}
          className="sm:!min-h-[32px]"
        >
          <UserCheck size={11} /> {t('trainerClasses.markAttended')}
        </button>
      )}
    </div>
  );

  // Bookings for one date, grouped by class: active roster + waitlist group.
  const renderDayBookings = (dateStr) => {
    const dayActive = activeByDate[dateStr] || [];
    const dayWaitlist = waitlistByDate[dateStr] || [];
    const isFuture = dateStr > todayStr;
    const grouped = {};
    for (const b of dayActive) (grouped[b.class_id] = grouped[b.class_id] || { active: [], waitlist: [] }).active.push(b);
    for (const b of dayWaitlist) (grouped[b.class_id] = grouped[b.class_id] || { active: [], waitlist: [] }).waitlist.push(b);
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
        {Object.entries(grouped).map(([classId, { active, waitlist }]) => {
          const cls = classMap[classId];
          const accentColor = cls?.accent_color || TT.accent;
          const sortedWaitlist = waitlist.slice().sort((a, b) => (a.waitlist_position ?? 999) - (b.waitlist_position ?? 999));
          return (
            <div key={classId}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, background: accentColor + '20' }}>
                  <CalendarDays size={12} style={{ color: accentColor }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{cls?.name || t('trainerClasses.unknown')}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: TT.textMute, marginLeft: 'auto' }}>{active.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {active.map(b => <BookingRow key={b.id} b={b} isFuture={isFuture} />)}
                {sortedWaitlist.length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 0', paddingLeft: 2 }}>
                      <TPill tone="warn" size="s">
                        {t('trainerClasses.waitlist', 'Waitlist')} ({sortedWaitlist.length})
                      </TPill>
                    </div>
                    {sortedWaitlist.map(b => <BookingRow key={b.id} b={b} waitlisted />)}
                  </>
                )}
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
          const dayB = activeByDate[dayStr] || [];
          const waitN = (waitlistByDate[dayStr] || []).length;
          const attended = dayB.filter(isAttended).length;
          const isToday = isSameDay(day, new Date());
          return (
            <button key={dayStr} type="button" onClick={() => { setAnchorDate(startOfDay(day)); setView('day'); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: TT.surface, border: `1px solid ${isToday ? TT.accent : TT.border}`, boxShadow: TT.shadow, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 42, flexShrink: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: isToday ? TT.accent : TT.textMute, textTransform: 'uppercase' }}>{format(day, 'EEE', { locale: dateLocale })}</div>
                <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, letterSpacing: -0.4, lineHeight: 1 }}>{format(day, 'd')}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {dayB.length === 0 && waitN === 0 ? (
                  <span style={{ fontSize: 12.5, color: TT.textMute }}>{t('trainerClasses.free', 'Free')}</span>
                ) : (
                  <span style={{ fontSize: 12.5, color: TT.text, fontWeight: 600 }}>
                    {t('trainerClasses.weekDaySummary', '{{n}} booked · {{a}} attended', { n: dayB.length, a: attended })}
                    {waitN > 0 && (
                      <span style={{ color: TT.warnInk, fontWeight: 700 }}>
                        {' · '}{t('trainerClasses.waitlistShort', '{{n}} waitlisted', { n: waitN })}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {(dayB.length > 0 || waitN > 0) && <ChevronRight size={14} color={TT.textMute} style={{ flexShrink: 0 }} />}
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
            const count = (activeByDate[format(d, 'yyyy-MM-dd')] || []).length;
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
      ) : isError ? (
        <TrainerEmptyState
          icon={Users}
          title={t('trainerClasses.bookingsLoadError', 'Could not load bookings')}
          description={t('trainerClasses.bookingsLoadErrorDesc', 'Something went wrong. Check your connection and try again.')}
          actionLabel={t('trainerClasses.retry', 'Retry')}
          onAction={() => refetch()}
          compact
        />
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

  const { data: analytics, isLoading, isError, refetch } = useQuery({
    queryKey: ['trainer', 'class-analytics', selectedClassId],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();

      const { data: allBookings, error: bookingsError } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating, status')
        .eq('class_id', selectedClassId)
        .gte('booked_at', since);
      if (bookingsError) {
        logger.error('TrainerClasses: analytics fetch error', bookingsError);
        throw bookingsError; // real retry state instead of fake "No data yet"
      }

      // P1-6: cancelled/waitlisted rows must not deflate the attendance rate —
      // only real spots (confirmed/attended) count in the denominator.
      const bookings = (allBookings || []).filter(isActiveBooking);
      const total = bookings.length;
      const attended = bookings.filter(isAttended).length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      const rated = bookings.filter(b => b.rating != null && isAttended(b));
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
        const { data: resultBookings, error: resultsError } = await supabase
          .from('gym_class_bookings')
          .select('profile_id, rating, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
          .eq('class_id', selectedClassId)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        if (resultsError) logger.error('TrainerClasses: recent results fetch error', resultsError);
        recentResults = await mergeSafeProfiles(resultBookings || []);
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
      ) : isError ? (
        <TrainerEmptyState
          icon={BarChart3}
          title={t('trainerClasses.analyticsLoadError', 'Could not load analytics')}
          description={t('trainerClasses.bookingsLoadErrorDesc', 'Something went wrong. Check your connection and try again.')}
          actionLabel={t('trainerClasses.retry', 'Retry')}
          onAction={() => refetch()}
          compact
        />
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
  // "Change" opens the picker without dropping the current template first
  // (it used to be a duplicate of "Remove" — both called onChange(null)).
  const [changing, setChanging] = useState(false);
  useEffect(() => { setChanging(false); setSearch(''); }, [value]);

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
      {selected && !changing ? (
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
              onClick={() => setChanging(true)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: TT.textMute }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('trainerClasses.changeTemplate')}
                autoFocus={changing}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
            {changing && (
              <button
                type="button"
                onClick={() => { setChanging(false); setSearch(''); }}
                style={{ fontSize: 11, fontWeight: 700, color: TT.textSub, background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 44, padding: '0 8px', flexShrink: 0 }}
              >
                {t('trainerClasses.cancel')}
              </button>
            )}
          </div>
          {search && filtered.length > 0 && (
            <div style={{ maxHeight: 192, overflowY: 'auto', borderRadius: 12, border: `1px solid ${TT.border}`, background: TT.surface }}>
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); setChanging(false); }}
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
  useScrollLock(true);
  const [form, setForm] = useState({ name: '', description: '', day_of_week: 1, start_time: '09:00', duration: 60 });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const details = {
        class_name: form.name.trim(),
        description: form.description.trim(),
        suggested_day: form.day_of_week,
        suggested_time: form.start_time,
        duration_minutes: Number(form.duration) || 60,
      };
      const { error } = await supabase.rpc('log_admin_action', {
        p_action: 'class_proposal',
        p_entity_type: 'class',
        p_entity_id: null,
        p_details: details,
      });
      if (error) throw error;

      // P2-10: the audit log alone was a write-only black hole — also ping
      // every gym admin (in-app + push, migration 0535). Tolerate the RPC
      // not existing yet so the proposal flow never breaks pre-migration.
      const { error: notifyError } = await supabase.rpc('notify_class_proposal', {
        p_class_name: form.name.trim(),
        p_details: details,
      });
      if (notifyError) logger.error('ProposeClass: admin notify failed (tolerated)', notifyError);

      posthog?.capture('trainer_class_proposed');
      showToast(t('trainerClasses.proposalSent', 'Proposal sent to admin'), 'success');
      onClose();
    } catch (err) {
      logger.error('ProposeClass: error', err);
      showToast(t('trainerClasses.errorProposal', 'Could not send the proposal'), 'error');
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
            <div className="min-w-0">
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
            <div className="min-w-0">
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
              inputMode="numeric"
              value={form.duration}
              onChange={e => {
                // Keep the raw value while editing (empty string allowed) so the
                // field can be cleared and retyped. Binding straight to Number()
                // snapped an empty field to 0 and made "4" → typing 5 become "45".
                const v = e.target.value;
                setForm(s => ({ ...s, duration: v === '' ? '' : Number(v) }));
              }}
              onBlur={e => {
                // Clamp to the valid range on blur; restore a sane default if empty.
                const n = Number(e.target.value);
                setForm(s => ({ ...s, duration: Number.isFinite(n) && n > 0 ? Math.min(180, Math.max(15, n)) : 60 }));
              }}
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

  const CLASS_SELECT = '*, gym_class_schedules(id, day_of_week, specific_date, start_time, end_time, override_capacity)';

  // Instant-load cache: seed the assigned-classes list from the last visit so a
  // revisit renders immediately (no skeleton) and then revalidates in the
  // background. initialDataUpdatedAt:0 keeps it stale so the fetch still runs.
  const CK_classes = trainerKey('classes', trainerId);

  const { data: classes = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['trainer', 'my-classes', trainerId],
    queryFn: async () => {
      // P1-7: the admin assigns co-trainers via the gym_class_trainers
      // junction (source of truth per 0379) — load those class ids too and
      // union with the legacy trainer_id-owned set. Junction errors are
      // tolerated so the owned path still works pre-0535.
      let junctionIds = [];
      const { data: jRows, error: jErr } = await supabase
        .from('gym_class_trainers')
        .select('class_id')
        .eq('trainer_id', trainerId);
      if (jErr) logger.error('TrainerClasses: junction fetch error', jErr);
      else junctionIds = [...new Set((jRows || []).map(r => r.class_id))];

      const { data: owned, error } = await supabase
        .from('gym_classes')
        .select(CLASS_SELECT)
        .eq('trainer_id', trainerId)
        .eq('is_active', true)
        .order('name');
      if (error) {
        logger.error('TrainerClasses: fetch error', error);
        throw error; // surfaces the retry state below instead of a fake "No classes"
      }

      const ownedIds = new Set((owned || []).map(c => c.id));
      const extraIds = junctionIds.filter(id => !ownedIds.has(id));
      let viaJunction = [];
      if (extraIds.length > 0) {
        const { data: jClasses, error: jcErr } = await supabase
          .from('gym_classes')
          .select(CLASS_SELECT)
          .in('id', extraIds)
          .eq('is_active', true);
        // Pre-0535 RLS may hide these rows — degrade to owned-only.
        if (jcErr) logger.error('TrainerClasses: junction classes fetch error', jcErr);
        else viaJunction = jClasses || [];
      }

      const data = [...(owned || []), ...viaJunction]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Resolve signed image URLs
      for (const cls of data) {
        if (cls.image_url && cls.image_url.startsWith('class-images/')) {
          const { data: signedData } = await supabase.storage
            .from('class-images')
            .createSignedUrl(cls.image_url.replace('class-images/', ''), 3600);
          if (signedData?.signedUrl) cls.image_url = signedData.signedUrl;
        }
      }

      cacheSet(CK_classes, data); // write-through for instant load next visit
      return data;
    },
    enabled: !!trainerId,
    staleTime: 60 * 1000,
    // Paint instantly from the last-visit cache, but mark it stale (updatedAt:0)
    // so the queryFn still revalidates in the background on mount.
    initialData: () => cacheGet(CK_classes),
    initialDataUpdatedAt: 0,
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

      {/* Load error → honest retry instead of a fake "No classes assigned" */}
      {!isLoading && isError && (
        <TrainerEmptyState
          icon={CalendarDays}
          title={t('trainerClasses.classesLoadError', 'Could not load your classes')}
          description={t('trainerClasses.classesLoadErrorDesc', 'Something went wrong. Check your connection and try again.')}
          actionLabel={t('trainerClasses.retry', 'Retry')}
          onAction={() => refetch()}
        />
      )}

      {/* Tab content */}
      {!isLoading && !isError && activeTab === 'myClasses' && (
        <MyClassesTab classes={classes} gymId={gymId} t={t} tc={tc} dateLocale={dateLocale} />
      )}
      {!isLoading && !isError && activeTab === 'bookings' && (
        <BookingsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && !isError && activeTab === 'analytics' && (
        <AnalyticsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && !isError && activeTab === 'templates' && (
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
