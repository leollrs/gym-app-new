import { useEffect, useState, useMemo, useCallback } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, CalendarDays, Clock, Check, XCircle, AlertTriangle, Trash2, Bell, BellOff, Repeat } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek, addDays,
  isSameDay, isToday, isBefore, setHours, setMinutes, subHours,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, addMonths,
} from 'date-fns';
import { useTranslation } from 'react-i18next';
import UnderlineTabs from '../../components/UnderlineTabs';
import PageHeader from '../../components/PageHeader';
import logger from '../../lib/logger';

const STATUS_COLORS_BASE = {
  scheduled: { bg: 'bg-blue-500/12', text: 'text-blue-400', key: 'statusScheduled' },
  confirmed: { bg: 'bg-[var(--color-accent)]/12', text: 'text-[var(--color-accent)]', key: 'statusConfirmed' },
  completed: { bg: 'bg-emerald-500/12', text: 'text-emerald-400', key: 'statusCompleted' },
  cancelled: { bg: 'bg-red-500/12', text: 'text-red-400', key: 'statusCancelled' },
  no_show:   { bg: 'bg-amber-500/12', text: 'text-amber-400', key: 'statusNoShow' },
};

// Inline status colors for month view session pills (not Tailwind classes)
const STATUS_BG = {
  scheduled:  { bg: 'rgba(59,130,246,0.15)', text: '#3B82F6' },
  confirmed:  { bg: 'var(--color-accent-glow)', text: 'var(--color-accent)' },
  completed:  { bg: 'rgba(16,185,129,0.15)', text: '#10B981' },
  cancelled:  { bg: 'rgba(239,68,68,0.15)', text: '#EF4444' },
  no_show:    { bg: 'rgba(245,158,11,0.15)', text: '#F59E0B' },
};

const DURATIONS = [30, 45, 60, 90, 120];

const VIEW_MODES = ['day', 'week', 'month'];

