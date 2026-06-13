import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Clock, Users, CalendarCheck, Dumbbell, Star, X, ListChecks, Share2, Check, Hourglass, Calendar } from 'lucide-react';
import { usePostHog } from '@posthog/react';
import EmptyState from '../components/EmptyState';
import UserAvatar from '../components/UserAvatar';
import FeatureDisabledScreen from '../components/FeatureDisabledScreen';
import { useFeatureEnabled } from '../hooks/usePlatformFlags';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { classImageUrl } from '../lib/classImageUrl';
import { PROD_WEB_URL } from '../lib/appUrls';
import { format, addDays, startOfWeek, isSameDay, subDays, addWeeks } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import posthogClient from 'posthog-js';

const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const fmtTime = (timeStr, use24h) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h, 10);
  if (use24h) return `${hour}:${m}`;
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
};

const durationMinutes = (start, end) => {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
};

// Resolve class instructors in a second step: the `trainer:profiles!trainer_id`
// embed is RLS-nulled for members (staff profile rows aren't directly
// readable), which made the instructor line vanish from class cards. The
// same-gym gym_member_profiles_safe view has no role filter, so trainer rows
// come through it; attach them under the `trainer` key the renders already
// expect (mutates each row's gym_classes in place to preserve shape).
// `getClass` maps a fetched row to its gym_classes object.
const attachClassTrainers = async (rows, getClass) => {
  const classes = (rows || []).map(getClass).filter(Boolean);
  const ids = [...new Set(classes.map((c) => c.trainer_id).filter(Boolean))];
  if (!ids.length) return;
  const { data } = await supabase
    .from('gym_member_profiles_safe')
    .select('id, full_name, avatar_url, avatar_type, avatar_value, role')
    .in('id', ids);
  const byId = {};
  (data || []).forEach((p) => { byId[p.id] = p; });
  classes.forEach((c) => { c.trainer = byId[c.trainer_id] ?? null; });
};

/* ---------- Star Rating Component ---------- */
function StarRating({ value, onChange, size = 28, readOnly = false }) {
  const { t } = useTranslation('pages');
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(star)}
          className={`transition-transform ${readOnly ? '' : 'active:scale-110'}`}
          aria-label={t('classes.starRating', { count: star, defaultValue: '{{count}} star', defaultValue_plural: '{{count}} stars' })}
        >
          <Star
            size={size}
            fill={star <= value ? '#D4AF37' : 'transparent'}
            stroke={star <= value ? '#D4AF37' : 'var(--color-text-faint)'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

/* ---------- Class Rating Modal ---------- */
function ClassRatingModal({ open, onClose, bookingId, className: classTitle, onSubmitted }) {
  const { t } = useTranslation('pages');
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    setError('');
    const { error: updErr } = await supabase
      .from('gym_class_bookings')
      .update({ rating, notes: notes.trim() || null })
      .eq('id', bookingId);
    setSubmitting(false);
    if (updErr) {
      // Keep the modal open so the member can retry — don't fire onSubmitted
      // (which reloads and hides the rate button as if it succeeded).
      setError(t('classes.rateError', "Couldn't save your rating. Try again."));
      return;
    }
    posthogClient?.capture('class_rated', { rating });
    onSubmitted?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-rating-title"
        className="w-full max-w-[360px] rounded-2xl p-6 space-y-5"
        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 id="class-rating-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('classes.rateTitle')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={t('classes.close', { defaultValue: 'Close' })}
          >
            <X size={20} />
          </button>
        </div>

        {/* Class name */}
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-accent)' }}>{classTitle}</p>

        {/* Stars */}
        <div className="flex justify-center py-2">
          <StarRating value={rating} onChange={setRating} size={36} />
        </div>

        {/* Note input */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('classes.addNote')}
          aria-label={t('classes.addNote')}
          rows={3}
          className="w-full rounded-xl px-4 py-3 text-[13px] resize-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{
            backgroundColor: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-default)',
          }}
        />

        {/* Error */}
        {error && (
          <p className="text-[12px] text-center" style={{ color: 'var(--color-danger)' }}>{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full py-3 rounded-xl text-[14px] font-bold transition-all active:scale-[0.97] min-h-[44px] disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
        >
          {submitting ? t('classes.submitting', 'Submitting…') : t('classes.submit')}
        </button>
      </div>
    </div>
  );
}

/* ---------- Workout Prompt Modal ---------- */
function WorkoutPromptModal({ open, onClose, onStartWorkout, onJustCheckIn }) {
  const { t } = useTranslation('pages');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workout-prompt-title"
        className="w-full max-w-[360px] rounded-2xl p-6 space-y-5"
        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
            <Dumbbell size={20} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h3 id="workout-prompt-title" className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('classes.hasWorkout')}
          </h3>
        </div>

        <div className="space-y-3">
          <button
            onClick={onStartWorkout}
            className="w-full py-3 rounded-xl text-[14px] font-bold transition-all active:scale-[0.97] min-h-[44px]"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {t('classes.startWorkout')}
          </button>
          <button
            onClick={onJustCheckIn}
            className="w-full py-3 rounded-xl text-[14px] font-bold transition-all active:scale-[0.97] min-h-[44px]"
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-default)',
            }}
          >
            {t('classes.justCheckIn')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Skeleton placeholder ---------- */
function ClassSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden animate-pulse" style={{ backgroundColor: 'var(--color-bg-card)', height: 180 }}>
      <div className="h-full w-full" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
    </div>
  );
}

