import { useEffect, useState, useMemo, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, X, ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Trash2, Bell, BellOff, Repeat, Dumbbell,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cacheGet, cacheSet, cacheHas, trainerKey } from '../../hooks/useTrainerCache';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import posthog from 'posthog-js';
import {
  format, addWeeks, startOfWeek, endOfWeek, addDays, startOfDay,
  isSameDay, isToday, setHours, setMinutes,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, addMonths,
} from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import logger from '../../lib/logger';
import useFocusTrap from '../../hooks/useFocusTrap';
import { TT, TFont, avatarIdx } from './components/designTokens';
import {
  TCard, TPill, TAvatar, TEyebrow, TPageTitle, TIconButton,
  TSegmented, TSectionHeader, TPrimaryButton,
} from './components/designPrimitives';

const STATUS_COLORS_BASE = {
  scheduled: { tone: 'teal',  key: 'statusScheduled' },
  confirmed: { tone: 'teal',  key: 'statusConfirmed' },
  completed: { tone: 'good',  key: 'statusCompleted' },
  cancelled: { tone: 'hot',   key: 'statusCancelled' },
  no_show:   { tone: 'warn',  key: 'statusNoShow' },
};

const DURATIONS = [30, 45, 60, 90, 120];

const QUICK_TEMPLATES = [
  { key: 'checkin', duration: 30, titleKey: 'templateCheckinTitle' },
  { key: 'training', duration: 60, titleKey: 'templateTrainingTitle' },
  { key: 'assessment', duration: 90, titleKey: 'templateAssessmentTitle' },
];

const VIEW_MODES = ['day', 'week', 'month'];

// Map status to (tone color, soft background) for visual blocks
function statusVisuals(status) {
  switch (status) {
    case 'completed': return { tone: TT.good,  soft: TT.goodSoft };
    case 'cancelled': return { tone: TT.hot,   soft: TT.hotSoft };
    case 'no_show':   return { tone: TT.warn,  soft: TT.warnSoft };
    default:          return { tone: TT.accent, soft: TT.accentSoft };
  }
}

// Title-kind heuristics — EN + ES keywords so Spanish titles classify too.
const GROUP_KEYWORDS = ['bootcamp', 'group', 'grupal', 'grupo'];
const INTAKE_KEYWORDS = ['assessment', 'intake', 'evaluación', 'evaluacion', 'valoración', 'valoracion'];
const titleHasKeyword = (title, keywords) => {
  const lower = (title || '').toLowerCase();
  return keywords.some(k => lower.includes(k));
};
const isGroupTitle = (title) => titleHasKeyword(title, GROUP_KEYWORDS);
const isIntakeTitle = (title) => titleHasKeyword(title, INTAKE_KEYWORDS);

// Small chip showing the workout attached to a session (details.workout_name).
const WorkoutChip = ({ name }) => {
  if (!name) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 999, maxWidth: '100%',
      background: TT.accentSoft, color: TT.accentInk,
      fontSize: 9.5, fontWeight: 800, overflow: 'hidden',
    }}>
      <Dumbbell size={9} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </span>
  );
};