// ── Session Modal ─────────────────────────────────────────────────────────
const SessionModal = ({ session, clients, date, onClose, onSaved, trainerId, gymId, trainerName }) => {
  const { showToast } = useToast();
  const { t } = useTranslation(['pages', 'common']);
  const isEdit = !!session;
  const STATUS_COLORS = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(STATUS_COLORS_BASE)) {
      out[k] = { bg: v.bg, text: v.text, label: t(`pages:trainerCalendar.${v.key}`) };
    }
    return out;
  }, [t]);
  const [clientId, setClientId] = useState(session?.client_id || '');
  const [title, setTitle]       = useState(session?.title || t('pages:trainerCalendar.titlePlaceholder'));
  const [notes, setNotes]       = useState(session?.notes || '');
  const [dateVal, setDateVal]   = useState(
    session ? format(new Date(session.scheduled_at), 'yyyy-MM-dd') : format(date || new Date(), 'yyyy-MM-dd')
  );
  const [timeVal, setTimeVal]   = useState(
    session ? format(new Date(session.scheduled_at), 'HH:mm') : '09:00'
  );
  const [duration, setDuration] = useState(session?.duration_mins || 60);
  const [status, setStatus]     = useState(session?.status || 'scheduled');
  const [sendReminder, setSendReminder] = useState(session?.send_reminder ?? true);
  const [recurring, setRecurring]       = useState(false);
  const [frequency, setFrequency]       = useState('weekly'); // 'weekly' | 'biweekly'
  const defaultEndDate = format(addWeeks(new Date(), 8), 'yyyy-MM-dd');
  const [endDate, setEndDate]           = useState(defaultEndDate);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]       = useState('');

  const handleSave = async () => {
    if (!clientId) { const msg = t('pages:trainerCalendar.selectClientError'); setError(msg); showToast(msg, 'error'); return; }
    setSaving(true);
    setError('');

    const scheduledAt = new Date(`${dateVal}T${timeVal}`).toISOString();
    const insertPayload = {
      gym_id: gymId,
      trainer_id: trainerId,
      client_id: clientId,
      title: title.trim() || t('pages:trainerCalendar.titlePlaceholder'),
      notes: notes.trim() || null,
      scheduled_at: scheduledAt,
      duration_mins: Math.max(1, Math.round(duration)),
      status,
      send_reminder: sendReminder,
      updated_at: new Date().toISOString(),
    };

    // Whitelist fields for update — never send gym_id/trainer_id on update
    const updatePayload = {
      client_id: clientId,
      title: title.trim() || t('pages:trainerCalendar.titlePlaceholder'),
      notes: notes.trim() || null,
      scheduled_at: scheduledAt,
      duration_mins: Math.max(1, Math.round(duration)),
      status,
      send_reminder: sendReminder,
      updated_at: new Date().toISOString(),
    };

    // ── Recurring session support ─────────────────────────────────────────
    if (!isEdit && recurring) {
      const recurrenceGroup = crypto.randomUUID();
      const step = frequency === 'biweekly' ? 2 : 1;
      const baseDate = new Date(`${dateVal}T${timeVal}`);
      const endLimit = endDate ? new Date(`${endDate}T23:59:59`) : addWeeks(baseDate, 8);
      const rows = [];
      let cursor = baseDate;
      while (cursor <= endLimit) {
        rows.push({
          ...insertPayload,
          scheduled_at: cursor.toISOString(),
          recurrence_group: recurrenceGroup,
        });
        cursor = addWeeks(cursor, step);
      }
      const { error: err } = await supabase.from('trainer_sessions').insert(rows);
      if (err) { setError(err.message); setSaving(false); showToast(err.message, 'error'); return; }
    } else {
      const { error: err } = isEdit
        ? await supabase.from('trainer_sessions').update(updatePayload).eq('id', session.id)
        : await supabase.from('trainer_sessions').insert(insertPayload);
      if (err) { setError(err.message); setSaving(false); showToast(err.message, 'error'); return; }
    }

    // Schedule session reminder notification (1 hour before)
    if (sendReminder && clientId && status !== 'cancelled') {
      const sessionTime = new Date(`${dateVal}T${timeVal}`);
      const reminderTime = subHours(sessionTime, 1);
      // Only schedule if reminder time is in the future
      if (reminderTime > new Date()) {
        const timeStr = format(sessionTime, 'h:mm a');
        const { error: notifErr } = await supabase.from('notifications').upsert({
          profile_id: clientId,
          gym_id: gymId,
          type: 'session_reminder',
          title: t('pages:trainerCalendar.upcomingSession'),
          body: t('pages:trainerCalendar.sessionReminderBody', {
            trainer: trainerName || t('pages:trainerCalendar.yourTrainer'),
            time: timeStr,
          }),
          scheduled_at: reminderTime.toISOString(),
          created_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        if (notifErr) logger.error('SessionModal: failed to schedule reminder:', notifErr);
      }
    }

    if (!isEdit && recurring) {
      const step = frequency === 'biweekly' ? 2 : 1;
      const baseDate = new Date(`${dateVal}T${timeVal}`);
      const endLimit = endDate ? new Date(`${endDate}T23:59:59`) : addWeeks(baseDate, 8);
      let count = 0;
      let cur = baseDate;
      while (cur <= endLimit) { count++; cur = addWeeks(cur, step); }
      showToast(t('pages:trainerCalendar.recurringSessionsCreated', { count }), 'success');
    } else {
      showToast(isEdit ? t('pages:trainerCalendar.sessionUpdated') : t('pages:trainerCalendar.sessionScheduled'), 'success');
    }
    onSaved();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await supabase.from('trainer_sessions').delete().eq('id', session.id);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="session-modal-title" className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-t-2xl md:rounded-2xl w-full max-w-none md:max-w-xl max-h-[92vh] md:max-h-[88vh] flex flex-col overflow-hidden md:mx-4 pb-[env(safe-area-inset-bottom)]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border-subtle)] flex-shrink-0">
          <p id="session-modal-title" className="text-[16px] font-bold text-[var(--color-text-primary)]">{isEdit ? t('pages:trainerCalendar.editSession') : t('pages:trainerCalendar.newSession')}</p>
          <button onClick={onClose} aria-label="Close dialog"><X size={20} className="text-[var(--color-text-muted)]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Client */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.clientLabel')}</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none">
              <option value="">{t('pages:trainerCalendar.selectClient')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.titleLabel')}</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('pages:trainerCalendar.titlePlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.dateLabel')}</label>
              <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)}
                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.timeLabel')}</label>
              <input type="time" value={timeVal} onChange={e => setTimeVal(e.target.value)}
                className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.durationLabel')}</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setDuration(d)}
                  className={`min-h-[44px] py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                    duration === d ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]'
                  }`}>
                  {d}m
                </button>
              ))}
            </div>
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.statusLabel')}</label>
              <div className="grid grid-cols-3 sm:flex gap-1.5">
                {Object.entries(STATUS_COLORS).map(([key, val]) => (
                  <button key={key} onClick={() => setStatus(key)}
                    className={`px-3 py-1.5 min-h-[36px] rounded-lg text-[11px] font-semibold transition-colors ${
                      status === key ? `${val.bg} ${val.text}` : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]'
                    }`}>
                    {val.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Send Reminder toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              {sendReminder ? <Bell size={14} className="text-[var(--color-accent)]" /> : <BellOff size={14} className="text-[var(--color-text-muted)]" />}
              <div>
                <p className="text-[12px] font-medium text-[var(--color-text-secondary)]">{t('pages:trainerCalendar.sendReminder')}</p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{t('pages:trainerCalendar.reminderHint')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSendReminder(!sendReminder)}
              className={`relative w-10 h-[22px] rounded-full transition-colors ${sendReminder ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
              aria-label="Toggle send reminder"
            >
              <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${sendReminder ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Recurring toggle (new sessions only) */}
          {!isEdit && (
            <>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Repeat size={14} className={recurring ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'} />
                  <div>
                    <p className="text-[12px] font-medium text-[var(--color-text-secondary)]">{t('pages:trainerCalendar.recurring')}</p>
                    <p className="text-[10px] text-[var(--color-text-muted)]">{t('pages:trainerCalendar.recurringHint')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRecurring(!recurring)}
                  className={`relative w-10 h-[22px] rounded-full transition-colors ${recurring ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
                  aria-label="Toggle recurring"
                >
                  <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${recurring ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {recurring && (
                <div className="space-y-3 pl-6 border-l-2 border-[var(--color-accent)]/20 ml-1.5">
                  {/* Frequency pills */}
                  <div>
                    <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.frequencyLabel')}</label>
                    <div className="flex gap-2">
                      {['weekly', 'biweekly'].map(f => (
                        <button key={f} onClick={() => setFrequency(f)}
                          className={`flex-1 min-h-[44px] py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                            frequency === f ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]'
                          }`}>
                          {t(`pages:trainerCalendar.frequency_${f}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* End date */}
                  <div>
                    <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.endDateLabel')}</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none" />
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{t('pages:trainerCalendar.endDateHint')}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)] mb-1.5">{t('pages:trainerCalendar.notesLabel')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder={t('pages:trainerCalendar.notesPlaceholder')}
              className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)]/40 resize-none" />
          </div>

          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 p-4 pb-6 sm:pb-4 md:p-5 border-t border-[var(--color-border-subtle)] flex-shrink-0">
          {isEdit && (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[var(--color-text-secondary)]">{t('pages:trainerCalendar.deleteSessionConfirm')}</span>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg text-[12px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                  {deleting ? t('pages:trainerCalendar.deleting') : t('pages:trainerCalendar.confirm')}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg text-[12px] font-semibold bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10 transition-colors">
                  {t('pages:trainerCalendar.cancel')}
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors">
                <Trash2 size={14} /> {t('pages:trainerCalendar.delete')}
              </button>
            )
          )}
          <div className="hidden sm:block flex-1" />
          <button onClick={onClose}
            className="px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors order-last sm:order-none">
            {t('pages:trainerCalendar.cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-[13px] font-bold bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-black transition-colors disabled:opacity-50">
            {saving ? t('pages:trainerCalendar.saving') : isEdit ? t('pages:trainerCalendar.update') : t('pages:trainerCalendar.create')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerSchedule() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const STATUS_COLORS = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(STATUS_COLORS_BASE)) {
      out[k] = { bg: v.bg, text: v.text, label: t(`trainerCalendar.${v.key}`) };
    }
    return out;
  }, [t]);

  const [viewMode, setViewMode] = useState('week'); // 'day' | 'week' | 'month'
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { session?, date? }

  // ── Derived dates ────────────────────────────────────────────────────────
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const selectedDay = addDays(new Date(), dayOffset);

  const monthAnchor = addMonths(new Date(), monthOffset);
  const monthStart = startOfMonth(monthAnchor);
  const monthEnd = endOfMonth(monthAnchor);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Pad start: days from previous month to fill first row (Mon = 1 start)
  const firstDayOfWeek = getDay(monthStart); // 0=Sun
  const startPad = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Mon-based
  const paddedMonthDays = useMemo(() => {
    const padBefore = Array.from({ length: startPad }, (_, i) => addDays(monthStart, -(startPad - i)));
    const totalCells = padBefore.length + monthDays.length;
    const endPad = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    const padAfter = Array.from({ length: endPad }, (_, i) => addDays(monthEnd, i + 1));
    return [...padBefore, ...monthDays, ...padAfter];
  }, [monthStart.getTime(), monthEnd.getTime(), startPad]);

  const DAY_NAMES = [
    t('trainerCalendar.dayNames.mon'),
    t('trainerCalendar.dayNames.tue'),
    t('trainerCalendar.dayNames.wed'),
    t('trainerCalendar.dayNames.thu'),
    t('trainerCalendar.dayNames.fri'),
    t('trainerCalendar.dayNames.sat'),
    t('trainerCalendar.dayNames.sun'),
  ];

  // ── View tab config ──────────────────────────────────────────────────────
  const viewTabs = [
    { key: 'day', label: t('trainerCalendar.day', 'Day') },
    { key: 'week', label: t('trainerCalendar.week', 'Week') },
    { key: 'month', label: t('trainerCalendar.month', 'Month') },
  ];
  const viewTabIndex = VIEW_MODES.indexOf(viewMode);

  useEffect(() => { document.title = 'Trainer - Calendar | TuGymPR'; }, []);

  useEffect(() => {
    if (!profile?.id) return;
    loadClients();
  }, [profile?.id]);

  // ── Fetch range depends on viewMode ──────────────────────────────────────
  const fetchRange = useMemo(() => {
    if (viewMode === 'day') {
      return { start: selectedDay, end: selectedDay };
    }
    if (viewMode === 'month') {
      // Fetch the full padded range so dots show for overflow days too
      return { start: paddedMonthDays[0], end: paddedMonthDays[paddedMonthDays.length - 1] };
    }
    // week (default)
    return { start: weekStart, end: weekEnd };
  }, [viewMode, weekOffset, dayOffset, monthOffset]);

  useEffect(() => {
    if (!profile?.id) return;
    loadSessions();
  }, [profile?.id, viewMode, weekOffset, dayOffset, monthOffset]);

  const loadClients = async () => {
    const { data } = await supabase
      .from('trainer_clients')
      .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name)')
      .eq('trainer_id', profile.id)
      .eq('is_active', true);
    setClients((data || []).map(tc => tc.profiles).filter(Boolean));
  };

  const loadSessions = async () => {
    setLoading(true);
    const { start, end } = fetchRange;
    const { data } = await supabase
      .from('trainer_sessions')
      .select('*, profiles!trainer_sessions_client_id_fkey(full_name)')
      .eq('trainer_id', profile.id)
      .gte('scheduled_at', new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0)).toISOString())
      .lte('scheduled_at', new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)).toISOString())
      .order('scheduled_at', { ascending: true });
    setSessions(data || []);
    setLoading(false);
  };

  const handleSaved = () => {
    setModal(null);
    loadSessions();
  };

  // ── Today handler ────────────────────────────────────────────────────────
  const handleToday = useCallback(() => {
    if (viewMode === 'day') setDayOffset(0);
    else if (viewMode === 'week') setWeekOffset(0);
    else setMonthOffset(0);
  }, [viewMode]);

  const isAtToday = (viewMode === 'day' && dayOffset === 0)
    || (viewMode === 'week' && weekOffset === 0)
    || (viewMode === 'month' && monthOffset === 0);

  // ── Group sessions by day (shared) ───────────────────────────────────────
  const sessionsByDay = useMemo(() => {
    const map = {};
    sessions.forEach(s => {
      const key = format(new Date(s.scheduled_at), 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [sessions]);

  // ── Week view: sessions grouped by the 7 week days ──────────────────────
  const weekSessionsByDay = useMemo(() => {
    const map = {};
    days.forEach(d => { map[format(d, 'yyyy-MM-dd')] = []; });
    sessions.forEach(s => {
      const key = format(new Date(s.scheduled_at), 'yyyy-MM-dd');
      if (map[key]) map[key].push(s);
    });
    return map;
  }, [sessions, weekStart]);

  // Today's remaining sessions (week view)
  const todaySessions = useMemo(() => {
    const now = new Date();
    return sessions
      .filter(s => isSameDay(new Date(s.scheduled_at), now) && !['cancelled'].includes(s.status))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }, [sessions]);

  // ── Day view: sessions for selected day ─────────────────────────────────
  const dayViewSessions = useMemo(() => {
    const key = format(selectedDay, 'yyyy-MM-dd');
    return (sessionsByDay[key] || []).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }, [sessionsByDay, dayOffset]);

  // ── Labels ──────────────────────────────────────────────────────────────
  const weekLabel = `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
  const dayLabel = format(selectedDay, 'EEEE, MMM d, yyyy');
  const monthLabel = format(monthAnchor, 'MMMM yyyy');

  const subLabel = viewMode === 'day' ? dayLabel : viewMode === 'month' ? monthLabel : weekLabel;

  // ── Handle view tab change ──────────────────────────────────────────────
  const handleViewChange = (idx) => {
    setViewMode(VIEW_MODES[idx]);
  };

  // ── Month view: tap a day to go to day view ─────────────────────────────
  const handleMonthDayClick = (day) => {
    const today = new Date();
    const diff = Math.round((day.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / (1000 * 60 * 60 * 24));
    setDayOffset(diff);
    setViewMode('day');
  };

  // ── Navigation handlers ──────────────────────────────────────────────
  const handlePrev = () => {
    if (viewMode === 'day') setDayOffset(d => d - 1);
    else if (viewMode === 'week') setWeekOffset(w => w - 1);
    else setMonthOffset(m => m - 1);
  };
  const handleNext = () => {
    if (viewMode === 'day') setDayOffset(d => d + 1);
    else if (viewMode === 'week') setWeekOffset(w => w + 1);
    else setMonthOffset(m => m + 1);
  };

  return (
    <div className="min-h-screen pb-28 md:pb-12 overflow-x-hidden" style={{ background: 'var(--color-bg-primary)' }}>
      {/* ── Sticky PageHeader with tabs (Community pattern) ──────────── */}
      <PageHeader title={t('trainerCalendar.title', 'Calendar')} accentLabel={t('trainerCalendar.accentLabel', 'Schedule')}>
        <UnderlineTabs
          tabs={viewTabs}
          activeIndex={viewTabIndex}
          onChange={handleViewChange}
        />
      </PageHeader>

      {/* ── Content area ────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-4">

        {/* Sub-navigation row: arrows + date label + Today pill + New Session */}
        <div className="flex items-center gap-2 mb-5 flex-wrap sm:flex-nowrap">
          <button onClick={handlePrev}
            aria-label="Previous"
            className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none">
            <ChevronLeft size={18} />
          </button>

          <div className="flex-1 text-center min-w-0">
            <p className="text-[14px] sm:text-[16px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{subLabel}</p>
          </div>

          <button onClick={handleNext}
            aria-label="Next"
            className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none">
            <ChevronRight size={18} />
          </button>

          {/* Today pill */}
          <button
            onClick={handleToday}
            disabled={isAtToday}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold min-h-[36px] transition-colors flex-shrink-0"
            style={isAtToday
              ? { background: 'var(--color-accent-glow)', color: 'var(--color-text-muted)', opacity: 0.6, cursor: 'default' }
              : { background: 'var(--color-accent)', color: '#000' }
            }
          >
            {t('trainerCalendar.today', 'Today')}
          </button>

          {/* New Session */}
          <button
            onClick={() => setModal({ date: viewMode === 'day' ? selectedDay : new Date() })}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-bold transition-colors flex-shrink-0 whitespace-nowrap"
            style={{ background: 'var(--color-accent)', color: '#000' }}
          >
            <Plus size={15} /> <span className="text-[11px] sm:text-[12px]">{t('trainerCalendar.newSession', 'New')}</span>
          </button>
        </div>

        {/* ── DAY VIEW ──────────────────────────────────────────────────── */}
        {viewMode === 'day' && (
          <>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
              </div>
            ) : dayViewSessions.length === 0 ? (
              <div className="text-center py-16">
                <CalendarDays size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-[14px]" style={{ color: 'var(--color-text-muted)' }}>{t('trainerCalendar.noSessionsThisDay')}</p>
                <button
                  onClick={() => setModal({ date: selectedDay })}
                  className="mt-4 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 transition-colors"
                >
                  <Plus size={14} className="inline mr-1.5 -mt-0.5" />
                  {t('trainerCalendar.addSession')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {dayViewSessions.map(s => {
                  const sc = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
                  return (
                    <button key={s.id} onClick={() => setModal({ session: s })}
                      className="w-full flex items-center gap-3 p-4 bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-xl hover:bg-[var(--color-bg-card)]/80 hover:border-white/20 transition-all text-left">
                      <div className={`w-10 h-10 rounded-xl ${sc.bg} flex items-center justify-center flex-shrink-0`}>
                        <CalendarDays size={18} className={sc.text} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
                          {s.profiles?.full_name || t('trainerCalendar.client')}
                          {s.recurrence_group && <Repeat size={12} className="text-[var(--color-text-muted)] flex-shrink-0" />}
                        </p>
                        <p className="text-[12px] text-[var(--color-text-muted)]">{s.title}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">{format(new Date(s.scheduled_at), 'h:mm a')}</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">{s.duration_mins}m</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${sc.bg} ${sc.text} flex-shrink-0`}>
                        {sc.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── WEEK VIEW ─────────────────────────────────────────────────── */}
        {viewMode === 'week' && (
          <>
            {/* Today's Agenda (if on current week) */}
            {weekOffset === 0 && todaySessions.length > 0 && (
              <div className="mb-6 bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-2xl p-4">
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-[var(--color-accent)]" />
                  {t('trainerCalendar.todaysSessions')}
                </p>
                <div className="space-y-2">
                  {todaySessions.map(s => {
                    const sc = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
                    return (
                      <button key={s.id} onClick={() => setModal({ session: s })}
                        className="w-full flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded-xl hover:bg-[var(--color-bg-secondary)]/80 transition-colors text-left">
                        <div className={`w-8 h-8 rounded-lg ${sc.bg} flex items-center justify-center flex-shrink-0`}>
                          <CalendarDays size={14} className={sc.text} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate flex items-center gap-1">
                            {s.profiles?.full_name || t('trainerCalendar.client')}
                            {s.recurrence_group && <Repeat size={11} className="text-[var(--color-text-muted)] flex-shrink-0" />}
                          </p>
                          <p className="text-[11px] text-[var(--color-text-muted)]">{s.title}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[12px] text-[var(--color-text-secondary)]">{format(new Date(s.scheduled_at), 'h:mm a')}</p>
                          <p className="text-[10px] text-[var(--color-text-muted)]">{s.duration_mins}m</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Week grid */}
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                {days.map(day => {
                  const key = format(day, 'yyyy-MM-dd');
                  const daySessions = weekSessionsByDay[key] || [];
                  const today = isToday(day);
                  const past = isBefore(day, new Date()) && !today;

                  return (
                    <div key={key} className={`bg-[var(--color-bg-card)] border rounded-xl overflow-hidden min-h-[100px] md:min-h-[140px] hover:border-white/20 hover:bg-white/[0.03] transition-all ${
                      today ? 'border-[var(--color-accent)]/30' : 'border-[var(--color-border-subtle)]'
                    }`}>
                      {/* Day header */}
                      <div className={`px-3 py-2 border-b flex items-center justify-between ${
                        today ? 'border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5' : 'border-white/4'
                      }`}>
                        <div>
                          <p className={`text-[11px] font-medium ${today ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                            {format(day, 'EEE')}
                          </p>
                          <p className={`text-[15px] font-bold ${today ? 'text-[var(--color-accent)]' : past ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}>
                            {format(day, 'd')}
                          </p>
                        </div>
                        <button
                          onClick={() => setModal({ date: day })}
                          aria-label="Add session"
                          className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Sessions */}
                      <div className="p-1.5 space-y-1">
                        {daySessions.length === 0 ? (
                          <p className="text-[10px] text-[var(--color-text-faint)] text-center py-3">{t('trainerCalendar.noSessions')}</p>
                        ) : (
                          daySessions.map(s => {
                            const sc = STATUS_COLORS[s.status] || STATUS_COLORS.scheduled;
                            return (
                              <button key={s.id} onClick={() => setModal({ session: s })}
                                className={`w-full text-left px-2.5 py-2 rounded-lg ${sc.bg} hover:opacity-80 transition-opacity`}>
                                <p className={`text-[11px] font-semibold ${sc.text} truncate flex items-center gap-1`}>
                                  {s.profiles?.full_name || t('trainerCalendar.client')}
                                  {s.recurrence_group && <Repeat size={10} className="flex-shrink-0 opacity-60" />}
                                </p>
                                <p className="text-[10px] text-[var(--color-text-muted)]">
                                  {format(new Date(s.scheduled_at), 'h:mm a')} · {s.duration_mins}m
                                </p>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── MONTH VIEW (Google Calendar style) ────────────────────────── */}
        {viewMode === 'month' && (
          <>
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="w-8 h-8 border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)] rounded-full animate-spin" />
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
                {/* Day names header */}
                <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {DAY_NAMES.map((name, i) => (
                    <div key={name} className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: (i >= 5) ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>
                      {name}
                    </div>
                  ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7">
                  {paddedMonthDays.map((day, idx) => {
                    const key = format(day, 'yyyy-MM-dd');
                    const inMonth = isSameMonth(day, monthAnchor);
                    const today = isToday(day);
                    const dayOfWeek = getDay(day); // 0=Sun, 6=Sat
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const daySessions = sessionsByDay[key] || [];
                    const hasSessions = daySessions.length > 0;

                    return (
                      <button
                        key={key + idx}
                        onClick={() => handleMonthDayClick(day)}
                        className="text-left transition-colors cursor-pointer group min-h-[72px] sm:min-h-[64px] md:min-h-[80px]"
                        style={{
                          borderBottom: '1px solid var(--color-border-subtle)',
                          borderRight: (idx % 7 !== 6) ? '1px solid var(--color-border-subtle)' : 'none',
                          background: isWeekend && inMonth ? 'rgba(255,255,255,0.015)' : 'transparent',
                          opacity: inMonth ? 1 : 0.3,
                        }}
                      >
                        <div className="p-1.5 md:p-2 h-full flex flex-col group-hover:bg-white/[0.04] rounded-sm transition-colors">
                          {/* Day number */}
                          <div className="flex items-start justify-center md:justify-start mb-0.5">
                            {today ? (
                              <span className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full text-[12px] font-bold"
                                style={{ background: 'var(--color-accent)', color: '#000' }}>
                                {format(day, 'd')}
                              </span>
                            ) : (
                              <span className={`inline-flex items-center justify-center w-[26px] h-[26px] rounded-full text-[12px] leading-none ${
                                hasSessions ? 'font-bold' : 'font-medium'
                              }`}
                                style={{ color: inMonth ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                                {format(day, 'd')}
                              </span>
                            )}
                          </div>

                          {/* Session preview pills */}
                          <div className="flex-1 min-w-0 hidden md:block">
                            {daySessions.slice(0, 2).map(s => {
                              const sc = STATUS_BG[s.status] || STATUS_BG.scheduled;
                              return (
                                <div key={s.id} className="text-[9px] truncate px-1 py-0.5 rounded mt-0.5 flex items-center gap-0.5"
                                  style={{ background: sc.bg, color: sc.text }}>
                                  {s.recurrence_group && <Repeat size={8} className="flex-shrink-0 opacity-60" />}
                                  {format(new Date(s.scheduled_at), 'HH:mm')}{' '}
                                  {s.profiles?.full_name?.split(' ')[0] || s.title}
                                </div>
                              );
                            })}
                            {daySessions.length > 2 && (
                              <p className="text-[9px] mt-0.5 px-1" style={{ color: 'var(--color-text-muted)' }}>
                                {t('trainerCalendar.more', { count: daySessions.length - 2 })}
                              </p>
                            )}
                          </div>

                          {/* Mobile: colored dots instead of pills */}
                          <div className="flex items-center justify-center gap-0.5 mt-auto md:hidden">
                            {daySessions.slice(0, 3).map(s => {
                              const sc = STATUS_BG[s.status] || STATUS_BG.scheduled;
                              return (
                                <span key={s.id} className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                                  style={{ background: sc.text }} />
                              );
                            })}
                            {daySessions.length > 3 && (
                              <span className="text-[8px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                                +{daySessions.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <SessionModal
          session={modal.session}
          date={modal.date}
          clients={clients}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          trainerId={profile.id}
          gymId={profile.gym_id}
          trainerName={profile.full_name}
        />
      )}
    </div>
  );
}