/* ---------- Month grid (calendar) ---------- */
function MonthGridView({ anchor, today, allSchedules, dayLabels, dateFnsLocale, onSelectDate, onShiftMonth, onJumpToday, isCurrentMonth, t }) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  // Pad with leading blank days to align the month start to a Sunday-based grid.
  const startDow = monthStart.getDay(); // 0 = Sun
  const daysInMonth = monthEnd.getDate();
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d));
  // Pad trailing so the grid is multiple of 7.
  while (cells.length % 7 !== 0) cells.push(null);

  // Per-DOW + specific-date class indicators. The dot turns on either when
  // there's a recurring schedule for that DOW or a one-off on that exact date.
  const countsByDow = useMemo(() => {
    const m = [0, 0, 0, 0, 0, 0, 0];
    allSchedules.forEach((s) => { if (!s.specific_date && typeof s.day_of_week === 'number') m[s.day_of_week] += 1; });
    return m;
  }, [allSchedules]);
  const specificDateSet = useMemo(() => {
    const s = new Set();
    allSchedules.forEach((sc) => { if (sc.specific_date) s.add(sc.specific_date); });
    return s;
  }, [allSchedules]);

  const monthLabel = format(monthStart, 'MMMM yyyy', dateFnsLocale);
  const todayKey = format(today, 'yyyy-MM-dd');

  return (
    <div className="rounded-2xl p-3 space-y-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => onShiftMonth(-1)}
          aria-label={t('classes.prevMonth', { defaultValue: 'Mes anterior' })}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={onJumpToday}
          className="text-[13px] font-bold capitalize tracking-wide hover:underline transition-opacity"
          style={{ color: isCurrentMonth ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
          aria-label={t('classes.jumpToToday', { defaultValue: 'Hoy' })}
        >
          {monthLabel}
        </button>
        <button
          type="button"
          onClick={() => onShiftMonth(1)}
          aria-label={t('classes.nextMonth', { defaultValue: 'Mes siguiente' })}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ChevronLeft size={18} className="rotate-180" />
        </button>
      </div>

      {/* DOW header row */}
      <div className="grid grid-cols-7 gap-1 px-1">
        {dayLabels.map((lbl, i) => (
          <div
            key={i}
            className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-center"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {lbl}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1 px-1">
        {cells.map((d, idx) => {
          if (!d) return <div key={`pad-${idx}`} />;
          const key = format(d, 'yyyy-MM-dd');
          const isToday = key === todayKey;
          const hasClasses = countsByDow[d.getDay()] > 0 || specificDateSet.has(key);
          const isPast = key < todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(d)}
              className="relative aspect-square rounded-lg flex flex-col items-center justify-center transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              style={{
                background: isToday ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)' : 'transparent',
                border: isToday ? '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)' : '1px solid transparent',
              }}
            >
              <span
                className="text-[14px] font-bold tabular-nums"
                style={{
                  color: isToday ? 'var(--color-accent)' : 'var(--color-text-primary)',
                  opacity: isPast && !isToday ? 0.45 : 1,
                }}
              >
                {d.getDate()}
              </span>
              {hasClasses && (
                <span
                  className="absolute bottom-1.5 w-1 h-1 rounded-full"
                  style={{ background: isToday ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Class detail — "Cinematic" bottom sheet (design: Class Modal A)
   Full-bleed hero, tags+title over the photo, fact strip,
   instructor row, capacity, sticky action bar. Slides up over a
   blurred scrim; closes via ✕, scrim tap, or Esc.
   ============================================================ */
const CFD = '"Archivo","Familjen Grotesk",system-ui,sans-serif';   // display
const CFB = '"Familjen Grotesk",-apple-system,system-ui,sans-serif'; // body
const CFM = '"JetBrains Mono","SF Mono",ui-monospace,monospace';     // mono
const GOLD = '#D4AF37';

/* status pill (gold available · accent booked · danger full · muted passed) */
function ClassStatusPill({ stateKey, accent, t, waitlistPos }) {
  const map = {
    available: { txt: t('classes.statusAvailable', 'Disponible'), c: GOLD, bg: 'rgba(212,175,55,0.15)', ln: 'rgba(212,175,55,0.4)' },
    booked:    { txt: t('classes.booked', 'Reservada'), c: accent, bg: `color-mix(in srgb, ${accent} 13%, transparent)`, ln: `color-mix(in srgb, ${accent} 32%, transparent)`, check: true },
    waitlisted:{ txt: t('classes.waitlistedShort', { position: waitlistPos || 1, defaultValue: `Lista · #${waitlistPos || 1}` }), c: '#F59E0B', bg: 'rgba(245,158,11,0.15)', ln: 'rgba(245,158,11,0.35)' },
    full:      { txt: t('classes.full', 'Llena'), c: 'var(--color-danger)', bg: 'rgba(240,99,75,0.12)', ln: 'rgba(240,99,75,0.34)' },
    attended:  { txt: t('classes.attended', 'Asistida'), c: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)', ln: 'color-mix(in srgb, var(--color-success) 32%, transparent)', check: true },
    passed:    { txt: t('classes.statusFinished', 'Finalizada'), c: 'var(--color-text-muted)', bg: 'rgba(255,255,255,0.06)', ln: 'rgba(255,255,255,0.09)' },
  };
  const s = map[stateKey] || map.available;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px',
      background: s.bg, border: `1px solid ${s.ln}`, borderRadius: 999,
      fontFamily: CFB, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: s.c }}>
      {s.check && <Check size={12} strokeWidth={2.6} />}
      {s.txt}
    </span>
  );
}

/* gold category tag (Workout — only when the class carries a template) */
function ClassCatTag({ t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px 6px 10px',
      background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.4)', borderRadius: 999,
      fontFamily: CFB, fontSize: 12.5, fontWeight: 800, letterSpacing: 0.2, color: GOLD }}>
      <Dumbbell size={14} strokeWidth={2.2} />
      {t('classes.hasWorkout', { defaultValue: 'Workout' }).split(' ').slice(-1)[0]}
    </span>
  );
}

/* round glass control over the hero photo */
function GlassCircleBtn({ children, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(10,12,14,0.5)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0, color: '#fff' }}>
      {children}
    </button>
  );
}

/* one cell of the fact strip */
function SheetFact({ icon, label, value, accent }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', textAlign: 'center' }}>
      <span style={{ color: accent, display: 'grid', placeItems: 'center' }}>{icon}</span>
      <span style={{ fontFamily: CFM, fontSize: 9.5, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontFamily: CFD, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  );
}

function ClassDetailSheet({ data, onClose, t, isEs, fmt, dateFnsLocale, bookingCounts, todayStr,
  actionLoading, onBook, onCancel, onCheckIn, onRate, navigate, gymName }) {
  const { sched, cls, booking, dateStr } = data;
  const [vis, setVis] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setVis(true)); return () => cancelAnimationFrame(id); }, []);
  const close = useCallback(() => { setVis(false); setTimeout(onClose, 420); }, [onClose]);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);

  // Friends with a confirmed booking for this slot (SECURITY DEFINER RPC,
  // 0552 — bookings RLS is own-only for members). Hidden quietly if the RPC
  // isn't applied yet or errors.
  const [friends, setFriends] = useState([]);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_class_friend_attendees', { p_schedule_id: sched.id, p_booking_date: dateStr })
      .then(({ data: rows, error }) => {
        if (!cancelled) setFriends(error ? [] : (rows || []));
      })
      .catch(() => { if (!cancelled) setFriends([]); });
    return () => { cancelled = true; };
  }, [sched.id, dateStr]);

  const imgUrl = classImageUrl(cls.image_path);
  const dur = durationMinutes(sched.start_time, sched.end_time);
  const accent = cls.color || cls.accent_color || 'var(--color-accent)';
  const count = bookingCounts[sched.id] || 0;
  const capacity = sched.override_capacity || cls.max_capacity || 30;
  const left = Math.max(0, capacity - count);
  const status = booking?.status;
  const isToday = dateStr === todayStr;
  const isFuture = dateStr > todayStr;
  let isPastClass = dateStr < todayStr;
  if (!isPastClass && isToday && sched.end_time) {
    const [hh, mm] = String(sched.end_time).split(':');
    const endDt = new Date();
    endDt.setHours(parseInt(hh, 10) || 0, parseInt(mm, 10) || 0, 0, 0);
    if (endDt.getTime() < Date.now()) isPastClass = true;
  }
  const isFull = count >= capacity;
  const stateKey = status === 'confirmed' ? 'booked'
    : status === 'waitlisted' ? 'waitlisted'
    : status === 'attended' ? 'attended'
    : isPastClass ? 'passed'
    : isFull ? 'full' : 'available';
  const capColor = left === 0 ? 'var(--color-danger)' : left <= 5 ? GOLD : accent;
  const isActing = actionLoading === sched.id || actionLoading === booking?.id;
  const desc = (isEs && cls.description_es) ? cls.description_es : cls.description;
  const trainerName = cls.trainer?.full_name || cls.instructor || '';
  const dateLabel = format(new Date(dateStr + 'T00:00:00'), 'EEE · d MMM', dateFnsLocale);

  const handleShare = async () => {
    // Deep link → App.jsx routes /class/:scheduleId?d=DATE to the in-app
    // focus query, so the invitee lands on this exact class ready to book.
    const url = `${PROD_WEB_URL}/class/${sched.id}?d=${dateStr}`;
    // White-label: name the GYM, not the app.
    const gym = gymName || 'TuGymPR';
    const text = t('classes.inviteText', { name: cls.name, when: `${dateLabel} · ${fmt(sched.start_time)}`, gym, defaultValue: `Join me at ${cls.name} (${dateLabel} · ${fmt(sched.start_time)}) on ${gym}` });
    try {
      if (navigator.share) await navigator.share({ title: cls.name, text, url });
      else await navigator.clipboard?.writeText(`${text} ${url}`);
    } catch { /* user cancelled */ }
  };

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
      {/* scrim */}
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(5,7,9,0.62)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        opacity: vis ? 1 : 0, transition: 'opacity .32s ease' }} />
      {/* sheet */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center',
        transform: vis ? 'translateY(0)' : 'translateY(102%)', transition: 'transform .46s cubic-bezier(.32,.72,0,1)' }}>
        <div style={{ width: '100%', maxWidth: 480, maxHeight: '92dvh',
          background: 'var(--color-bg-card)', borderTopLeftRadius: 30, borderTopRightRadius: 30,
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--color-border-subtle)', borderBottom: 'none', position: 'relative' }}>
          {/* grabber */}
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
            width: 42, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.3)' }} />
          {/* hero */}
          <div style={{ position: 'relative', flexShrink: 0, height: 208 }}>
            {imgUrl ? (
              <img src={imgUrl} alt={cls.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(150deg, color-mix(in srgb, ${accent} 42%, #12161a) 0%, #12161a 55%, #0c0f12 100%)` }} />
            )}
            <div style={{ position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(9,11,13,0.35) 0%, rgba(9,11,13,0) 32%, rgba(9,11,13,0.55) 72%, var(--color-bg-card) 100%)' }} />
            {stateKey === 'passed' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,11,13,0.5)' }} />}
            {/* controls */}
            <div style={{ position: 'absolute', top: 18, right: 16, display: 'flex', gap: 9 }}>
              <GlassCircleBtn onClick={handleShare} label={t('classes.shareClass', 'Compartir clase')}><Share2 size={16} strokeWidth={2.1} /></GlassCircleBtn>
              <GlassCircleBtn onClick={close} label={t('classes.close', { defaultValue: 'Cerrar' })}><X size={17} strokeWidth={2.1} /></GlassCircleBtn>
            </div>
            {/* tags + title */}
            <div style={{ position: 'absolute', left: 20, right: 20, bottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11, flexWrap: 'wrap' }}>
                {cls.workout_template_id && <ClassCatTag t={t} />}
                <ClassStatusPill stateKey={stateKey} accent={accent} t={t} waitlistPos={booking?.waitlist_position} />
              </div>
              <div style={{ fontFamily: CFD, fontWeight: 900, fontSize: 30, lineHeight: 0.98,
                letterSpacing: -0.8, color: '#fff', textShadow: '0 2px 24px rgba(0,0,0,0.5)' }}>{cls.name}</div>
            </div>
          </div>

          {/* body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 16px', display: 'flex', flexDirection: 'column', gap: 15, minHeight: 0 }}>
            {/* date + time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: CFB, fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                <Calendar size={15} style={{ color: 'var(--color-text-secondary)' }} />{dateLabel}
              </span>
              <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--color-text-muted)', flexShrink: 0 }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: CFM, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                <Clock size={15} style={{ color: 'var(--color-text-secondary)' }} />{fmt(sched.start_time)} – {fmt(sched.end_time)}
              </span>
            </div>

            {/* fact strip — real data: duration / spots / type */}
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-surface-hover, rgba(255,255,255,0.05))',
              borderRadius: 16, border: '1px solid var(--color-border-subtle)', padding: '15px 10px' }}>
              <SheetFact accent={accent} icon={<Clock size={17} strokeWidth={2} />} label={t('classes.durationLabel', 'Duración')} value={dur ? `${dur} min` : '—'} />
              <div style={{ width: 1, height: 34, background: 'var(--color-border-subtle)' }} />
              <SheetFact accent={accent} icon={<Users size={17} strokeWidth={2} />} label={t('classes.spotsLabel', 'Cupos')}
                value={left === 0 ? t('classes.full', 'Llena') : t('classes.spotsFree', { count: left, defaultValue: `${left} libres` })} />
              <div style={{ width: 1, height: 34, background: 'var(--color-border-subtle)' }} />
              <SheetFact accent={accent} icon={<Dumbbell size={17} strokeWidth={2} />} label={t('classes.typeLabel', 'Tipo')}
                value={cls.workout_template_id ? t('classes.hasWorkout', { defaultValue: 'Workout' }).split(' ').slice(-1)[0] : t('classes.typeClass', 'Clase')} />
            </div>

            {/* description */}
            {desc && <p style={{ margin: 0, fontFamily: CFB, fontSize: 14, lineHeight: 1.5, color: 'var(--color-text-secondary)', textWrap: 'pretty' }}>{desc}</p>}

            {/* instructor */}
            {trainerName && (
              <button type="button"
                onClick={() => { if (cls.trainer?.id) { close(); navigate(`/trainers/${cls.trainer.id}`); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%', textAlign: 'left',
                  background: 'var(--color-surface-hover, rgba(255,255,255,0.05))', border: '1px solid var(--color-border-subtle)',
                  borderRadius: 16, cursor: cls.trainer?.id ? 'pointer' : 'default' }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg,#FFC78A,#FF6A00)',
                  display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: CFD, fontWeight: 800, fontSize: 17, color: '#1a1207' }}>
                  {trainerName.trim()[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: CFD, fontWeight: 800, fontSize: 15.5, color: 'var(--color-text-primary)' }}>{trainerName}</div>
                  <div style={{ fontFamily: CFB, fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 1 }}>{t('classes.instructor')}</div>
                </div>
                {cls.trainer?.id && <ChevronRight size={18} style={{ color: 'var(--color-text-muted)' }} />}
              </button>
            )}

            {/* friends going — real friendships, real avatars */}
            {friends.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {friends.slice(0, 5).map((f, i) => (
                    <div key={f.id} style={{ marginLeft: i ? -10 : 0, zIndex: 5 - i, borderRadius: '50%',
                      boxShadow: '0 0 0 2px var(--color-bg-card)' }}>
                      <UserAvatar user={f} size={28} />
                    </div>
                  ))}
                  {friends.length > 5 && (
                    <div style={{ marginLeft: -10, width: 28, height: 28, borderRadius: '50%',
                      background: 'var(--color-surface-hover, rgba(255,255,255,0.08))', boxShadow: '0 0 0 2px var(--color-bg-card)',
                      display: 'grid', placeItems: 'center', fontFamily: CFM, fontSize: 10, fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                      +{friends.length - 5}
                    </div>
                  )}
                </div>
                <span style={{ fontFamily: CFB, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {t('classes.friendsGoing', { count: friends.length, defaultValue: `${friends.length} amigos van` })}
                </span>
              </div>
            )}

            {/* capacity */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                <span style={{ fontFamily: CFB, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  <b style={{ color: 'var(--color-text-primary)' }}>{count}</b> {t('classes.reservedCount', 'reservados')}
                </span>
                <span style={{ fontFamily: CFM, fontSize: 12.5, fontWeight: 600, color: capColor }}>
                  {left === 0 ? t('classes.noSpots', 'Sin cupos') : `${left} ${t('classes.ofCapacity', { count: capacity, defaultValue: `de ${capacity}` })}`}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, Math.round((count / capacity) * 100))}%`, height: '100%', borderRadius: 99, background: capColor, transition: 'width .4s' }} />
              </div>
            </div>
          </div>

          {/* sticky action bar */}
          <div style={{ flexShrink: 0, padding: '14px 20px calc(22px + env(safe-area-inset-bottom, 0px))',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-bg-card) 0%, transparent) 0%, var(--color-bg-card) 22%)' }}>
            {/* primary CTA per state */}
            {stateKey === 'available' && (
              <button onClick={() => { close(); onBook(sched.id, cls.id, dateStr); }} disabled={isActing}
                className="active:scale-[0.98] transition-transform disabled:opacity-50"
                style={{ width: '100%', height: 54, borderRadius: 15, border: 'none', cursor: 'pointer',
                  background: accent, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  fontFamily: CFD, fontWeight: 800, fontSize: 16.5, letterSpacing: -0.2,
                  boxShadow: `0 8px 22px color-mix(in srgb, ${accent} 28%, transparent)` }}>
                <Check size={18} strokeWidth={2.6} />{t('classes.book')}
              </button>
            )}
            {stateKey === 'full' && (
              <button onClick={() => { close(); onBook(sched.id, cls.id, dateStr); }} disabled={isActing}
                className="active:scale-[0.98] transition-transform disabled:opacity-50"
                style={{ width: '100%', height: 54, borderRadius: 15, border: 'none', cursor: 'pointer',
                  background: GOLD, color: '#241d09', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  fontFamily: CFD, fontWeight: 800, fontSize: 16.5, letterSpacing: -0.2,
                  boxShadow: '0 8px 22px rgba(212,175,55,0.26)' }}>
                <Hourglass size={17} strokeWidth={2.2} />{t('classes.joinWaitlist')}
              </button>
            )}
            {(stateKey === 'booked' || stateKey === 'waitlisted') && (
              <>
                <div style={{ width: '100%', height: 54, borderRadius: 15,
                  border: `1.5px solid ${stateKey === 'booked' ? `color-mix(in srgb, ${accent} 32%, transparent)` : 'rgba(245,158,11,0.35)'}`,
                  color: stateKey === 'booked' ? accent : '#F59E0B',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  fontFamily: CFD, fontWeight: 800, fontSize: 16.5, letterSpacing: -0.2 }}>
                  {stateKey === 'booked' ? <Check size={18} strokeWidth={2.6} /> : <Hourglass size={17} strokeWidth={2.2} />}
                  {stateKey === 'booked' ? t('classes.booked') : t('classes.waitlisted', { position: booking?.waitlist_position || 1 })}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  {stateKey === 'booked' && isToday && !isPastClass && (
                    <button onClick={() => { close(); onCheckIn(booking.id, cls.name); }} disabled={isActing}
                      className="active:scale-[0.98] transition-transform disabled:opacity-50"
                      style={{ flex: 1, height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
                        background: 'var(--color-success)', color: 'var(--color-text-on-secondary, #000)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        fontFamily: CFB, fontWeight: 700, fontSize: 14.5 }}>
                      <Check size={16} strokeWidth={2.4} />{t('classes.checkIn')}
                    </button>
                  )}
                  <button onClick={async () => { close(); await onCancel(booking.id); }} disabled={isActing}
                    className="active:scale-[0.98] transition-transform disabled:opacity-50"
                    style={{ flex: 1, height: 48, borderRadius: 14, border: '1px solid rgba(240,99,75,0.34)', cursor: 'pointer',
                      background: 'rgba(240,99,75,0.12)', color: 'var(--color-danger)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      fontFamily: CFB, fontWeight: 700, fontSize: 14.5 }}>
                    <X size={15} strokeWidth={2.4} />{t('classes.cancelBooking')}
                  </button>
                </div>
              </>
            )}
            {stateKey === 'attended' && (
              booking?.rating ? (
                <div style={{ width: '100%', height: 54, borderRadius: 15, border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-surface-hover, rgba(255,255,255,0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontFamily: CFB, fontWeight: 700, fontSize: 14.5, color: 'var(--color-text-secondary)' }}>
                  <Star size={16} style={{ color: GOLD, fill: GOLD }} />{t('classes.rated')}
                </div>
              ) : (
                <button onClick={() => { close(); onRate(booking.id, cls.name); }}
                  className="active:scale-[0.98] transition-transform"
                  style={{ width: '100%', height: 54, borderRadius: 15, border: 'none', cursor: 'pointer',
                    background: GOLD, color: '#241d09', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                    fontFamily: CFD, fontWeight: 800, fontSize: 16.5, boxShadow: '0 8px 22px rgba(212,175,55,0.26)' }}>
                  <Star size={17} strokeWidth={2} />{t('classes.rateClass')}
                </button>
              )
            )}
            {stateKey === 'passed' && (
              <div style={{ width: '100%', height: 54, borderRadius: 15,
                background: 'rgba(255,255,255,0.06)', color: 'var(--color-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                fontFamily: CFD, fontWeight: 800, fontSize: 16, border: '1px solid var(--color-border-subtle)' }}>
                <Clock size={17} strokeWidth={2} />{t('classes.statusFinishedFull', 'Clase finalizada')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Week list (vertical day-by-day) ---------- */
function WeekListView({ weekDays, allSchedules, bookingsByDate, countsByKey, todayStr, fmt, dateFnsLocale, onSelectClass, t }) {
  return (
    <div className="space-y-3">
      {weekDays.map(({ date, isPastDay }) => {
        const dow = date.getDay();
        const dateStr = format(date, 'yyyy-MM-dd');
        const sched = allSchedules
          .filter((s) => (s.specific_date ? s.specific_date === dateStr : s.day_of_week === dow))
          .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        const myDayBookings = bookingsByDate[dateStr] || [];
        const isToday = dateStr === todayStr;
        return (
          <div
            key={dateStr}
            className="rounded-2xl p-3"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              border: isToday ? '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)' : '1px solid var(--color-border-default)',
              opacity: isPastDay && !isToday ? 0.55 : 1,
            }}
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[13px] font-bold capitalize" style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                {format(date, 'EEEE d MMM', dateFnsLocale)}
              </p>
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {sched.length === 0 ? t('classes.noClassesShort', { defaultValue: 'Sin clases' }) : t('classes.classCount', { count: sched.length, defaultValue: '{{count}} clases' })}
              </span>
            </div>
            {sched.length === 0 ? null : (
              <div className="space-y-2">
                {sched.map((s) => {
                  const cls = s.gym_classes;
                  if (!cls) return null;
                  const booking = myDayBookings.find((b) => b.schedule_id === s.id);
                  const count = countsByKey[`${s.id}|${dateStr}`] || 0;
                  const cap = s.override_capacity || cls.max_capacity || 20;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelectClass({ sched: s, cls, booking, dateStr })}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors active:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{fmt(s.start_time)} · {count}/{cap}</p>
                      </div>
                      {booking && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: booking.status === 'waitlisted' ? 'rgba(245,158,11,0.15)' : 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                            color: booking.status === 'waitlisted' ? '#F59E0B' : 'var(--color-accent)',
                          }}
                        >
                          {booking.status === 'waitlisted' ? t('classes.waitlistedShort', { defaultValue: 'Lista' }) : t('classes.bookedShort', { defaultValue: 'Reservada' })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Classes() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language === 'es';
  const use24h = isEs;
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const dayLabels = isEs ? DAY_LABELS_ES : DAY_LABELS_EN;
  const fmt = (timeStr) => fmtTime(timeStr, use24h);
  const { user, profile, gymConfig } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pendingFocusRef = useRef(null); // invite deep-link: { sid, d } awaiting schedule load
  const posthog = usePostHog();
  const classesEnabled = useFeatureEnabled('classes');

  useEffect(() => { document.title = `${t('classes.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Redirect if gym doesn't have classes enabled
  useEffect(() => {
    if (gymConfig && !gymConfig.classesEnabled) {
      navigate('/', { replace: true });
    }
  }, [gymConfig, navigate]);

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => format(today, 'yyyy-MM-dd'), [today]);
  const [selectedDate, setSelectedDate] = useState(today);
  // Week offset (in weeks) from the current week. 0 = this week, 1 = next, -1 = last.
  const [weekOffset, setWeekOffset] = useState(0);
  // Trainer-style view toggle: day | week | month
  const [viewMode, setViewMode] = useState('day');
  // ALL schedules for the gym — fetched once. Filtered by day_of_week per view.
  const [allSchedules, setAllSchedules] = useState([]);
  // Bookings + counts loaded for a date range; rebuilt when the range changes.
  // Indexed by date so day clicks are zero-network and can't race.
  const [bookingsByDate, setBookingsByDate] = useState({});       // { 'YYYY-MM-DD': [booking, ...] }
  const [countsByKey, setCountsByKey] = useState({});             // { 'sched_id|YYYY-MM-DD': N }
  const [myUpcoming, setMyUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // schedule_id being acted on
  const [toast, setToast] = useState(null);
  // (recurring feature removed — too brittle to maintain. Members reserve
  // specific dates only; future-week navigation is the path forward.)

  // Check-in + rating modal state
  const [workoutPrompt, setWorkoutPrompt] = useState(null); // { bookingId, templateId, className }
  const [ratingModal, setRatingModal] = useState(null); // { bookingId, className }
  // Mis Reservas drawer + class detail modal
  const [showBookingsSheet, setShowBookingsSheet] = useState(false);
  const [detailModal, setDetailModal] = useState(null); // { sched, cls, booking?, dateStr }
  // Scrollable body of the sheet — we reset scrollTop = 0 every time the
  // sheet opens so it never appears mid-scroll from a previous session.
  const sheetBodyRef = useRef(null);

  const isSelectedToday = isSameDay(selectedDate, today);
  // selectedDow / selectedDateStr are declared further down once allSchedules
  // + bookingsByDate are in scope (the page reads from them to slice the
  // visible day's data without re-querying).

  // Build the week days for the day strip — anchored to the offset week.
  const weekStart = useMemo(() => {
    const base = startOfWeek(today, { weekStartsOn: 0 }); // Sunday-start (matches trainer calendar)
    return addWeeks(base, weekOffset);
  }, [today, weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const isPastDay = format(d, 'yyyy-MM-dd') < format(today, 'yyyy-MM-dd');
      return {
        date: d,
        label: dayLabels[d.getDay()],
        dayNum: format(d, 'd'),
        isToday: isSameDay(d, today),
        isSelected: isSameDay(d, selectedDate),
        isPastDay,
      };
    });
  }, [weekStart, today, selectedDate, dayLabels]);

  const weekRangeLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    if (weekStart.getMonth() === end.getMonth()) {
      return `${format(weekStart, 'd')} – ${format(end, 'd MMM', dateFnsLocale)}`;
    }
    return `${format(weekStart, 'd MMM', dateFnsLocale)} – ${format(end, 'd MMM', dateFnsLocale)}`;
  }, [weekStart, dateFnsLocale]);

  // Visible range — depends on viewMode. Used to fetch bookings + counts.
  const visibleRange = useMemo(() => {
    if (viewMode === 'day') {
      const d = format(selectedDate, 'yyyy-MM-dd');
      return { start: d, end: d };
    }
    if (viewMode === 'week') {
      return {
        start: format(weekStart, 'yyyy-MM-dd'),
        end: format(addDays(weekStart, 6), 'yyyy-MM-dd'),
      };
    }
    // month — anchored to selectedDate's month
    const monthAnchor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const monthEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    return {
      start: format(monthAnchor, 'yyyy-MM-dd'),
      end: format(monthEnd, 'yyyy-MM-dd'),
    };
  }, [viewMode, selectedDate, weekStart]);

  // Stale-token refs — SEPARATE per fetch type. Sharing a single ref between
  // schedules + bookings caused a race: the bookings effect fires right after
  // the schedules effect, increments the shared token, and when the schedules
  // response lands second its myToken doesn't match anymore → response was
  // dropped and allSchedules stayed empty (no Monday class would show).
  const schedulesTokenRef = useRef(0);
  const bookingsTokenRef = useRef(0);

  // ── Fetch schedules ONCE (or when gym changes) ──
  // No churn on day clicks — the day filter is purely client-side.
  const loadSchedules = useCallback(async () => {
    if (!profile?.gym_id) return;
    const myToken = ++schedulesTokenRef.current;
    const { data } = await supabase
      .from('gym_class_schedules')
      .select('*, gym_classes(*)')
      .eq('gym_id', profile.gym_id)
      .order('start_time');
    const rows = data || [];
    await attachClassTrainers(rows, (s) => s.gym_classes);
    if (myToken !== schedulesTokenRef.current) return; // stale — newer fetch in-flight
    setAllSchedules(rows);
  }, [profile?.gym_id]);

  // ── Fetch bookings + counts for the visible range ──
  // Re-runs when viewMode / week offset / selected month changes — NOT on
  // every day click within the same range.
  const loadBookingsRange = useCallback(async (rangeStart, rangeEnd) => {
    // Gym-less member: clear the skeleton rather than stranding it (loading
    // inits true; this early return ran before the setLoading(true) below).
    if (!profile?.gym_id || !user?.id) { setLoading(false); return; }
    const myToken = ++bookingsTokenRef.current;
    setLoading(true);

    // Pad range +/- 14 days for "Mis Reservas" history.
    const pastStart = format(addDays(new Date(rangeStart), -14), 'yyyy-MM-dd');
    const futureEnd = format(addDays(new Date(rangeEnd), 30), 'yyyy-MM-dd');

    const [myBookingsRes, countsRes] = await Promise.all([
      // All my bookings in [rangeStart-14d, rangeEnd+30d] including schedule + class.
      supabase
        .from('gym_class_bookings')
        .select('id, schedule_id, booking_date, status, rating, notes, waitlist_position, gym_class_schedules(*, gym_classes(*))')
        .eq('profile_id', user.id)
        .neq('status', 'cancelled')
        .gte('booking_date', pastStart)
        .lte('booking_date', futureEnd)
        .order('booking_date', { ascending: false }),
      // Confirmed booking counts via SECURITY DEFINER RPC — bypasses the
      // bookings_select_own RLS that would otherwise hide other members'
      // bookings from the count. Returns aggregate (schedule_id, date,
      // confirmed, waitlisted) tuples, no PII.
      supabase.rpc('get_class_booking_counts', {
        p_gym_id: profile.gym_id,
        p_date_from: rangeStart,
        p_date_to: rangeEnd,
      }),
    ]);

    await attachClassTrainers(myBookingsRes.data, (b) => b.gym_class_schedules?.gym_classes);

    if (myToken !== bookingsTokenRef.current) return; // stale — drop the response

    // Index my bookings by booking_date for O(1) lookup during render.
    const byDate = {};
    (myBookingsRes.data || []).forEach((b) => {
      (byDate[b.booking_date] = byDate[b.booking_date] || []).push(b);
    });
    setBookingsByDate(byDate);

    // Indexed counts: 'schedule_id|date' → confirmed count. The RPC returns
    // aggregated rows so we just map them directly. Waitlisted is available
    // too (countsRes row has it) — fold it in if/when we surface "X waiting".
    const counts = {};
    (countsRes.data || []).forEach((row) => {
      const key = `${row.schedule_id}|${row.booking_date}`;
      counts[key] = row.confirmed || 0;
    });
    setCountsByKey(counts);

    setMyUpcoming(myBookingsRes.data || []);
    setLoading(false);
  }, [profile?.gym_id, user?.id]);

  // Load schedules once on mount / gym change.
  useEffect(() => { loadSchedules(); }, [loadSchedules]);
  // Load bookings + counts whenever the visible range changes (not every day).
  useEffect(() => {
    loadBookingsRange(visibleRange.start, visibleRange.end);
  }, [visibleRange.start, visibleRange.end, loadBookingsRange]);

  // ── Invite deep-link focus: /classes?class=<scheduleId>&d=<YYYY-MM-DD> ──
  // Step 1: jump the day strip to the invited date (reactive to the query so it
  // also works when the app is already open — Classes is keep-alive).
  useEffect(() => {
    let sid = null, d = null;
    try { const sp = new URLSearchParams(location.search); sid = sp.get('class'); d = sp.get('d'); } catch { /* noop */ }
    if (!sid || pendingFocusRef.current?.sid === sid) return;
    pendingFocusRef.current = { sid, d };
    if (d) { const dt = new Date(`${d}T00:00:00`); if (!isNaN(dt.getTime())) setSelectedDate(dt); }
  }, [location.search]);

  // Step 2: once the schedules covering that date have loaded, open the detail
  // sheet for the invited class so the member lands ready to book.
  useEffect(() => {
    const pf = pendingFocusRef.current;
    if (!pf || !allSchedules.length) return;
    const sched = allSchedules.find(s => String(s.id) === String(pf.sid));
    if (!sched) return;
    const dateStr = pf.d || format(selectedDate, 'yyyy-MM-dd');
    const booking = (bookingsByDate[dateStr] || []).find(b => String(b.schedule_id) === String(pf.sid)) || null;
    pendingFocusRef.current = null;
    setDetailModal({ sched, cls: sched.gym_classes, booking, dateStr });
  }, [allSchedules, bookingsByDate, selectedDate]);

  // Convenience: bookings + counts + schedules slice for the currently-selected day.
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedDow = selectedDate.getDay();
  const bookings = bookingsByDate[selectedDateStr] || [];
  const schedules = useMemo(
    // Schedules can be either recurring (day_of_week 0-6, no specific_date)
    // or one-off (specific_date set, day_of_week may be NULL). Match both:
    //   • recurring rows where day_of_week === today's DOW, OR
    //   • one-off rows where specific_date === selected date string.
    () => allSchedules
      .filter((s) => {
        if (s.specific_date) return s.specific_date === selectedDateStr;
        return s.day_of_week === selectedDow;
      })
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
    [allSchedules, selectedDow, selectedDateStr],
  );
  // Per-schedule count helper that respects the selected date.
  const bookingCounts = useMemo(() => {
    const m = {};
    schedules.forEach((s) => { m[s.id] = countsByKey[`${s.id}|${selectedDateStr}`] || 0; });
    return m;
  }, [schedules, countsByKey, selectedDateStr]);

  // Reload when an action (book/cancel) finishes. Returns the promise so
  // callers can `await reloadActive()` and rely on bookings/counts being
  // up-to-date by the time their next code runs.
  const reloadActive = useCallback(() => {
    return loadBookingsRange(visibleRange.start, visibleRange.end);
  }, [loadBookingsRange, visibleRange.start, visibleRange.end]);

  // Book a class for a specific date. The optional `bookingDate` arg lets
  // the detail modal pass the date the user is viewing (which can differ
  // from the day-strip's selectedDate when opened from the Week view).
  const handleBook = async (scheduleId, classId, bookingDate = null) => {
    setActionLoading(scheduleId);
    const dateToBook = bookingDate || selectedDateStr;
    const { data, error } = await supabase.rpc('book_class', {
      p_schedule_id: scheduleId,
      p_class_id: classId,
      p_booking_date: dateToBook,
    });
    if (error) {
      console.error('[Classes] book_class failed:', error);
      setToast({ msg: t('classes.bookFailed', "Couldn't book the class. Try again."), type: 'error' });
    } else if (data?.status === 'waitlisted') {
      posthog?.capture('class_waitlisted', { class_id: classId });
      setToast({ msg: t('classes.classFull'), type: 'info' });
    } else {
      posthog?.capture('class_booked', { class_id: classId });
      setToast({ msg: t('classes.bookingConfirmed'), type: 'success' });
    }
    // Wait for the refetch BEFORE clearing the busy spinner so the UI
    // doesn't briefly snap back to "Reservar" before the new state lands.
    await reloadActive();
    setActionLoading(null);
  };

  // Cancel a booking (uses RPC for waitlist promotion). Same await-then-
  // clear ordering as handleBook so the row updates instantly.
  const handleCancel = async (bookingId) => {
    setActionLoading(bookingId);
    const { error } = await supabase.rpc('cancel_class_booking', { p_booking_id: bookingId });
    if (error) {
      console.error('[Classes] cancel_class_booking failed:', error);
      setToast({ msg: t('classes.cancelFailed', "Couldn't cancel the booking. Try again."), type: 'error' });
    } else {
      posthog?.capture('class_cancelled', { booking_id: bookingId });
      setToast({ msg: t('classes.bookingCancelled'), type: 'info' });
    }
    await reloadActive();
    setActionLoading(null);
  };

  // Toggle recurring booking
  // (handleToggleRecurring removed — feature deprecated in favor of
  // explicit per-date booking with future-week navigation.)

  // Check in to a class
  const handleCheckIn = async (bookingId, className) => {
    setActionLoading(bookingId);
    const { data, error } = await supabase.rpc('checkin_class', { p_booking_id: bookingId });
    if (!error) posthogClient?.capture('class_checked_in');

    if (error) {
      setActionLoading(null);
      console.error('[Classes] checkin_class failed:', error);
      setToast({ msg: t('classes.checkinFailed', "Couldn't check you in. Try again."), type: 'error' });
      return;
    }

    setToast({ msg: t('classes.checkedIn'), type: 'success' });
    await reloadActive();
    setActionLoading(null);

    if (data?.has_template) {
      // Class has a workout template — ask member if they want to track it
      setWorkoutPrompt({ bookingId, templateId: data.template_id, className });
    } else {
      // No template — show rating modal directly
      setRatingModal({ bookingId, className });
    }
  };

  // Workout prompt handlers
  const handleStartWorkout = () => {
    if (!workoutPrompt) return;
    const { templateId, bookingId } = workoutPrompt;
    setWorkoutPrompt(null);
    // ActiveSession's route is /session/:routineId and it reads classBookingId
    // from location.state — the old `/workout?routineId=...` URL wasn't a
    // route at all (fell through to the Dashboard catch-all), so class
    // workouts never started and never linked to the booking.
    posthogClient?.capture('class_workout_started');
    navigate(`/session/${templateId}`, { state: { classBookingId: bookingId } });
  };

  const handleJustCheckIn = () => {
    if (!workoutPrompt) return;
    const { bookingId, className } = workoutPrompt;
    setWorkoutPrompt(null);
    setRatingModal({ bookingId, className });
  };

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Reset Mis Reservas scroll position whenever the sheet opens.
  useEffect(() => {
    if (showBookingsSheet && sheetBodyRef.current) {
      sheetBodyRef.current.scrollTop = 0;
    }
  }, [showBookingsSheet]);

  // Helper: get booking for a schedule
  const getBooking = (scheduleId) => bookings.find(b => b.schedule_id === scheduleId);

  // Split myUpcoming into categories. Also synthesize 4 weeks of "virtual"
  // bookings for any recurring schedule the member has flagged — until a
  // real booking row gets pre-created server-side, this is what makes the
  // recurring auto-book visible in the Mis Reservas list.
  const { upcomingBookings, todayBookings, pastBookings } = useMemo(() => {
    const upcoming = [];
    const todayList = [];
    const past = [];
    (myUpcoming || []).forEach(b => {
      const bDate = b.booking_date;
      if (bDate === todayStr) {
        todayList.push(b);
      } else if (bDate > todayStr) {
        upcoming.push(b);
      } else {
        past.push(b);
      }
    });

    upcoming.sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    return { upcomingBookings: upcoming, todayBookings: todayList, pastBookings: past };
  }, [myUpcoming, todayStr]);

  // Platform kill switch (Operations → feature_classes). After all hooks so
  // a mid-session flip can't change the hook order.
  if (!classesEnabled) return <FeatureDisabledScreen />;

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header — back / page title (left) / Mis Reservas pill (right).
          Title sits inline with the back button so the right-side pill never
          competes for centered space. Pill shows the full "Mis Reservas"
          label + count badge. */}
      <div className="sticky top-0 z-20 backdrop-blur-xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-3 py-3 flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label={t('classes.goBack', { defaultValue: 'Go back' })} className="rounded-xl transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
          <h1 className="text-[16px] font-bold flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>{t('classes.title')}</h1>
          {(() => {
            const totalActive = todayBookings.length + upcomingBookings.length;
            return (
              <button
                onClick={() => setShowBookingsSheet(true)}
                aria-label={t('classes.myBookings')}
                className="relative inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-bold transition-all active:scale-95 min-h-[40px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37] flex-shrink-0"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                  color: 'var(--color-accent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                }}
              >
                <ListChecks size={14} />
                <span>{t('classes.myBookings')}</span>
                {totalActive > 0 && (
                  <span
                    className="px-1.5 rounded-full text-[10px] font-bold tabular-nums"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)', minWidth: 18, height: 18, lineHeight: '18px', textAlign: 'center' }}
                  >
                    {totalActive}
                  </span>
                )}
              </button>
            );
          })()}
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* View mode segmented — Day / Semana / Mes (matches trainer calendar). */}
        <div
          className="grid grid-cols-3 gap-1 p-1 rounded-2xl"
          style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
        >
          {[
            { key: 'day',   label: t('classes.viewDay',   { defaultValue: 'Día' }) },
            { key: 'week',  label: t('classes.viewWeek',  { defaultValue: 'Semana' }) },
            { key: 'month', label: t('classes.viewMonth', { defaultValue: 'Mes' }) },
          ].map(opt => {
            const active = viewMode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setViewMode(opt.key)}
                className="py-2 rounded-xl text-[13px] font-bold transition-all active:scale-[0.98] min-h-[40px] focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                style={{
                  background: active ? 'var(--color-accent)' : 'transparent',
                  color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-secondary)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Day view header — single big "MARTES 15" centered with prev/next day chevrons. */}
        {viewMode === 'day' && (
          <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSelectedDate((d) => addDays(d, -1))}
                aria-label={t('classes.prevDay', { defaultValue: 'Día anterior' })}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(today)}
                className="flex flex-col items-center flex-1 transition-opacity active:opacity-70 focus:outline-none"
                aria-label={t('classes.jumpToToday', { defaultValue: 'Hoy' })}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: isSelectedToday ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}
                >
                  {format(selectedDate, 'EEEE', dateFnsLocale)}
                </span>
                <span
                  className="text-[28px] font-bold tabular-nums leading-tight"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {format(selectedDate, 'd MMMM', dateFnsLocale)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate((d) => addDays(d, 1))}
                aria-label={t('classes.nextDay', { defaultValue: 'Día siguiente' })}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <ChevronLeft size={20} className="rotate-180" />
              </button>
            </div>
          </div>
        )}

        {/* Week-strip nav — only shown in week view. */}
        {viewMode === 'week' && (
        <div className="rounded-2xl p-3 space-y-2" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          {/* Header: prev / current range / next */}
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => {
                setWeekOffset(o => o - 1);
                setSelectedDate(subDays(weekStart, 7));
              }}
              aria-label={t('classes.prevWeek', { defaultValue: 'Semana anterior' })}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setWeekOffset(0); setSelectedDate(today); }}
              className="text-[12px] font-semibold tracking-wide truncate text-center hover:underline transition-opacity"
              style={{ color: weekOffset === 0 ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
              aria-label={t('classes.jumpToThisWeek', { defaultValue: 'Esta semana' })}
            >
              {weekOffset === 0 ? t('classes.thisWeek', { defaultValue: 'Esta semana' }) : weekRangeLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setWeekOffset(o => o + 1);
                setSelectedDate(addDays(weekStart, 7));
              }}
              aria-label={t('classes.nextWeek', { defaultValue: 'Semana siguiente' })}
              className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04] active:scale-95 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ChevronLeft size={18} className="rotate-180" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            {weekDays.map(({ date, label, dayNum, isToday, isSelected, isPastDay }) => (
              <button
                key={label + dayNum + date.toISOString()}
                type="button"
                onClick={() => setSelectedDate(date)}
                aria-label={`${label} ${dayNum}${isPastDay ? ' (pasada)' : ''}`}
                className="relative flex flex-col items-center flex-1 py-1 transition-all active:scale-95 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
              >
                <span
                  className="text-[9px] font-medium uppercase tracking-[0.08em] mb-1"
                  style={{ color: isSelected ? 'var(--color-accent)' : isPastDay ? 'var(--color-text-subtle)' : 'var(--color-text-subtle)', opacity: isPastDay && !isSelected ? 0.45 : 1 }}
                >
                  {label}
                </span>
                <div className="relative w-9 h-9 flex items-center justify-center">
                  {isSelected && (
                    <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                  )}
                  <span
                    className="relative z-10 text-[14px] font-bold"
                    style={{
                      color: isSelected ? 'var(--color-text-on-accent, #000)' : isToday ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                      opacity: isPastDay && !isSelected ? 0.45 : 1,
                      textDecoration: isPastDay && !isSelected ? 'line-through' : 'none',
                    }}
                  >
                    {dayNum}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}

        {/* Month grid — shown in month view. Each cell is a day; the dot shows
            whether the gym has any classes scheduled for that day-of-week.
            Tapping a day jumps into Day view for that date. */}
        {viewMode === 'month' && (
          <MonthGridView
            anchor={selectedDate}
            today={today}
            allSchedules={allSchedules}
            dayLabels={dayLabels}
            dateFnsLocale={dateFnsLocale}
            onSelectDate={(d) => { setSelectedDate(d); setViewMode('day'); }}
            onShiftMonth={(delta) => {
              const next = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + delta, 1);
              setSelectedDate(next);
            }}
            onJumpToday={() => setSelectedDate(today)}
            isCurrentMonth={selectedDate.getFullYear() === today.getFullYear() && selectedDate.getMonth() === today.getMonth()}
            t={t}
          />
        )}

        {/* Week list — shown in week view. One section per day in the week,
            each listing the classes scheduled that day. Tapping a class opens
            the detail modal. */}
        {viewMode === 'week' && !loading && (
          <WeekListView
            weekDays={weekDays}
            allSchedules={allSchedules}
            bookingsByDate={bookingsByDate}
            countsByKey={countsByKey}
            todayStr={todayStr}
            fmt={fmt}
            dateFnsLocale={dateFnsLocale}
            onSelectClass={(payload) => setDetailModal(payload)}
            t={t}
          />
        )}

        {/* Class Cards — DAY VIEW ONLY */}
        {viewMode === 'day' && (
        <>
        {loading ? (
          <div className="space-y-4">
            <ClassSkeleton />
            <ClassSkeleton />
            <ClassSkeleton />
          </div>
        ) : schedules.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={t('classes.emptyTitle')}
            description={t('classes.emptyDescription')}
            compact
          />
        ) : (
          <div className="space-y-4">
            {schedules.map((sched) => {
              const cls = sched.gym_classes;
              if (!cls) return null;
              const booking = getBooking(sched.id);
              const isBooked = !!booking;
              const bookingId = booking?.id;
              const bookingStatus = booking?.status;
              const bookingRating = booking?.rating;
              const waitlistPos = booking?.waitlist_position;
              const hasTemplate = !!cls.workout_template_id;
              const count = bookingCounts[sched.id] || 0;
              // Capacity precedence: per-slot override → class default → 20.
              // Was reading non-existent columns sched.capacity / cls.capacity
              // which both returned undefined → fell back to 20 always
              // (e.g. a 30-cap class showed "20 spaces free" forever).
              const capacity = sched.override_capacity || cls.max_capacity || 30;
              const isFull = count >= capacity;
              const spotsLeft = capacity - count;
              const dur = durationMinutes(sched.start_time, sched.end_time);
              const imgUrl = classImageUrl(cls.image_path);
              const accentColor = cls.color || 'var(--color-accent)';
              const isActing = actionLoading === sched.id || actionLoading === bookingId;

              // Determine button state
              const isWaitlisted = bookingStatus === 'waitlisted';
              const isConfirmedToday = bookingStatus === 'confirmed' && isSelectedToday;
              const isConfirmedFuture = bookingStatus === 'confirmed' && !isSelectedToday;
              const isAttended = bookingStatus === 'attended';
              const isAttendedNoRating = isAttended && !bookingRating;
              const isAttendedRated = isAttended && !!bookingRating;

              // Past = either a date strictly before today, OR today + start_time already passed.
              const selectedDateOnly = format(selectedDate, 'yyyy-MM-dd');
              const todayOnly = format(today, 'yyyy-MM-dd');
              let isPastClass = selectedDateOnly < todayOnly;
              if (!isPastClass && selectedDateOnly === todayOnly && sched.end_time) {
                // class has already ended (use end_time so an in-progress class still
                // shows as bookable until the bell)
                const [hh, mm] = String(sched.end_time).split(':');
                const endDt = new Date(today);
                endDt.setHours(parseInt(hh, 10) || 0, parseInt(mm, 10) || 0, 0, 0);
                if (endDt.getTime() < Date.now()) isPastClass = true;
              }

              return (
                <div
                  key={sched.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailModal({ sched, cls, booking, dateStr: selectedDateOnly })}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailModal({ sched, cls, booking, dateStr: selectedDateOnly }); } }}
                  className="rounded-[20px] overflow-hidden cursor-pointer"
                  style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)',
                    opacity: isPastClass && !isAttended ? 0.82 : 1,
                    boxShadow: '0 14px 30px -18px rgba(0,0,0,0.7)' }}
                >
                  {/* hero — photo finally earns its place; melts into the card */}
                  <div className="relative" style={{ height: 132 }}>
                    {imgUrl ? (
                      <img src={imgUrl} alt={`${cls.name} class`} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${accentColor} 42%, #12161a) 0%, #12161a 55%, #0c0f12 100%)` }} />
                    )}
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(9,11,13,0.25), rgba(9,11,13,0.05) 45%, var(--color-bg-card) 100%)' }} />
                    {hasTemplate && <div style={{ position: 'absolute', top: 13, left: 14 }}><ClassCatTag t={t} /></div>}
                    <div style={{ position: 'absolute', top: 13, right: 14 }}>
                      <ClassStatusPill
                        stateKey={isAttended ? 'attended' : isWaitlisted ? 'waitlisted' : isBooked ? 'booked' : isPastClass ? 'passed' : isFull ? 'full' : 'available'}
                        accent={accentColor} t={t} waitlistPos={waitlistPos}
                      />
                    </div>
                    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 11,
                      fontFamily: CFD, fontWeight: 900, fontSize: 24, color: '#fff',
                      letterSpacing: -0.6, textShadow: '0 2px 18px rgba(0,0,0,0.5)' }}>{cls.name}</div>
                  </div>

                  {/* body */}
                  <div style={{ padding: '13px 16px 15px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: CFM, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                        <Clock size={15} style={{ color: accentColor }} strokeWidth={2} />{fmt(sched.start_time)} – {fmt(sched.end_time)}
                      </span>
                      <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--color-text-muted)', flexShrink: 0 }} />
                      {dur && <span style={{ fontFamily: CFB, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('classes.minutes', { count: dur })}</span>}
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Users size={14} style={{ color: 'var(--color-text-muted)' }} />
                        <span style={{ fontFamily: CFM, fontSize: 12, fontWeight: 600,
                          color: spotsLeft === 0 ? 'var(--color-danger)' : spotsLeft <= 5 ? GOLD : accentColor }}>{count}/{capacity}</span>
                      </span>
                    </div>

                    {/* state strip — actionable states act directly; informational
                        states open the sheet (where Cancel etc. live) */}
                    {isPastClass && !isAttended ? (
                      <div className="flex items-center justify-center gap-2" style={{ height: 46, borderRadius: 13,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border-subtle)',
                        color: 'var(--color-text-muted)', fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        <Clock size={16} strokeWidth={2.2} />{t('classes.statusFinished', 'Finalizada')}
                      </div>
                    ) : isAttendedRated ? (
                      <div className="flex items-center justify-center gap-2" style={{ height: 46 }}>
                        <StarRating value={bookingRating} readOnly size={18} />
                        <span style={{ fontFamily: CFB, fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>{t('classes.rated')}</span>
                      </div>
                    ) : isAttendedNoRating ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setRatingModal({ bookingId, className: cls.name }); }}
                        className="flex items-center justify-center gap-2 w-full transition-all active:scale-[0.98] focus:outline-none"
                        style={{ height: 46, borderRadius: 13, border: 'none', cursor: 'pointer',
                          background: GOLD, color: '#241d09', fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        <Star size={16} strokeWidth={2.2} />{t('classes.rateClass')}
                      </button>
                    ) : isWaitlisted ? (
                      <div className="flex items-center justify-center gap-2" style={{ height: 46, borderRadius: 13,
                        background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                        color: '#F59E0B', fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        <Hourglass size={15} strokeWidth={2.2} />{t('classes.waitlisted', { position: waitlistPos })}
                      </div>
                    ) : isConfirmedToday ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCheckIn(bookingId, cls.name); }}
                        disabled={isActing}
                        className="flex items-center justify-center gap-2 w-full transition-all active:scale-[0.98] focus:outline-none disabled:opacity-50"
                        style={{ height: 46, borderRadius: 13, border: 'none', cursor: 'pointer',
                          background: 'var(--color-success)', color: 'var(--color-text-on-secondary, #000)',
                          fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        <Check size={16} strokeWidth={2.4} />{isActing ? '...' : t('classes.checkIn')}
                      </button>
                    ) : isConfirmedFuture ? (
                      <div className="flex items-center justify-center gap-2" style={{ height: 46, borderRadius: 13,
                        background: `color-mix(in srgb, ${accentColor} 13%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${accentColor} 32%, transparent)`,
                        color: accentColor, fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        <Check size={16} strokeWidth={2.4} />{t('classes.booked')}
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleBook(sched.id, cls.id); }}
                        disabled={isActing}
                        className="flex items-center justify-center gap-2 w-full transition-all active:scale-[0.98] focus:outline-none disabled:opacity-50"
                        style={{ height: 46, borderRadius: 13, cursor: 'pointer',
                          background: isFull ? GOLD : `color-mix(in srgb, ${accentColor} 13%, transparent)`,
                          border: isFull ? 'none' : `1px solid color-mix(in srgb, ${accentColor} 32%, transparent)`,
                          color: isFull ? '#241d09' : accentColor,
                          fontFamily: CFD, fontWeight: 800, fontSize: 15 }}>
                        {isFull && <Hourglass size={15} strokeWidth={2.2} />}
                        {isActing ? '...' : isFull
                          ? t('classes.joinWaitlist')
                          : `${t('classes.book')} · ${t('classes.spotsFree', { count: spotsLeft, defaultValue: `${spotsLeft} libres` })}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
        )}

      </div>

      {/* Mis Reservas — full-screen sheet opened from the top button. */}
      {showBookingsSheet && (
      <div
        className="fixed inset-x-0 z-40 flex flex-col"
        style={{
          background: 'var(--color-bg-primary)',
          // Respect the main app chrome: TOP starts below the app header
          // (52px + safe-area-top) and BOTTOM ends above the tab bar
          // (~84px including safe-area-bottom). This keeps the sheet
          // between them like every other page.
          top: 'calc(52px + var(--safe-area-top, env(safe-area-inset-top, 0px)))',
          bottom: 'calc(72px + var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))',
        }}
      >
        {/* Sheet header — 3-column grid: [< Cerrar] | 📅 Mis Reservas (centered) | spacer */}
        <div
          className="grid items-center px-3 py-3 flex-shrink-0"
          style={{
            background: 'var(--color-bg-nav)',
            borderBottom: '1px solid var(--color-border-default)',
            gridTemplateColumns: '1fr auto 1fr',
            columnGap: '8px',
          }}
        >
          <button
            onClick={() => setShowBookingsSheet(false)}
            aria-label={t('classes.close', { defaultValue: 'Cerrar' })}
            className="justify-self-start inline-flex items-center gap-1 rounded-xl transition-colors min-h-[40px] px-2 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ color: 'var(--color-accent)' }}
          >
            <ChevronLeft size={22} strokeWidth={2.2} />
            <span className="text-[14px] font-semibold">{t('classes.close', { defaultValue: 'Cerrar' })}</span>
          </button>
          <div className="justify-self-center inline-flex items-center gap-1.5 min-w-0">
            <CalendarCheck size={16} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {t('classes.myBookings')}
            </span>
          </div>
          <span aria-hidden className="block" />
        </div>

        {/* Sheet body — bookings list directly below the header. */}
        <div ref={sheetBodyRef} className="flex-1 overflow-y-auto px-4 pt-5 pb-24">
        <section className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          {(todayBookings.length + upcomingBookings.length + pastBookings.length) === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('classes.noBookings')}</p>
          ) : (
            <div className="space-y-4">
              {/* Today's bookings */}
              {todayBookings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                    {t('classes.today', { defaultValue: 'Today' })}
                  </p>
                  {todayBookings.map(b => {
                    const sched = b.gym_class_schedules;
                    const cls = sched?.gym_classes;
                    if (!sched || !cls) return null;
                    const isAttd = b.status === 'attended';
                    const hasRating = !!b.rating;
                    const openDetail = () => setDetailModal({ booking: b, sched, cls, dateStr: b.booking_date });
                    return (
                      <div
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={openDetail}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } }}
                        className="flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-colors active:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                            {cls.workout_template_id && <Dumbbell size={12} style={{ color: 'var(--color-accent)' }} />}
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {fmt(sched.start_time)}
                          </p>
                        </div>
                        {isAttd && hasRating ? (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <StarRating value={b.rating} readOnly size={12} />
                          </div>
                        ) : isAttd && !hasRating ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRatingModal({ bookingId: b.id, className: cls.name }); }}
                            className="text-[11px] px-3 py-1 rounded-full font-semibold flex-shrink-0 min-h-[32px] transition-all active:scale-95"
                            style={{ backgroundColor: '#D4AF37', color: '#000' }}
                          >
                            {t('classes.rateClass')}
                          </button>
                        ) : b.status === 'waitlisted' ? (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-1"
                            style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}
                          >
                            <Clock size={10} />
                            {t('classes.waitlisted', { position: b.waitlist_position })}
                          </span>
                        ) : b.status === 'confirmed' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCheckIn(b.id, cls.name); }}
                            disabled={actionLoading === b.id}
                            className="text-[11px] px-3 py-1 rounded-full font-semibold flex-shrink-0 min-h-[32px] transition-all active:scale-95 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-success)', color: 'var(--color-text-on-secondary, #000)' }}
                          >
                            {actionLoading === b.id ? '...' : t('classes.checkIn')}
                          </button>
                        ) : (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
                          >
                            {t('classes.booked')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Upcoming bookings */}
              {upcomingBookings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('classes.upcomingClasses')}
                  </p>
                  {upcomingBookings.map(b => {
                    const sched = b.gym_class_schedules;
                    const cls = sched?.gym_classes;
                    if (!sched || !cls) return null;
                    const openDetail = () => setDetailModal({ booking: b, sched, cls, dateStr: b.booking_date });
                    return (
                      <div
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={openDetail}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } }}
                        className="flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-colors active:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                            {cls.workout_template_id && <Dumbbell size={12} style={{ color: 'var(--color-accent)' }} />}
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {format(new Date(b.booking_date + 'T00:00:00'), 'EEE, MMM d', dateFnsLocale)} · {fmt(sched.start_time)}
                          </p>
                        </div>
                        {b.status === 'waitlisted' ? (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-1"
                            style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#F59E0B' }}
                          >
                            <Clock size={10} />
                            {t('classes.waitlisted', { position: b.waitlist_position })}
                          </span>
                        ) : (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
                          >
                            {t('classes.booked')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Past bookings (attended or not — neutral label, since a booked
                  class the member skipped also lands here with status confirmed) */}
              {pastBookings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('classes.pastClasses')}
                  </p>
                  {pastBookings.map(b => {
                    const sched = b.gym_class_schedules;
                    const cls = sched?.gym_classes;
                    if (!sched || !cls) return null;
                    const hasRating = !!b.rating;
                    const openDetail = () => setDetailModal({ booking: b, sched, cls, dateStr: b.booking_date });
                    return (
                      <div
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        onClick={openDetail}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(); } }}
                        className="flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-colors active:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                            {cls.workout_template_id && <Dumbbell size={12} style={{ color: 'var(--color-accent)' }} />}
                          </div>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                            {format(new Date(b.booking_date + 'T00:00:00'), 'EEE, MMM d', dateFnsLocale)} · {fmt(sched.start_time)}
                          </p>
                        </div>
                        {hasRating ? (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <StarRating value={b.rating} readOnly size={12} />
                          </div>
                        ) : b.status === 'attended' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRatingModal({ bookingId: b.id, className: cls.name }); }}
                            className="text-[11px] px-3 py-1 rounded-full font-semibold flex-shrink-0 min-h-[32px] transition-all active:scale-95"
                            style={{ backgroundColor: '#D4AF37', color: '#000' }}
                          >
                            {t('classes.rateClass')}
                          </button>
                        ) : (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}
                          >
                            {t('classes.attended')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
        </div>
      </div>
      )}

      {/* Class detail modal — opened from any booking row in the Mis Reservas
          sheet. Shows the class image, capacity bar, time/instructor/description
          and a contextual action button (cancel or check in). */}
      {/* Class detail — Cinematic bottom sheet (Class Modal A) */}
      {detailModal && (
        <ClassDetailSheet
          data={detailModal}
          onClose={() => setDetailModal(null)}
          t={t}
          isEs={isEs}
          fmt={fmt}
          dateFnsLocale={dateFnsLocale}
          bookingCounts={bookingCounts}
          todayStr={todayStr}
          actionLoading={actionLoading}
          onBook={(schedId, clsId, dateStr) => handleBook(schedId, clsId, dateStr)}
          onCancel={(bookingId) => handleCancel(bookingId)}
          onCheckIn={(bookingId, name) => handleCheckIn(bookingId, name)}
          onRate={(bookingId, name) => setRatingModal({ bookingId, className: name })}
          navigate={navigate}
          gymName={profile?.gym_name}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-semibold shadow-lg" style={{
          backgroundColor: toast.type === 'error' ? 'var(--color-danger)' : toast.type === 'success' ? 'var(--color-success)' : 'var(--color-bg-card)',
          color: toast.type === 'info' ? 'var(--color-text-primary)' : toast.type === 'success' ? 'var(--color-text-on-secondary, #fff)' : '#fff',
          border: toast.type === 'info' ? '1px solid var(--color-border-default)' : 'none',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Workout Prompt Modal */}
      <WorkoutPromptModal
        open={!!workoutPrompt}
        onClose={() => setWorkoutPrompt(null)}
        onStartWorkout={handleStartWorkout}
        onJustCheckIn={handleJustCheckIn}
      />

      {/* Class Rating Modal */}
      <ClassRatingModal
        open={!!ratingModal}
        onClose={() => setRatingModal(null)}
        bookingId={ratingModal?.bookingId}
        className={ratingModal?.className}
        onSubmitted={reloadActive}
      />
    </div>
  );
}