// ── Session Modal (keeps existing UX, restyled with TT tokens) ─────────────
const SessionModal = ({ session, clients, date, onClose, onSaved, trainerId, gymId, workoutPlans, presetClientId }) => {
  const { showToast } = useToast();
  const { t, i18n } = useTranslation(['pages', 'common']);
  useScrollLock(true); // modal only mounts when open → lock the page behind
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const focusTrapRef = useFocusTrap(true, onClose);
  const isEdit = !!session;
  const STATUS_COLORS = useMemo(() => {
    const out = {};
    for (const [k, v] of Object.entries(STATUS_COLORS_BASE)) {
      out[k] = { tone: v.tone, label: t(`pages:trainerCalendar.${v.key}`) };
    }
    return out;
  }, [t]);
  const [clientId, setClientId] = useState(session?.client_id || presetClientId || '');
  // Title starts EMPTY (placeholder attr shows the hint) — pre-filling the
  // VALUE with localized placeholder text made every session keep that text
  // as its real title, which broke the kind heuristics + cluttered the lists.
  const [title, setTitle]       = useState(session?.title || '');
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
  const [frequency, setFrequency]       = useState('weekly');
  const defaultEndDate = format(addWeeks(new Date(), 8), 'yyyy-MM-dd');
  const [endDate, setEndDate]           = useState(defaultEndDate);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError]       = useState('');
  const [selectedWorkout, setSelectedWorkout] = useState(session?.details?.workout_id || '');

  // Personal plans (trainer_workout_plans) are per-client: when a client is
  // selected only their plans are listed; routines + gym programs always show.
  const visibleWorkoutPlans = useMemo(
    () => (workoutPlans || []).filter(w => w._type !== 'plan' || !clientId || w._clientId === clientId),
    [workoutPlans, clientId],
  );

  // Switching client drops a selected plan that belongs to someone else, so
  // we never attach the wrong client's plan.
  const handleClientChange = (nextClientId) => {
    setClientId(nextClientId);
    setSelectedWorkout(prev => {
      if (!prev) return prev;
      const w = (workoutPlans || []).find(x => x.id === prev);
      const wrongClient = w && w._type === 'plan' && nextClientId && w._clientId && w._clientId !== nextClientId;
      return wrongClient ? '' : prev;
    });
  };

  const applyTemplate = (tmpl) => {
    setTitle(t(`pages:trainerCalendar.${tmpl.titleKey}`));
    setDuration(tmpl.duration);
  };

  const checkConflicts = async (scheduledAt, durationMins, excludeSessionId) => {
    const startTime = new Date(scheduledAt);
    const endTime = new Date(startTime.getTime() + durationMins * 60000);
    const windowStart = new Date(startTime.getTime() - 24 * 60 * 60000).toISOString();
    const windowEnd = new Date(endTime.getTime() + 24 * 60 * 60000).toISOString();

    let trainerQuery = supabase
      .from('trainer_sessions')
      .select('id, scheduled_at, duration_mins, client_id, profiles!trainer_sessions_client_id_fkey(full_name)')
      .eq('trainer_id', trainerId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', windowStart)
      .lte('scheduled_at', windowEnd);
    if (excludeSessionId) trainerQuery = trainerQuery.neq('id', excludeSessionId);

    let clientQuery = supabase
      .from('trainer_sessions')
      .select('id, scheduled_at, duration_mins, trainer_id')
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .gte('scheduled_at', windowStart)
      .lte('scheduled_at', windowEnd);
    if (excludeSessionId) clientQuery = clientQuery.neq('id', excludeSessionId);

    const [{ data: trainerSessions }, { data: clientSessions }] = await Promise.all([trainerQuery, clientQuery]);

    const overlaps = (existing) => {
      const eStart = new Date(existing.scheduled_at);
      const eEnd = new Date(eStart.getTime() + (existing.duration_mins || 60) * 60000);
      return eStart < endTime && eEnd > startTime;
    };

    const trainerConflict = (trainerSessions || []).find(overlaps);
    if (trainerConflict) return { type: 'trainer', session: trainerConflict };

    const clientConflict = (clientSessions || []).find(overlaps);
    if (clientConflict) return { type: 'client', session: clientConflict };

    // Cross-trainer check: RLS hides this client's sessions with OTHER
    // trainers from the queries above, so ask the SECURITY DEFINER RPC
    // (migration 0529). If the RPC isn't deployed yet (404/42883), degrade
    // silently to the same-trainer checks above.
    try {
      const { data: crossRows, error: crossErr } = await supabase.rpc('check_client_session_conflict', {
        p_client_id: clientId,
        p_start: startTime.toISOString(),
        p_duration_mins: durationMins,
        p_exclude_session: excludeSessionId || null,
      });
      if (crossErr) {
        const missing = crossErr.code === '42883' || crossErr.code === 'PGRST202' || crossErr.status === 404;
        if (!missing) logger.error('SessionModal: check_client_session_conflict failed:', crossErr);
      } else if (Array.isArray(crossRows) && crossRows.length > 0) {
        return { type: 'client_other_trainer', session: crossRows[0] };
      }
    } catch (e) {
      logger.error('SessionModal: cross-trainer conflict check threw:', e);
    }

    return null;
  };

  const handleSave = async () => {
    if (!clientId) { const msg = t('pages:trainerCalendar.selectClientError'); setError(msg); showToast(msg, 'error'); return; }
    setSaving(true);
    setError('');

    const scheduledAt = new Date(`${dateVal}T${timeVal}`).toISOString();
    const durationMins = Math.max(1, Math.round(duration));

    try {
      const conflict = await checkConflicts(scheduledAt, durationMins, isEdit ? session.id : null);
      if (conflict) {
        let msg;
        if (conflict.type === 'trainer') {
          const otherClient = conflict.session?.profiles?.full_name;
          msg = otherClient
            ? t('pages:trainerCalendar.trainerConflictNamed', 'You already have a session with {{name}} at that time', { name: otherClient })
            : t('pages:trainerCalendar.trainerConflict');
        } else if (conflict.type === 'client_other_trainer') {
          const otherTrainer = conflict.session?.trainer_name;
          msg = otherTrainer
            ? t('pages:trainerCalendar.clientOtherTrainerConflictNamed', 'This client already has a session with {{name}} at that time', { name: otherTrainer })
            : t('pages:trainerCalendar.clientOtherTrainerConflict', 'This client already has a session with another trainer at that time');
        } else {
          msg = t('pages:trainerCalendar.clientConflict');
        }
        setError(msg);
        showToast(msg, 'error');
        setSaving(false);
        return;
      }
    } catch (e) {
      logger.error('SessionModal: conflict check failed:', e);
    }

    const workoutPlan = (workoutPlans || []).find(w => w.id === selectedWorkout);
    const details = selectedWorkout && workoutPlan
      ? { workout_id: selectedWorkout, workout_name: workoutPlan.name, workout_type: workoutPlan._type }
      : {};

    const insertPayload = {
      gym_id: gymId,
      trainer_id: trainerId,
      client_id: clientId,
      title: title.trim() || t('pages:trainerCalendar.titlePlaceholder'),
      notes: notes.trim() || null,
      scheduled_at: scheduledAt,
      duration_mins: durationMins,
      status,
      send_reminder: sendReminder,
      details,
      updated_at: new Date().toISOString(),
    };

    const updatePayload = {
      client_id: clientId,
      title: title.trim() || t('pages:trainerCalendar.titlePlaceholder'),
      notes: notes.trim() || null,
      scheduled_at: scheduledAt,
      duration_mins: durationMins,
      status,
      send_reminder: sendReminder,
      details,
      updated_at: new Date().toISOString(),
    };

    let recurringCount = 0;
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
      // End date before the start date generates zero rows — that's a user
      // mistake, not a success.
      if (rows.length === 0) {
        const msg = t('pages:trainerCalendar.recurringNoneCreated', 'No sessions were created — check the end date');
        setError(msg);
        showToast(msg, 'error');
        setSaving(false);
        return;
      }
      try {
        for (let i = 1; i < rows.length; i++) {
          const rc = await checkConflicts(rows[i].scheduled_at, durationMins, null);
          if (rc) {
            const dateStr = format(new Date(rows[i].scheduled_at), 'MMM d', { locale: dateFnsLocale });
            const msg = rc.type === 'client_other_trainer'
              ? t('pages:trainerCalendar.clientOtherTrainerConflictOnDate', 'This client has a session with another trainer on {{date}}', { date: dateStr })
              : rc.type === 'trainer'
                ? t('pages:trainerCalendar.trainerConflictOnDate', { date: dateStr })
                : t('pages:trainerCalendar.clientConflictOnDate', { date: dateStr });
            setError(msg);
            showToast(msg, 'error');
            setSaving(false);
            return;
          }
        }
      } catch (e) {
        logger.error('SessionModal: recurring conflict check failed:', e);
      }

      const { error: err } = await supabase.from('trainer_sessions').insert(rows);
      if (err) {
        logger.error('SessionModal: recurring insert failed:', err);
        const friendly = t('pages:trainerCalendar.errorSaveSession', 'Failed to save session');
        setError(friendly);
        setSaving(false);
        showToast(friendly, 'error');
        return;
      }
      recurringCount = rows.length;
    } else {
      const { error: err } = isEdit
        ? await supabase.from('trainer_sessions').update(updatePayload).eq('id', session.id)
        : await supabase.from('trainer_sessions').insert(insertPayload);
      if (err) {
        logger.error('SessionModal: save session failed:', err);
        const friendly = t('pages:trainerCalendar.errorSaveSession', 'Failed to save session');
        setError(friendly);
        setSaving(false);
        showToast(friendly, 'error');
        return;
      }
    }

    // Session reminders are sent server-side: the `send-session-reminders`
    // pg_cron job (migration 0440) reminds both the client and the trainer
    // ~1h before any session with send_reminder = true. The old client-side
    // insert here was broken (no scheduled_at column, invalid enum type) and
    // never delivered anything, so it was removed.

    if (!isEdit && recurring) {
      posthog?.capture('trainer_session_created', { recurring: true, count: recurringCount });
      showToast(t('pages:trainerCalendar.recurringSessionsCreated', { count: recurringCount }), 'success');
    } else {
      showToast(isEdit ? t('pages:trainerCalendar.sessionUpdated') : t('pages:trainerCalendar.sessionScheduled'), 'success');
      if (!isEdit) posthog?.capture('trainer_session_created', { recurring: false });
    }
    onSaved();
  };

  // Cancel (status → 'cancelled') is the primary destructive action: the
  // 0443 UPDATE trigger notifies the member. Hard DELETE bypassed that
  // trigger entirely (sessions just vanished on the member side), so it's
  // now only offered for sessions that are ALREADY cancelled.
  const isCancelled = isEdit && session?.status === 'cancelled';

  const handleCancelSession = async () => {
    setDeleting(true);
    const { error } = await supabase
      .from('trainer_sessions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', session.id);
    if (error) {
      logger.error('SessionModal: cancel session failed:', error);
      setDeleting(false);
      showToast(t('pages:trainerCalendar.errorCancelSession', 'Failed to cancel session'), 'error');
      return;
    }
    showToast(t('pages:trainerCalendar.sessionCancelledToast', 'Session cancelled — the client will be notified'), 'success');
    onSaved();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.from('trainer_sessions').delete().eq('id', session.id);
    if (error) {
      setDeleting(false);
      showToast(t('pages:trainerCalendar.errorDeleteSession', 'Failed to delete session'), 'error');
      return;
    }
    onSaved();
  };

  const inputStyle = {
    width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
    background: TT.surface2,
    border: `1px solid ${TT.borderSolid}`, borderRadius: 12,
    padding: '10px 14px', minHeight: 44, fontSize: 14,
    color: TT.text, outline: 'none',
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', overscrollBehavior: 'contain' }}
      onClick={onClose}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-modal-title"
        style={{
          background: TT.surface, border: `1px solid ${TT.borderSolid}`,
          borderRadius: 18, width: '100%', maxWidth: 540,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${TT.border}`, flexShrink: 0,
        }}>
          <p id="session-modal-title" style={{
            fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
            color: TT.text, letterSpacing: -0.3,
          }}>
            {isEdit ? t('pages:trainerCalendar.editSession') : t('pages:trainerCalendar.newSession')}
          </p>
          <button onClick={onClose}
            aria-label={t('pages:trainerCalendar.closeDialog', 'Close dialog')}
            className="w-11 h-11 flex items-center justify-center rounded-lg -mr-2"
            style={{ color: TT.textMute }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }} className="space-y-4">
          {/* Quick Templates */}
          {!isEdit && (
            <div>
              <label style={{
                display: 'block', fontSize: 12, color: TT.textSub,
                fontWeight: 700, marginBottom: 6,
              }}>
                {t('pages:trainerCalendar.quickTemplates')}
              </label>
              <div className="flex gap-2">
                {QUICK_TEMPLATES.map(tmpl => (
                  <button key={tmpl.key} onClick={() => applyTemplate(tmpl)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 12,
                      background: TT.surface2, border: `1px solid ${TT.borderSolid}`,
                      fontSize: 11, fontWeight: 700, color: TT.textSub,
                      textAlign: 'center', minHeight: 44,
                    }}
                  >
                    <span style={{ display: 'block', color: TT.text, fontSize: 12, marginBottom: 2 }}>{tmpl.duration}m</span>
                    {t(`pages:trainerCalendar.${tmpl.titleKey}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Client */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
              {t('pages:trainerCalendar.clientLabel')}
            </label>
            <select value={clientId} onChange={e => handleClientChange(e.target.value)} style={inputStyle}>
              <option value="">{t('pages:trainerCalendar.selectClient')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
              {t('pages:trainerCalendar.titleLabel')}
            </label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('pages:trainerCalendar.titlePlaceholder')}
              maxLength={80} style={inputStyle}
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                {t('pages:trainerCalendar.dateLabel')}
              </label>
              <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} style={{ ...inputStyle, minWidth: 0, maxWidth: '100%' }} />
            </div>
            <div className="min-w-0">
              <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                {t('pages:trainerCalendar.timeLabel')}
              </label>
              <input type="time" value={timeVal} onChange={e => setTimeVal(e.target.value)} style={{ ...inputStyle, minWidth: 0, maxWidth: '100%' }} />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
              {t('pages:trainerCalendar.durationLabel')}
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setDuration(d)}
                  style={{
                    minHeight: 44, borderRadius: 12, fontSize: 12, fontWeight: 800,
                    background: duration === d ? TT.accentSoft : TT.surface2,
                    color: duration === d ? TT.accentInk : TT.textSub,
                    border: `1px solid ${duration === d ? 'transparent' : TT.borderSolid}`,
                  }}
                >
                  {t('trainerCalendar.minutesShort', '{{d}}m', { d })}
                </button>
              ))}
            </div>
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div>
              <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                {t('pages:trainerCalendar.statusLabel')}
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {Object.entries(STATUS_COLORS).map(([key, val]) => {
                  const active = status === key;
                  return (
                    <button key={key} onClick={() => setStatus(key)}
                      style={{
                        padding: '8px 10px', minHeight: 44, borderRadius: 10,
                        fontSize: 11, fontWeight: 800,
                        background: active
                          ? (val.tone === 'good' ? TT.goodSoft
                            : val.tone === 'hot' ? TT.hotSoft
                            : val.tone === 'warn' ? TT.warnSoft
                            : TT.accentSoft)
                          : TT.surface2,
                        color: active
                          ? (val.tone === 'good' ? TT.goodInk
                            : val.tone === 'hot' ? TT.hot
                            : val.tone === 'warn' ? TT.warnInk
                            : TT.accentInk)
                          : TT.textMute,
                        border: `1px solid ${active ? 'transparent' : TT.borderSolid}`,
                      }}
                    >
                      {val.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Send Reminder toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {sendReminder ? <Bell size={14} color={TT.accent} /> : <BellOff size={14} color={TT.textMute} />}
              <div>
                <p style={{ fontSize: 12, color: TT.text, fontWeight: 700 }}>{t('pages:trainerCalendar.sendReminder')}</p>
                <p style={{ fontSize: 10.5, color: TT.textMute }}>{t('pages:trainerCalendar.reminderHint')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSendReminder(!sendReminder)}
              style={{ position: 'relative', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'transparent', border: 'none' }}
              aria-label={t('pages:trainerCalendar.toggleSendReminder', 'Toggle send reminder')}
            >
              <span style={{
                position: 'absolute', width: 40, height: 22, borderRadius: 999,
                background: sendReminder ? TT.accent : TT.borderSolid,
                transition: 'background 0.15s',
              }}>
                <span style={{
                  position: 'absolute', top: 2,
                  left: sendReminder ? 20 : 2,
                  width: 18, height: 18, borderRadius: 999, background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transition: 'left 0.15s',
                }} />
              </span>
            </button>
          </div>

          {/* Recurring toggle (new sessions only) */}
          {!isEdit && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Repeat size={14} color={recurring ? TT.accent : TT.textMute} />
                  <div>
                    <p style={{ fontSize: 12, color: TT.text, fontWeight: 700 }}>{t('pages:trainerCalendar.recurring')}</p>
                    <p style={{ fontSize: 10.5, color: TT.textMute }}>{t('pages:trainerCalendar.recurringHint')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRecurring(!recurring)}
                  style={{ position: 'relative', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'transparent', border: 'none' }}
                  aria-label={t('pages:trainerCalendar.toggleRecurring', 'Toggle recurring')}
                >
                  <span style={{
                    position: 'absolute', width: 40, height: 22, borderRadius: 999,
                    background: recurring ? TT.accent : TT.borderSolid,
                  }}>
                    <span style={{
                      position: 'absolute', top: 2,
                      left: recurring ? 20 : 2,
                      width: 18, height: 18, borderRadius: 999, background: '#fff',
                    }} />
                  </span>
                </button>
              </div>

              {recurring && (
                <div style={{ marginLeft: 6, paddingLeft: 18, borderLeft: `2px solid ${TT.accentSoft}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                      {t('pages:trainerCalendar.frequencyLabel')}
                    </label>
                    <div className="flex gap-2">
                      {['weekly', 'biweekly'].map(f => {
                        const active = frequency === f;
                        return (
                          <button key={f} onClick={() => setFrequency(f)}
                            style={{
                              flex: 1, minHeight: 44, borderRadius: 12,
                              fontSize: 12, fontWeight: 800,
                              background: active ? TT.accentSoft : TT.surface2,
                              color: active ? TT.accentInk : TT.textSub,
                              border: `1px solid ${active ? 'transparent' : TT.borderSolid}`,
                            }}
                          >
                            {t(`pages:trainerCalendar.frequency_${f}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                      {t('pages:trainerCalendar.endDateLabel')}
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      min={format(new Date(), 'yyyy-MM-dd')}
                      onChange={e => setEndDate(e.target.value)}
                      style={inputStyle}
                    />
                    <p style={{ fontSize: 10.5, color: TT.textMute, marginTop: 4 }}>{t('pages:trainerCalendar.endDateHint')}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Workout Plan Selector */}
          {visibleWorkoutPlans.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
                <Dumbbell size={12} color={TT.accent} style={{ display: 'inline', marginRight: 4, marginTop: -2 }} />
                {t('pages:trainerCalendar.attachWorkout')}
              </label>
              <select value={selectedWorkout} onChange={e => setSelectedWorkout(e.target.value)} style={inputStyle}>
                <option value="">{t('pages:trainerCalendar.noWorkout')}</option>
                {visibleWorkoutPlans.map(w => (
                  <option key={w.id} value={w.id}>
                    {w._type === 'plan'
                      ? `${t('pages:trainerCalendar.planPrefix', 'Plan')}: ${w.name}${w._clientName ? ` · ${w._clientName}` : ''}`
                      : `${w.name}${w._days ? ` (${w._days} ${t('pages:trainerCalendar.days')})` : ''}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, color: TT.textSub, fontWeight: 700, marginBottom: 6 }}>
              {t('pages:trainerCalendar.notesLabel')}
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder={t('pages:trainerCalendar.notesPlaceholder')}
              style={{ ...inputStyle, padding: 12, resize: 'none' }}
            />
          </div>

          {error && <p style={{ fontSize: 12, color: TT.hot }}>{error}</p>}
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, padding: '16px 20px',
          borderTop: `1px solid ${TT.border}`, alignItems: 'center', flexShrink: 0,
        }}>
          {isEdit && (
            confirmDelete ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: TT.textSub }}>
                  {isCancelled
                    ? t('pages:trainerCalendar.deleteSessionConfirm')
                    : t('pages:trainerCalendar.cancelSessionConfirm', 'Cancel this session? The client will be notified.')}
                </span>
                <button onClick={isCancelled ? handleDelete : handleCancelSession} disabled={deleting}
                  style={{
                    padding: '8px 12px', minHeight: 44, borderRadius: 10,
                    fontSize: 12, fontWeight: 800,
                    background: TT.hotSoft, color: TT.hot, border: 'none',
                  }}
                >
                  {deleting ? t('pages:trainerCalendar.deleting') : t('pages:trainerCalendar.confirm')}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: '8px 12px', minHeight: 44, borderRadius: 10,
                    fontSize: 12, fontWeight: 700, background: TT.surface2, color: TT.textSub, border: 'none',
                  }}
                >
                  {t('pages:trainerCalendar.cancel')}
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 14px', minHeight: 44, borderRadius: 12,
                  fontSize: 13, fontWeight: 700, color: TT.hot, background: 'transparent', border: 'none',
                }}
              >
                <Trash2 size={14} />{' '}
                {isCancelled
                  ? t('pages:trainerCalendar.delete')
                  : t('pages:trainerCalendar.cancelSession', 'Cancel session')}
              </button>
            )
          )}
          <div className="hidden sm:block flex-1" />
          <button onClick={onClose}
            style={{
              padding: '10px 14px', minHeight: 44, borderRadius: 12,
              fontSize: 13, fontWeight: 700, color: TT.textSub, background: 'transparent', border: 'none',
            }}
          >
            {t('pages:trainerCalendar.cancel')}
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{
              padding: '10px 18px', minHeight: 44, borderRadius: 12,
              fontSize: 13, fontWeight: 800, color: '#06363B', background: TT.accent, border: 'none',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? t('pages:trainerCalendar.saving') : isEdit ? t('pages:trainerCalendar.update') : t('pages:trainerCalendar.create')}
          </button>
        </div>
      </div>
    </div>
  , document.body);
};

// ── Main ───────────────────────────────────────────────────────────────────
export default function TrainerSchedule() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { t, i18n } = useTranslation('pages');
  const dateFnsLocale = i18n.language?.startsWith('es') ? es : enUS;
  const [searchParams, setSearchParams] = useSearchParams();

  // Instant-load cache: seed the primary datasets from the last visit so
  // navigating back paints immediately, then the useEffects below revalidate
  // in the background (stale-while-revalidate).
  const CK_sessions = trainerKey('calendar-sessions', profile?.id);
  const CK_clients = trainerKey('calendar-clients', profile?.id);
  const CK_plans = trainerKey('calendar-plans', profile?.id);

  const [viewMode, setViewMode] = useState('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayOffset, setDayOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [sessions, setSessions] = useState(() => cacheGet(CK_sessions) ?? []);
  const [clients, setClients] = useState(() => cacheGet(CK_clients) ?? []);
  const [clientsLoaded, setClientsLoaded] = useState(() => cacheHas(CK_clients));
  const [workoutPlans, setWorkoutPlans] = useState(() => cacheGet(CK_plans) ?? []);
  // Spinner only on a true cold load — `sessions` drives every day/week/month view.
  const [loading, setLoading] = useState(() => !cacheHas(CK_sessions));
  const [modal, setModal] = useState(null);
  // `?client=<id>&book=1` deep-link (messages page contract): open the
  // booking modal with that client preselected. null = no pending request.
  const [pendingBookClient, setPendingBookClient] = useState(null);

  // ── Derived dates ──
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 0 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // startOfDay: the raw addDays(new Date(), n) carried wall-clock h:m:s.ms,
  // which made day-view hour slots start at e.g. 7:43:12 — sessions matched
  // one row early and anything in the first hour matched NO row at all.
  const selectedDay = startOfDay(addDays(new Date(), dayOffset));

  const monthAnchor = addMonths(new Date(), monthOffset);
  const monthStart = startOfMonth(monthAnchor);
  const monthEnd = endOfMonth(monthAnchor);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Week starts Sunday (getDay(): Sun=0). Pad equals the day-of-week index.
  const firstDayOfWeek = getDay(monthStart);
  const startPad = firstDayOfWeek;
  const paddedMonthDays = useMemo(() => {
    const padBefore = Array.from({ length: startPad }, (_, i) => addDays(monthStart, -(startPad - i)));
    const totalCells = padBefore.length + monthDays.length;
    const endPad = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    const padAfter = Array.from({ length: endPad }, (_, i) => addDays(monthEnd, i + 1));
    return [...padBefore, ...monthDays, ...padAfter];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart.getTime(), monthEnd.getTime(), startPad]);

  // Sunday-first ordering (matches gym week convention).
  const DAY_NAMES = [
    t('trainerCalendar.dayNames.sun'),
    t('trainerCalendar.dayNames.mon'),
    t('trainerCalendar.dayNames.tue'),
    t('trainerCalendar.dayNames.wed'),
    t('trainerCalendar.dayNames.thu'),
    t('trainerCalendar.dayNames.fri'),
    t('trainerCalendar.dayNames.sat'),
  ];

  useEffect(() => { document.title = `${t('trainerCalendar.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!profile?.id) return;
    loadClients();
    loadWorkoutPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // ── `?client=<id>&book=1` deep link (from TrainerMessages) ──
  // Capture once on mount, then strip the params so refresh/back doesn't
  // re-open the modal.
  useEffect(() => {
    const wantsBook = searchParams.get('book') === '1';
    const clientParam = searchParams.get('client');
    if (!wantsBook && !clientParam) return;
    if (wantsBook) setPendingBookClient(clientParam || '');
    const next = new URLSearchParams(searchParams);
    next.delete('book');
    next.delete('client');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the modal once the client list is in (so the <select> can actually
  // show the preselected client). Unknown/foreign ids degrade to no preselect.
  useEffect(() => {
    if (pendingBookClient === null || !clientsLoaded) return;
    const valid = clients.some(c => c.id === pendingBookClient);
    setModal({ date: new Date(), presetClientId: valid ? pendingBookClient : '' });
    setPendingBookClient(null);
  }, [pendingBookClient, clientsLoaded, clients]);

  const fetchRange = useMemo(() => {
    // Day view fetches the WHOLE week around the selected day so the week
    // strip dots stay accurate while flipping through days.
    if (viewMode === 'day') {
      const ws = startOfWeek(selectedDay, { weekStartsOn: 0 });
      return { start: ws, end: endOfWeek(ws, { weekStartsOn: 0 }) };
    }
    if (viewMode === 'month') return { start: paddedMonthDays[0], end: paddedMonthDays[paddedMonthDays.length - 1] };
    return { start: weekStart, end: weekEnd };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, weekOffset, dayOffset, monthOffset]);

  useEffect(() => {
    if (!profile?.id) return;
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, viewMode, weekOffset, dayOffset, monthOffset]);

  const loadClients = async () => {
    const { data, error } = await supabase
      .from('trainer_clients')
      .select('client_id, profiles!trainer_clients_client_id_fkey(id, full_name, avatar_url)')
      .eq('trainer_id', profile.id)
      .eq('is_active', true);
    if (error) {
      logger.error('TrainerCalendar: loadClients failed:', error);
      showToast(t('trainerCalendar.errorLoadClients', 'Failed to load clients'), 'error');
      setClientsLoaded(true); // unblock the deep-link modal (opens w/o preselect)
      return; // keep prior list
    }
    const nextClients = (data || []).map(tc => tc.profiles).filter(Boolean);
    setClients(nextClients);
    cacheSet(CK_clients, nextClients);
    setClientsLoaded(true);
  };

  const loadWorkoutPlans = async () => {
    const [
      { data: routines, error: routinesError },
      { data: programs, error: programsError },
      { data: plans, error: plansError },
    ] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, created_at')
        .eq('created_by', profile.id)
        .order('name'),
      supabase
        .from('gym_programs')
        .select('id, name, duration_weeks, weeks')
        .eq('gym_id', profile.gym_id)
        .eq('is_published', true)
        .order('name'),
      // The trainer's own custom plans (the actual Plans feature) — per
      // client, so the modal can filter them to the selected client.
      supabase
        .from('trainer_workout_plans')
        .select('id, name, client_id, duration_weeks, weeks, profiles!trainer_workout_plans_client_id_fkey(full_name)')
        .eq('trainer_id', profile.id)
        .eq('is_active', true)
        .order('name'),
    ]);
    if (routinesError) logger.error('TrainerCalendar: loadWorkoutPlans routines failed:', routinesError);
    if (programsError) logger.error('TrainerCalendar: loadWorkoutPlans programs failed:', programsError);
    if (plansError) logger.error('TrainerCalendar: loadWorkoutPlans plans failed:', plansError);
    if (routinesError && programsError && plansError) return; // keep prior list

    const countDays = (weeks) => Object.values(weeks || {})
      .reduce((sum, wk) => sum + (Array.isArray(wk) ? wk.length : 0), 0);
    const mapped = [
      ...(plans || []).map(p => ({
        id: p.id, name: p.name, _type: 'plan',
        _days: countDays(p.weeks) || null,
        _clientId: p.client_id,
        _clientName: p.profiles?.full_name || null,
      })),
      ...(routines || []).map(r => ({ id: r.id, name: r.name, _type: 'routine', _days: null })),
      ...(programs || []).map(p => ({
        id: p.id, name: p.name, _type: 'program',
        _days: countDays(p.weeks) || (p.duration_weeks * 3),
      })),
    ];
    setWorkoutPlans(mapped);
    cacheSet(CK_plans, mapped);
  };

  const loadSessions = async () => {
    setLoading(true);
    const { start, end } = fetchRange;
    const { data, error } = await supabase
      .from('trainer_sessions')
      .select('*, profiles!trainer_sessions_client_id_fkey(id, full_name, avatar_url)')
      .eq('trainer_id', profile.id)
      .gte('scheduled_at', new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0).toISOString())
      .lte('scheduled_at', new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).toISOString())
      .order('scheduled_at', { ascending: true });
    if (error) {
      logger.error('TrainerCalendar: loadSessions failed:', error);
      showToast(t('trainerCalendar.errorLoadSessions', 'Failed to load sessions'), 'error');
      setLoading(false);
      return; // keep prior sessions
    }
    setSessions(data || []);
    cacheSet(CK_sessions, data || []);
    setLoading(false);
  };

  const handleSaved = () => {
    setModal(null);
    loadSessions();
  };

  const handleToday = useCallback(() => {
    if (viewMode === 'day') setDayOffset(0);
    else if (viewMode === 'week') setWeekOffset(0);
    else setMonthOffset(0);
  }, [viewMode]);

  const isAtToday = (viewMode === 'day' && dayOffset === 0)
    || (viewMode === 'week' && weekOffset === 0)
    || (viewMode === 'month' && monthOffset === 0);

  // All day/week/month lists derive from this map. Cancelled sessions are
  // EXCLUDED — they used to occupy day-view hour slots and hide the real
  // booking behind them. (Counters below still read the raw `sessions`.)
  const sessionsByDay = useMemo(() => {
    const map = {};
    sessions.forEach(s => {
      if (s.status === 'cancelled') return;
      const key = format(new Date(s.scheduled_at), 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [sessions]);

  const dayViewSessions = useMemo(() => {
    const key = format(selectedDay, 'yyyy-MM-dd');
    return (sessionsByDay[key] || []).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsByDay, dayOffset]);

  // Upcoming list for the visible month: every non-cancelled session in the
  // anchored month, from "now" forward (so past sessions in earlier months
  // don't pollute "upcoming"). Empty list → render the empty-state message.
  const monthUpcomingSessions = useMemo(() => {
    const now = new Date();
    return sessions
      .filter(s => {
        if (s.status === 'cancelled') return false;
        const dt = new Date(s.scheduled_at);
        if (!isSameMonth(dt, monthAnchor)) return false;
        // For the current month: only future sessions. For future months: all.
        if (monthOffset === 0 && dt < now) return false;
        return true;
      })
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, monthOffset, monthAnchor.getTime()]);

  // ── Counters ──
  const weekCount = useMemo(
    () => sessions.filter(s => s.status !== 'cancelled').length,
    [sessions]
  );
  // Only truly-confirmed sessions — completed ones were inflating this and
  // making "X confirmed" read like pending confirmations that already happened.
  const weekConfirmed = useMemo(
    () => sessions.filter(s => s.status === 'confirmed').length,
    [sessions]
  );
  const weekPending = useMemo(
    () => sessions.filter(s => s.status === 'scheduled').length,
    [sessions]
  );

  // ── Labels ──
  const weekLabel = `${format(weekStart, 'MMM d', { locale: dateFnsLocale })} — ${format(weekEnd, 'MMM d', { locale: dateFnsLocale })}`;
  const dayLabel = format(selectedDay, 'EEE · MMM d', { locale: dateFnsLocale });
  const monthLabel = format(monthAnchor, 'MMMM yyyy', { locale: dateFnsLocale });
  const subLabel = viewMode === 'day' ? dayLabel : viewMode === 'month' ? monthLabel : weekLabel;

  const handleMonthDayClick = (day) => {
    const today = new Date();
    const diff = Math.round((day.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / (1000 * 60 * 60 * 24));
    setDayOffset(diff);
    setViewMode('day');
  };

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

  // ── Day-view hour rows (default 7..19, expanded so early/late sessions still get a row) ──
  const dayHourRows = useMemo(() => {
    let first = 7;
    let last = 19;
    dayViewSessions.forEach(s => {
      const h = new Date(s.scheduled_at).getHours();
      if (h < first) first = h;
      if (h > last) last = h;
    });
    return Array.from({ length: last - first + 1 }, (_, i) => i + first);
  }, [dayViewSessions]);

  // Day timeline summary action ("N · 3h 45m") — count + summed duration of the day's sessions.
  const dayTotalLabel = useMemo(() => {
    const total = dayViewSessions.reduce((sum, s) => sum + (s.duration_mins || 60), 0);
    const h = Math.floor(total / 60);
    const m = total % 60;
    const dur = h > 0
      ? (m > 0 ? `${h}h ${m}m` : `${h}h`)
      : `${m}m`;
    return `${dayViewSessions.length} · ${dur}`;
  }, [dayViewSessions]);

  // Week strip days: in DAY view the strip follows the SELECTED day's week
  // (it used to stay pinned to weekOffset's week, so prev/next-day drifted
  // off the strip and the dots went stale). In week view it's the visible week.
  const stripDays = viewMode === 'day'
    ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selectedDay, { weekStartsOn: 0 }), i))
    : days;
  // Dots come from sessionsByDay (cancelled excluded) — day view now fetches
  // the whole week, so every strip day has real counts.
  const stripCounts = stripDays.map(d => (sessionsByDay[format(d, 'yyyy-MM-dd')] || []).length);
  const stripWeekLabel = `${format(stripDays[0], 'MMM d', { locale: dateFnsLocale })} — ${format(stripDays[6], 'MMM d', { locale: dateFnsLocale })}`;

  // Tone for a session's left edge — group→coach, intake→warn, else status visual.
  const sessionEdgeTone = (s) => {
    if (isGroupTitle(s.title)) return TT.coach;
    if (isIntakeTitle(s.title)) return TT.warn;
    return statusVisuals(s.status).tone;
  };

  // Jump to a specific day in day-view (used by the week strip).
  const selectDay = (day) => {
    const today = new Date();
    const diff = Math.round(
      (day.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime())
      / (1000 * 60 * 60 * 24)
    );
    setDayOffset(diff);
    setViewMode('day');
  };

  return (
    <div style={{ background: TT.bg, minHeight: '100%' }}>
      {/* ─────────────────── MOBILE LAYOUT ─────────────────── */}
      <div className="md:hidden" style={{ padding: '6px 20px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
          <div>
            <TEyebrow color={TT.accent}>{viewMode === 'day' ? stripWeekLabel : weekLabel}</TEyebrow>
            <TPageTitle style={{ fontSize: 30 }}>{t('trainerCalendar.title', 'Calendar')}</TPageTitle>
          </div>
          <TPrimaryButton
            onClick={() => setModal({ date: viewMode === 'day' ? selectedDay : new Date() })}
            style={{ padding: '9px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} strokeWidth={2.4} color="#fff" />
            {t('trainerCalendar.book', 'Book')}
          </TPrimaryButton>
        </div>

        {/* View segmented */}
        <div style={{ marginBottom: 12 }}>
          <TSegmented
            options={[
              { value: 'day',   label: t('trainerCalendar.day', 'Day') },
              { value: 'week',  label: t('trainerCalendar.week', 'Week') },
              { value: 'month', label: t('trainerCalendar.month', 'Month') },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v)}
          />
        </div>

        {/* This week summary */}
        {viewMode === 'week' && weekOffset === 0 && (
          <TCard
            padded={16}
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${TT.accent} 13%, ${TT.surface}) 0%, color-mix(in srgb, ${TT.accent} 19%, ${TT.surface}) 100%)`,
              borderColor: 'transparent',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <TEyebrow color={TT.accentInk}>{t('trainerCalendar.thisWeek', 'This week')}</TEyebrow>
                <div style={{
                  fontFamily: TFont.display, fontSize: 32, fontWeight: 800,
                  color: TT.text, letterSpacing: -1, lineHeight: 1, marginTop: 4,
                }}>
                  {weekCount}<span style={{ fontSize: 14, color: TT.textMute }}> {t('trainerCalendar.sessionsLower', 'sessions')}</span>
                </div>
                <div style={{ fontSize: 11.5, color: TT.accentInk, marginTop: 4, fontWeight: 700 }}>
                  {t('trainerCalendar.heroBreakdown', '{{confirmed}} confirmed · {{pending}} pending', {
                    confirmed: weekConfirmed,
                    pending: weekPending,
                  })}
                </div>
              </div>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: TT.surface2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CalendarIcon size={28} color={TT.accent} strokeWidth={2} />
              </div>
            </div>
          </TCard>
        )}

        {/* Date strip */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <button onClick={handlePrev}
            aria-label={t('pages:trainerCalendar.previous', 'Previous')}
            style={{ background: 'transparent', border: 'none', color: TT.text, padding: 6, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={18} />
          </button>
          <button onClick={handleToday} disabled={isAtToday}
            style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, background: 'transparent', border: 'none',
              cursor: isAtToday ? 'default' : 'pointer',
            }}
          >
            {subLabel}
          </button>
          <button onClick={handleNext}
            aria-label={t('pages:trainerCalendar.next', 'Next')}
            style={{ background: 'transparent', border: 'none', color: TT.text, padding: 6, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Week strip — day picker (week + day views) */}
        {viewMode !== 'month' && (
          <TCard padded={0} style={{ padding: '12px 8px', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
            {stripDays.map((day, i) => {
              const today = isToday(day);
              const selected = viewMode === 'day' && isSameDay(day, selectedDay);
              const on = selected || (viewMode === 'week' && today);
              const count = stripCounts[i] || 0;
              return (
                <button
                  key={format(day, 'yyyy-MM-dd')}
                  type="button"
                  onClick={() => selectDay(day)}
                  aria-label={format(day, 'EEEE d', { locale: dateFnsLocale })}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: TT.textMute }}>
                    {format(day, 'EEEEE', { locale: dateFnsLocale })}
                  </span>
                  <div style={{
                    width: 34, height: 34, borderRadius: 11,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: TFont.display, fontSize: 15, fontWeight: 800,
                    background: on ? 'linear-gradient(180deg,#27B0A0,#178C7E)' : 'transparent',
                    color: on ? '#fff' : TT.text,
                    boxShadow: on ? '0 4px 10px -3px rgba(10,90,82,.5), inset 0 1px 0 rgba(255,255,255,.28)' : 'none',
                  }}>
                    {format(day, 'd')}
                  </div>
                  {count > 0 && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      {Array.from({ length: Math.min(count, 4) }).map((_, k) => (
                        <span key={k} style={{
                          width: 4, height: 4, borderRadius: 999,
                          background: on ? TT.accent : TT.textMute,
                        }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </TCard>
        )}

        {/* WEEK VIEW */}
        {viewMode === 'week' && (
          <>
            {loading ? (
              <div className="space-y-3">
                {[0,1,2,3,4].map(i => (
                  <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: TT.surface2 }} />
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {days.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dSessions = (sessionsByDay[key] || [])
                    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
                  const today = isToday(day);
                  return (
                    <TCard key={key} padded={14} style={today ? { boxShadow: `inset 3px 0 0 ${TT.accent}, ${TT.shadow}` } : {}}>
                      <div style={{
                        display: 'flex', alignItems: 'baseline', gap: 10,
                        marginBottom: dSessions.length ? 10 : 0,
                      }}>
                        <div style={{
                          fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
                          color: today ? TT.accent : TT.text, letterSpacing: -0.3,
                        }}>
                          {format(day, 'EEE d', { locale: dateFnsLocale })}
                        </div>
                        <div style={{ flex: 1, fontSize: 11, color: TT.textMute }}>
                          {dSessions.length} {dSessions.length === 1 ? t('trainerCalendar.sessionSingular', 'session') : t('trainerCalendar.sessionsLower', 'sessions')}
                        </div>
                        <button
                          onClick={() => setModal({ date: day })}
                          aria-label={t('trainerCalendar.addSession', 'Add session')}
                          style={{ background: 'transparent', border: 'none', color: TT.textMute, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Plus size={14} strokeWidth={2} />
                        </button>
                      </div>

                      {dSessions.length === 0 ? (
                        <div style={{ fontSize: 11, color: TT.textFaint, fontStyle: 'italic' }}>
                          {t('trainerCalendar.tapToAdd', '+ tap to add')}
                        </div>
                      ) : (
                        dSessions.map((s, j) => {
                          const start = new Date(s.scheduled_at);
                          const dur = s.duration_mins || 60;
                          const now = new Date();
                          const sEnd = new Date(start.getTime() + dur * 60000);
                          const isNow = today && now >= start && now <= sEnd;
                          const isGroup = isGroupTitle(s.title);
                          const isIntake = isIntakeTitle(s.title);
                          const pillTone = isGroup ? 'coach' : isIntake ? 'warn' : 'teal';
                          const fullName = s.profiles?.full_name || t('trainerCalendar.client', 'Client');
                          return (
                            <button
                              key={s.id}
                              onClick={() => setModal({ session: s })}
                              style={{
                                width: '100%',
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '8px 10px', borderRadius: 10,
                                background: isNow ? `${TT.accent}15` : TT.surface2,
                                marginTop: j > 0 ? 4 : 0,
                                border: isNow ? `1px solid ${TT.accent}` : '1px solid transparent',
                                textAlign: 'left', cursor: 'pointer',
                              }}
                            >
                              <div style={{
                                fontSize: 11, fontFamily: TFont.mono, fontWeight: 800,
                                color: isNow ? TT.accentInk : TT.text, minWidth: 56,
                              }}>
                                {format(start, 'HH:mm')}
                              </div>
                              <TAvatar
                                name={fullName}
                                size={24}
                                idx={avatarIdx(s.profiles?.id || s.client_id)}
                                src={s.profiles?.avatar_url}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: TT.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {fullName}
                                </div>
                                {s.details?.workout_name && (
                                  <div style={{ marginTop: 2 }}>
                                    <WorkoutChip name={s.details.workout_name} />
                                  </div>
                                )}
                              </div>
                              <TPill tone={pillTone} size="s">
                                {isGroup ? t('trainerCalendar.kindGroup', 'Group')
                                  : isIntake ? t('trainerCalendar.kindIntake', 'Intake')
                                  : t('trainerCalendar.kind1on1', '1-on-1')}
                              </TPill>
                              {isNow && <TPill tone="hot" size="s">{t('trainerCalendar.now', 'NOW')}</TPill>}
                            </button>
                          );
                        })
                      )}
                    </TCard>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* DAY VIEW — timeline */}
        {viewMode === 'day' && (
          <>
            <TSectionHeader
              title={format(selectedDay, 'EEEE · MMM d', { locale: dateFnsLocale })}
              action={dayViewSessions.length ? dayTotalLabel : undefined}
            />
            {loading ? (
              <div className="space-y-2.5">
                {[0,1,2,3].map(i => (
                  <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: TT.surface2 }} />
                ))}
              </div>
            ) : dayViewSessions.length === 0 ? (
              <TCard padded={16}>
                <div style={{ textAlign: 'center', fontSize: 13, color: TT.textSub, padding: '14px 8px' }}>
                  {t('trainerCalendar.noSessionsThisDay', 'No sessions this day')}
                </div>
              </TCard>
            ) : (
              <div style={{ position: 'relative', paddingLeft: 6 }}>
                {dayHourRows.map((h) => {
                  const slot = setMinutes(setHours(selectedDay, h), 0);
                  const slotEnd = setMinutes(setHours(selectedDay, h + 1), 0);
                  // ALL sessions in this hour — .find() used to render only the
                  // first and silently swallow the rest.
                  const slotSessions = dayViewSessions.filter(s => {
                    const st = new Date(s.scheduled_at);
                    return st >= slot && st < slotEnd;
                  });
                  if (slotSessions.length === 0) return null;
                  return slotSessions.map((session) => {
                    const start = new Date(session.scheduled_at);
                    const now = new Date();
                    const dur = session.duration_mins || 60;
                    const end = new Date(start.getTime() + dur * 60000);
                    const isCurrent = isSameDay(selectedDay, now) && now >= start && now <= end;
                    const tone = sessionEdgeTone(session);
                    const fullName = session.profiles?.full_name || t('trainerCalendar.client', 'Client');
                    return (
                      <div key={session.id} style={{ display: 'flex', gap: 13, marginBottom: 10 }}>
                        <div style={{ width: 46, flexShrink: 0, textAlign: 'right', paddingTop: 15 }}>
                          <div style={{ fontFamily: TFont.display, fontSize: 13.5, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>
                            {format(start, 'h:mm')}
                          </div>
                          <div style={{ fontSize: 10, color: TT.textMute, fontWeight: 700 }}>
                            {format(start, 'a')}
                          </div>
                        </div>
                        <TCard
                          padded={0}
                          onClick={() => setModal({ session })}
                          className="tt-tap"
                          style={{
                            flex: 1, minWidth: 0, padding: '12px 14px',
                            display: 'flex', alignItems: 'center', gap: 11,
                            boxShadow: `inset 3px 0 0 ${tone}, ${TT.shadow}`,
                            cursor: 'pointer', position: 'relative',
                          }}
                        >
                          {isCurrent && (
                            <div style={{
                              position: 'absolute', top: 8, right: 10,
                              fontSize: 9, fontWeight: 800, color: TT.hot,
                              letterSpacing: 1, textTransform: 'uppercase',
                            }}>{t('trainerCalendar.nowIndicator', '↓ NOW')}</div>
                          )}
                          <TAvatar name={fullName} size={36} idx={avatarIdx(session.profiles?.id || session.client_id)} src={session.profiles?.avatar_url} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: TT.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {fullName}
                            </div>
                            <div style={{ fontSize: 11.5, color: TT.textSub, marginTop: 1 }}>
                              {session.title} · {session.duration_mins}{t('trainerCalendar.minShort', 'm')}
                            </div>
                            {session.details?.workout_name && (
                              <div style={{ marginTop: 4 }}>
                                <WorkoutChip name={session.details.workout_name} />
                              </div>
                            )}
                          </div>
                          <ChevronRight size={15} color={TT.textMute} />
                        </TCard>
                      </div>
                    );
                  });
                })}
              </div>
            )}
          </>
        )}

        {/* MONTH VIEW */}
        {viewMode === 'month' && (
          <TCard padded={14}>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 4, marginBottom: 6,
            }}>
              {DAY_NAMES.map((name, i) => (
                <div key={i} style={{
                  textAlign: 'center', fontSize: 9.5, fontWeight: 800,
                  color: TT.textMute, letterSpacing: 0.6,
                }}>{name[0]}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {paddedMonthDays.map((day, idx) => {
                const key = format(day, 'yyyy-MM-dd');
                const inMonth = isSameMonth(day, monthAnchor);
                const today = isToday(day);
                const dSessions = sessionsByDay[key] || [];
                const count = dSessions.length;
                return (
                  <button
                    key={key + idx}
                    onClick={() => handleMonthDayClick(day)}
                    style={{
                      aspectRatio: '1', borderRadius: 8,
                      background: today ? TT.accent : count > 0 ? TT.accentSoft : TT.surface2,
                      color: today ? '#06363B' : TT.text,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: today ? 800 : 600,
                      position: 'relative',
                      border: 'none', cursor: 'pointer',
                      opacity: inMonth ? 1 : 0.3,
                    }}
                  >
                    {format(day, 'd')}
                    {count > 0 && !today && (
                      <div style={{ display: 'flex', gap: 1.5, marginTop: 2 }}>
                        {Array.from({ length: Math.min(count, 3) }).map((_, j) => (
                          <div key={j} style={{
                            width: 3, height: 3, borderRadius: 999, background: TT.accent,
                          }} />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </TCard>
        )}

        {/* MONTH VIEW — upcoming sessions list */}
        {viewMode === 'month' && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
              color: TT.text, letterSpacing: -0.2, marginBottom: 8, padding: '0 2px',
            }}>
              {/* Past months list everything that happened — calling those
                  "upcoming" was wrong. */}
              {monthOffset < 0
                ? t('trainerCalendar.sessionsThisMonth', 'Sessions this month')
                : t('trainerCalendar.upcomingThisMonth', 'Upcoming this month')} · {monthUpcomingSessions.length}
            </div>
            {monthUpcomingSessions.length === 0 ? (
              <TCard padded={16}>
                <div style={{
                  textAlign: 'center', fontSize: 13, color: TT.textSub,
                  padding: '14px 8px',
                }}>
                  {monthOffset < 0
                    ? t('trainerCalendar.noSessionsThisMonth', 'No sessions this month')
                    : t('trainerCalendar.noUpcomingThisMonth', 'No upcoming sessions this month')}
                </div>
              </TCard>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {monthUpcomingSessions.map((s) => {
                  const dt = new Date(s.scheduled_at);
                  const clientName = s.profiles?.full_name
                    || s.client?.full_name
                    || t('trainerCalendar.unknownClient', 'Client');
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setModal({ session: s })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', borderRadius: 12,
                        background: TT.surface2, border: 'none', cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{
                        flex: '0 0 56px', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        background: TT.accentSoft, borderRadius: 10,
                        padding: '6px 4px',
                      }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: TT.accent, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                          {format(dt, 'MMM', { locale: dateFnsLocale })}
                        </div>
                        <div style={{ fontFamily: TFont.display, fontSize: 18, fontWeight: 800, color: TT.text, lineHeight: 1 }}>
                          {format(dt, 'd')}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: TT.text, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {clientName}
                        </div>
                        <div style={{ fontSize: 11, color: TT.textSub }}>
                          {format(dt, 'EEE · h:mm a', { locale: dateFnsLocale })}
                          {s.duration_mins ? ` · ${s.duration_mins}m` : ''}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 700,
                        color: s.status === 'confirmed' ? TT.accent : TT.textSub,
                        textTransform: 'uppercase', letterSpacing: 0.6,
                      }}>
                        {t(`trainerCalendar.status.${s.status}`, s.status)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─────────────────── DESKTOP LAYOUT ─────────────────── */}
      <div className="hidden md:block">
        <main style={{ padding: '24px 28px 32px', maxWidth: 1280, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <TEyebrow>{t('trainerCalendar.accentLabel', 'Schedule')}</TEyebrow>
              <div style={{
                fontFamily: TFont.display, fontSize: 32, fontWeight: 800,
                color: TT.text, letterSpacing: -1.2, lineHeight: 1.05, marginTop: 6,
              }}>
                {t('trainerCalendar.title', 'Calendar')}
              </div>
              <div style={{ fontSize: 13, color: TT.textSub, marginTop: 4 }}>
                {t('trainerCalendar.heroBreakdown', '{{confirmed}} confirmed · {{pending}} pending', {
                  confirmed: weekConfirmed, pending: weekPending,
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 240 }}>
                <TSegmented
                  options={[
                    { value: 'day',   label: t('trainerCalendar.day', 'Day') },
                    { value: 'week',  label: t('trainerCalendar.week', 'Week') },
                    { value: 'month', label: t('trainerCalendar.month', 'Month') },
                  ]}
                  value={viewMode}
                  onChange={setViewMode}
                />
              </div>
              <button
                onClick={() => setModal({ date: viewMode === 'day' ? selectedDay : new Date() })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px', borderRadius: 12,
                  background: TT.accent, color: '#06363B',
                  fontFamily: TFont.display, fontWeight: 800, fontSize: 13,
                  border: 'none', minHeight: 44, cursor: 'pointer',
                }}
              >
                <Plus size={15} strokeWidth={2.4} />
                {t('trainerCalendar.newSession', 'New Session')}
              </button>
            </div>
          </div>

          {/* Sub-nav: prev / label / next / today */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <button onClick={handlePrev}
              aria-label={t('pages:trainerCalendar.previous', 'Previous')}
              style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 10, padding: 8, color: TT.text, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text }}>
              {subLabel}
            </div>
            <button onClick={handleNext}
              aria-label={t('pages:trainerCalendar.next', 'Next')}
              style={{ background: TT.surface, border: `1px solid ${TT.borderSolid}`, borderRadius: 10, padding: 8, color: TT.text, minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <ChevronRight size={18} />
            </button>
            <button onClick={handleToday} disabled={isAtToday}
              style={{
                padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800,
                background: isAtToday ? TT.surface2 : TT.text,
                color: isAtToday ? TT.textMute : TT.onInverse,
                border: 'none', minHeight: 36, cursor: isAtToday ? 'default' : 'pointer',
                opacity: isAtToday ? 0.6 : 1,
              }}
            >
              {t('trainerCalendar.today', 'Today')}
            </button>
          </div>

          {/* Two-column when day/week, single col for month */}
          {viewMode === 'month' ? (
            <TCard padded={14}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 8 }}>
                {DAY_NAMES.map((name) => (
                  <div key={name} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: TT.textMute, letterSpacing: 1 }}>{name}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                {paddedMonthDays.map((day, idx) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const inMonth = isSameMonth(day, monthAnchor);
                  const today = isToday(day);
                  const dSessions = sessionsByDay[key] || [];
                  const count = dSessions.length;
                  return (
                    <button
                      key={key + idx}
                      onClick={() => handleMonthDayClick(day)}
                      style={{
                        aspectRatio: '1.4', borderRadius: 10,
                        background: today ? TT.accent : count > 0 ? TT.accentSoft : TT.surface2,
                        color: today ? '#06363B' : TT.text,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'flex-start', justifyContent: 'flex-start',
                        padding: '6px 8px',
                        fontSize: 13, fontWeight: today ? 800 : 600,
                        border: 'none', cursor: 'pointer', opacity: inMonth ? 1 : 0.4,
                        textAlign: 'left',
                      }}
                    >
                      <span>{format(day, 'd')}</span>
                      {count > 0 && (
                        <div style={{ marginTop: 'auto', fontSize: 10, fontWeight: 700, color: today ? '#06363B' : TT.accentInk }}>
                          {count} {count === 1 ? t('trainerCalendar.sessionSingular', 'session') : t('trainerCalendar.sessionsLower', 'sessions')}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </TCard>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
              {/* Main calendar pane */}
              <TCard padded={0}>
                {viewMode === 'week' && (
                  <div>
                    {loading ? (
                      <div className="p-4 space-y-3">
                        {[0,1,2,3,4].map(i => (
                          <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: TT.surface2 }} />
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {days.map((day, di) => {
                          const key = format(day, 'yyyy-MM-dd');
                          const dSessions = (sessionsByDay[key] || [])
                            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
                          const today = isToday(day);
                          return (
                            <div key={key} style={{
                              padding: '14px 18px',
                              borderTop: di > 0 ? `1px solid ${TT.border}` : 'none',
                              borderLeft: today ? `3px solid ${TT.accent}` : '3px solid transparent',
                            }}>
                              <div style={{
                                display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: dSessions.length ? 8 : 0,
                              }}>
                                <div style={{
                                  fontFamily: TFont.display, fontSize: 14, fontWeight: 800,
                                  color: today ? TT.accent : TT.text, letterSpacing: -0.3,
                                }}>
                                  {format(day, 'EEE d', { locale: dateFnsLocale })}
                                </div>
                                <div style={{ flex: 1, fontSize: 11, color: TT.textMute }}>
                                  {dSessions.length} {dSessions.length === 1 ? t('trainerCalendar.sessionSingular', 'session') : t('trainerCalendar.sessionsLower', 'sessions')}
                                </div>
                                <button
                                  onClick={() => setModal({ date: day })}
                                  aria-label={t('trainerCalendar.addSession', 'Add session')}
                                  style={{ background: 'transparent', border: 'none', color: TT.textMute, cursor: 'pointer' }}
                                >
                                  <Plus size={14} strokeWidth={2} />
                                </button>
                              </div>
                              {dSessions.length === 0 ? (
                                <div style={{ fontSize: 11, color: TT.textFaint, fontStyle: 'italic' }}>
                                  {t('trainerCalendar.tapToAdd', '+ tap to add')}
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {dSessions.map(s => {
                                    const start = new Date(s.scheduled_at);
                                    const fullName = s.profiles?.full_name || t('trainerCalendar.client', 'Client');
                                    return (
                                      <button
                                        key={s.id}
                                        onClick={() => setModal({ session: s })}
                                        style={{
                                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                                          padding: '8px 10px', borderRadius: 10,
                                          background: TT.surface2, border: '1px solid transparent',
                                          textAlign: 'left', cursor: 'pointer',
                                        }}
                                      >
                                        <div style={{ fontSize: 11, fontFamily: TFont.mono, fontWeight: 800, color: TT.text, minWidth: 56 }}>
                                          {format(start, 'HH:mm')}
                                        </div>
                                        <TAvatar name={fullName} size={24}
                                          idx={avatarIdx(s.profiles?.id || s.client_id)}
                                          src={s.profiles?.avatar_url} />
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: TT.text }}>
                                            {fullName}
                                          </span>
                                          {s.details?.workout_name && (
                                            <WorkoutChip name={s.details.workout_name} />
                                          )}
                                        </div>
                                        <span style={{ fontSize: 11, color: TT.textMute, fontFamily: TFont.mono }}>
                                          {s.duration_mins}{t('trainerCalendar.minShort', 'm')}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {viewMode === 'day' && (
                  <div>
                    {dayHourRows.map((h, i) => {
                      const slot = setMinutes(setHours(selectedDay, h), 0);
                      const slotEnd = setMinutes(setHours(selectedDay, h + 1), 0);
                      // ALL sessions in this hour — .find() rendered only one.
                      const slotSessions = dayViewSessions.filter(s => {
                        const st = new Date(s.scheduled_at);
                        return st >= slot && st < slotEnd;
                      });
                      const now = new Date();
                      return (
                        <div key={h} style={{
                          display: 'flex', gap: 16,
                          padding: '10px 18px',
                          borderTop: i > 0 ? `1px solid ${TT.border}` : 'none',
                          alignItems: 'flex-start', minHeight: 56,
                        }}>
                          <div style={{
                            width: 50, fontSize: 11, fontFamily: TFont.mono,
                            color: TT.textMute, fontWeight: 700, paddingTop: 4,
                          }}>
                            {h % 12 === 0 ? 12 : h % 12}{h >= 12 ? t('trainerCalendar.pm', 'pm') : t('trainerCalendar.am', 'am')}
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {slotSessions.map((session) => {
                              const start = new Date(session.scheduled_at);
                              const dur = session.duration_mins || 60;
                              const end = new Date(start.getTime() + dur * 60000);
                              const isCurrent = isSameDay(selectedDay, now) && now >= start && now <= end;
                              const visuals = statusVisuals(session.status);
                              return (
                                <button
                                  key={session.id}
                                  onClick={() => setModal({ session })}
                                  style={{
                                    width: '100%', padding: '10px 14px', borderRadius: 10,
                                    background: visuals.soft,
                                    border: '1px solid transparent',
                                    boxShadow: `inset 3px 0 0 ${visuals.tone}`,
                                    position: 'relative', textAlign: 'left', cursor: 'pointer',
                                  }}
                                >
                                  {isCurrent && (
                                    <div style={{
                                      position: 'absolute', top: 8, right: 10,
                                      fontSize: 9, fontWeight: 800, color: TT.hot,
                                      letterSpacing: 1, textTransform: 'uppercase',
                                    }}>{t('trainerCalendar.nowIndicator', '↓ NOW')}</div>
                                  )}
                                  <div style={{ fontSize: 13, fontWeight: 800, color: TT.text }}>
                                    {session.profiles?.full_name || t('trainerCalendar.client', 'Client')}
                                  </div>
                                  <div style={{ fontSize: 11, color: TT.textSub, marginTop: 2 }}>
                                    {format(start, 'HH:mm')} · {session.title} · {session.duration_mins}{t('trainerCalendar.minShort', 'm')}
                                  </div>
                                  {session.details?.workout_name && (
                                    <div style={{ marginTop: 5 }}>
                                      <WorkoutChip name={session.details.workout_name} />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TCard>

              {/* Selected day detail rail. When browsing another week, focus
                  the FIRST day of the visible week — focusing "today" (which
                  isn't in the fetched range) made the rail always-empty. */}
              <TCard padded={0}>
                {(() => {
                  const railDay = viewMode === 'day'
                    ? selectedDay
                    : (weekOffset === 0 ? new Date() : weekStart);
                  return (
                    <>
                <div style={{ padding: '14px 18px', borderBottom: `1px solid ${TT.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <TEyebrow>{t('trainerCalendar.dayDetail', 'Day detail')}</TEyebrow>
                    <div style={{
                      fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
                      color: TT.text, letterSpacing: -0.3, marginTop: 4,
                    }}>
                      {format(railDay, 'EEE · MMM d', { locale: dateFnsLocale })}
                    </div>
                  </div>
                  <button
                    onClick={() => setModal({ date: railDay })}
                    aria-label={t('trainerCalendar.addSession', 'Add session')}
                    style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: TT.accentSoft, color: TT.accentInk,
                      border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Plus size={16} strokeWidth={2.4} />
                  </button>
                </div>
                {(() => {
                  const focusKey = format(railDay, 'yyyy-MM-dd');
                  const focusSessions = (sessionsByDay[focusKey] || [])
                    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
                  if (focusSessions.length === 0) {
                    return (
                      <div style={{ padding: '24px 18px', fontSize: 12.5, color: TT.textMute }}>
                        {t('trainerCalendar.noSessionsThisDay', 'No sessions this day')}
                      </div>
                    );
                  }
                  return focusSessions.map((s, i) => {
                    const visuals = statusVisuals(s.status);
                    const fullName = s.profiles?.full_name || t('trainerCalendar.client', 'Client');
                    return (
                      <button
                        key={s.id}
                        onClick={() => setModal({ session: s })}
                        style={{
                          width: '100%',
                          padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
                          borderBottom: i < focusSessions.length - 1 ? `1px solid ${TT.border}` : 'none',
                          borderLeft: `3px solid ${visuals.tone}`,
                          background: 'transparent', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <TAvatar name={fullName} size={32} idx={avatarIdx(s.profiles?.id || s.client_id)} src={s.profiles?.avatar_url} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: TT.text }}>{fullName}</div>
                          <div style={{ fontSize: 11, color: TT.textSub, marginTop: 1 }}>
                            {format(new Date(s.scheduled_at), 'HH:mm')} · {s.duration_mins}{t('trainerCalendar.minShort', 'm')} · {s.title}
                          </div>
                        </div>
                      </button>
                    );
                  });
                })()}
                    </>
                  );
                })()}
              </TCard>
            </div>
          )}
        </main>
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
          workoutPlans={workoutPlans}
          presetClientId={modal.presetClientId}
        />
      )}
    </div>
  );
}
