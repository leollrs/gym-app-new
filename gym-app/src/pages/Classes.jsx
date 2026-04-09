import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Clock, Users, CalendarCheck, Dumbbell, Star, X, Repeat } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { classImageUrl } from '../lib/classImageUrl';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';

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

/* ---------- Star Rating Component ---------- */
function StarRating({ value, onChange, size = 28, readOnly = false }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(star)}
          className={`transition-transform ${readOnly ? '' : 'active:scale-110'}`}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
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

  if (!open) return null;

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    await supabase
      .from('gym_class_bookings')
      .update({ rating, notes: notes.trim() || null })
      .eq('id', bookingId);
    setSubmitting(false);
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
            aria-label="Close"
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

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full py-3 rounded-xl text-[14px] font-bold transition-all active:scale-[0.97] min-h-[44px] disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
        >
          {submitting ? '...' : t('classes.submit')}
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
            style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
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

export default function Classes() {
  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language === 'es';
  const use24h = isEs;
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const dayLabels = isEs ? DAY_LABELS_ES : DAY_LABELS_EN;
  const fmt = (timeStr) => fmtTime(timeStr, use24h);
  const { user, profile, gymConfig } = useAuth();
  const navigate = useNavigate();

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
  const [schedules, setSchedules] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [bookingCounts, setBookingCounts] = useState({});
  const [myUpcoming, setMyUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null); // schedule_id being acted on
  const [toast, setToast] = useState(null);
  const [recurringSet, setRecurringSet] = useState(new Set());

  // Check-in + rating modal state
  const [workoutPrompt, setWorkoutPrompt] = useState(null); // { bookingId, templateId, className }
  const [ratingModal, setRatingModal] = useState(null); // { bookingId, className }

  const selectedDow = selectedDate.getDay();
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const isSelectedToday = isSameDay(selectedDate, today);

  // Build the week days for the day strip
  const weekDays = useMemo(() => {
    const ws = startOfWeek(today, { weekStartsOn: 1 }); // Monday start
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i);
      return {
        date: d,
        label: dayLabels[d.getDay()],
        dayNum: format(d, 'd'),
        isToday: isSameDay(d, today),
        isSelected: isSameDay(d, selectedDate),
      };
    });
  }, [today, selectedDate, dayLabels]);

  // Fetch schedules for selected day + user bookings
  const loadData = useCallback(async () => {
    if (!profile?.gym_id || !user?.id) return;
    setLoading(true);

    const [schedRes, bookRes, countRes, upcomingRes, recurringRes] = await Promise.all([
      // Schedules for this day of week, joined with class details
      supabase
        .from('gym_class_schedules')
        .select('*, gym_classes(*)')
        .eq('gym_id', profile.gym_id)
        .eq('day_of_week', selectedDow)
        .order('start_time'),
      // User bookings for this specific date (include rating, notes, status, waitlist_position)
      supabase
        .from('gym_class_bookings')
        .select('id, schedule_id, status, rating, notes, waitlist_position')
        .eq('user_id', user.id)
        .eq('booking_date', selectedDateStr)
        .neq('status', 'cancelled'),
      // Booking counts per schedule for today (only confirmed)
      supabase
        .from('gym_class_bookings')
        .select('schedule_id')
        .eq('booking_date', selectedDateStr)
        .eq('status', 'confirmed'),
      // Upcoming + recent bookings for "My Bookings" section
      supabase
        .from('gym_class_bookings')
        .select('id, schedule_id, booking_date, status, rating, notes, waitlist_position, gym_class_schedules(*, gym_classes(*))')
        .eq('user_id', user.id)
        .neq('status', 'cancelled')
        .gte('booking_date', format(addDays(today, -14), 'yyyy-MM-dd'))
        .order('booking_date', { ascending: false })
        .limit(20),
      // Recurring bookings
      supabase
        .from('gym_class_recurring')
        .select('schedule_id')
        .eq('profile_id', user.id)
        .eq('is_active', true),
    ]);

    setSchedules(schedRes.data || []);
    setBookings(bookRes.data || []);

    // Build counts map: schedule_id -> count
    const counts = {};
    (countRes.data || []).forEach(b => {
      counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1;
    });
    setBookingCounts(counts);
    setMyUpcoming(upcomingRes.data || []);
    setRecurringSet(new Set((recurringRes.data || []).map(r => r.schedule_id)));
    setLoading(false);
  }, [profile?.gym_id, user?.id, selectedDow, selectedDateStr, today]);

  useEffect(() => { loadData(); }, [loadData]);

  // Book a class
  const handleBook = async (scheduleId, classId) => {
    setActionLoading(scheduleId);
    const { data, error } = await supabase.rpc('book_class', {
      p_schedule_id: scheduleId,
      p_class_id: classId,
      p_booking_date: selectedDateStr,
    });
    if (error) {
      setToast({ msg: error.message, type: 'error' });
    } else if (data?.status === 'waitlisted') {
      setToast({ msg: t('classes.classFull'), type: 'info' });
    } else {
      setToast({ msg: t('classes.bookingConfirmed'), type: 'success' });
    }
    setActionLoading(null);
    loadData();
  };

  // Cancel a booking (uses RPC for waitlist promotion)
  const handleCancel = async (bookingId) => {
    setActionLoading(bookingId);
    const { error } = await supabase.rpc('cancel_class_booking', { p_booking_id: bookingId });
    if (error) {
      setToast({ msg: error.message, type: 'error' });
    } else {
      setToast({ msg: t('classes.bookingCancelled'), type: 'info' });
    }
    setActionLoading(null);
    loadData();
  };

  // Toggle recurring booking
  const handleToggleRecurring = async (scheduleId, classId) => {
    const { data, error } = await supabase.rpc('toggle_recurring_class', {
      p_schedule_id: scheduleId,
      p_class_id: classId,
    });
    if (error) {
      setToast({ msg: error.message, type: 'error' });
      return;
    }
    if (data?.recurring) {
      setRecurringSet(prev => new Set([...prev, scheduleId]));
      setToast({ msg: t('classes.recurringActive'), type: 'success' });
    } else {
      setRecurringSet(prev => { const next = new Set(prev); next.delete(scheduleId); return next; });
      setToast({ msg: t('classes.recurringOff'), type: 'info' });
    }
  };

  // Check in to a class
  const handleCheckIn = async (bookingId, className) => {
    setActionLoading(bookingId);
    const { data, error } = await supabase.rpc('checkin_class', { p_booking_id: bookingId });
    setActionLoading(null);

    if (error) {
      setToast({ msg: error.message, type: 'error' });
      return;
    }

    setToast({ msg: t('classes.checkedIn'), type: 'success' });
    loadData();

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
    navigate(`/workout?routineId=${templateId}&classBookingId=${bookingId}`);
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

  // Helper: get booking for a schedule
  const getBooking = (scheduleId) => bookings.find(b => b.schedule_id === scheduleId);

  // Split myUpcoming into categories
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
    // Sort upcoming ascending
    upcoming.sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    // Past already descending from query
    return { upcomingBookings: upcoming, todayBookings: todayList, pastBookings: past };
  }, [myUpcoming, todayStr]);

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Go back" className="p-2 -ml-2 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
          <h1 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('classes.title')}</h1>
        </div>
      </div>

      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-5 space-y-5">

        {/* Day Strip */}
        <div className="flex items-center justify-between rounded-2xl p-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          {weekDays.map(({ date, label, dayNum, isToday, isSelected }) => (
            <button
              key={label + dayNum}
              type="button"
              onClick={() => setSelectedDate(date)}
              aria-label={`${label} ${dayNum}`}
              className="relative flex flex-col items-center flex-1 py-1 transition-all active:scale-95 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
            >
              <span
                className="text-[9px] font-medium uppercase tracking-[0.08em] mb-1"
                style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}
              >
                {label}
              </span>
              <div className="relative w-9 h-9 flex items-center justify-center">
                {isSelected && (
                  <div className="absolute inset-0 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                )}
                <span
                  className="relative z-10 text-[14px] font-bold"
                  style={{ color: isSelected ? '#000' : isToday ? 'var(--color-text-primary)' : 'var(--color-text-subtle)' }}
                >
                  {dayNum}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Class Cards */}
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
              const isRecurring = recurringSet.has(sched.id);
              const count = bookingCounts[sched.id] || 0;
              const capacity = sched.capacity || cls.capacity || 20;
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

              return (
                <div
                  key={sched.id}
                  className="relative rounded-2xl overflow-hidden"
                  style={{ border: `1px solid ${accentColor}33`, minHeight: 180 }}
                >
                  {/* Background image */}
                  {imgUrl && (
                    <img
                      src={imgUrl}
                      alt={`${cls.name} class`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0" style={{
                    background: imgUrl
                      ? `linear-gradient(to top, rgba(0,0,0,0.92) 40%, rgba(0,0,0,0.4) 100%)`
                      : 'var(--color-bg-card)',
                  }} />

                  {/* Content */}
                  <div className="relative z-10 p-5 flex flex-col justify-end h-full" style={{ minHeight: 180 }}>
                    {/* Color accent bar + template badge + recurring indicator */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-1 rounded-full" style={{ backgroundColor: accentColor }} />
                      {hasTemplate && (
                        <div
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: 'rgba(212,175,55,0.15)', color: '#D4AF37' }}
                        >
                          <Dumbbell size={10} />
                          <span>{t('classes.hasWorkout').split(' ').slice(-1)[0]}</span>
                        </div>
                      )}
                      {isRecurring && (
                        <div
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#10B981' }}
                        >
                          <Repeat size={10} />
                          <span>{t('classes.recurringActive')}</span>
                        </div>
                      )}
                    </div>

                    <h3 className="text-[17px] font-bold mb-1" style={{ color: '#fff' }}>{cls.name}</h3>

                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="flex items-center gap-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        <Clock size={12} />
                        {fmt(sched.start_time)} – {fmt(sched.end_time)}
                      </span>
                      {dur && (
                        <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                          {t('classes.minutes', { count: dur })}
                        </span>
                      )}
                    </div>

                    {cls.instructor && (
                      <p className="text-[12px] mb-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {t('classes.instructor')}: {cls.instructor}
                      </p>
                    )}

                    {/* Capacity bar */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                          <Users size={11} />
                          {count}/{capacity}
                        </span>
                        <span className="text-[11px]" style={{ color: isFull ? 'var(--color-danger)' : 'rgba(255,255,255,0.5)' }}>
                          {isFull ? t('classes.full') : t('classes.spotsLeft', { count: spotsLeft })}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min((count / capacity) * 100, 100)}%`,
                            backgroundColor: isFull ? 'var(--color-danger)' : accentColor,
                          }}
                        />
                      </div>
                    </div>

                    {/* Action button — state-based */}
                    {isAttendedRated ? (
                      /* Attended + rated: show stars */
                      <div className="flex items-center justify-center gap-2 py-2.5">
                        <StarRating value={bookingRating} readOnly size={18} />
                        <span className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          {t('classes.rated')}
                        </span>
                      </div>
                    ) : isAttendedNoRating ? (
                      /* Attended + no rating: Rate button */
                      <button
                        onClick={() => setRatingModal({ bookingId, className: cls.name })}
                        className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                        style={{ backgroundColor: '#D4AF37', color: '#000' }}
                      >
                        {t('classes.rateClass')}
                      </button>
                    ) : isWaitlisted ? (
                      /* Waitlisted: amber button with position */
                      <button
                        onClick={() => handleCancel(bookingId)}
                        disabled={isActing}
                        className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97] min-h-[44px] flex items-center justify-center gap-2 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-50"
                        style={{
                          backgroundColor: 'rgba(245,158,11,0.15)',
                          color: '#F59E0B',
                          border: '1px solid rgba(245,158,11,0.3)',
                        }}
                      >
                        <Clock size={14} />
                        {isActing ? '...' : t('classes.waitlisted', { position: waitlistPos })}
                      </button>
                    ) : isConfirmedToday ? (
                      /* Confirmed + today: Check In button (green) */
                      <button
                        onClick={() => handleCheckIn(bookingId, cls.name)}
                        disabled={isActing}
                        className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-success)', color: '#000' }}
                      >
                        {isActing ? '...' : t('classes.checkIn')}
                      </button>
                    ) : isConfirmedFuture ? (
                      /* Confirmed + future: muted Booked with cancel */
                      <button
                        onClick={() => handleCancel(bookingId)}
                        disabled={isActing}
                        className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-50"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.1)',
                          color: 'var(--color-danger)',
                          border: '1px solid rgba(239,68,68,0.3)',
                        }}
                      >
                        {isActing ? '...' : t('classes.cancelBooking')}
                      </button>
                    ) : (
                      /* Not booked: Book button (joins waitlist if full) */
                      <button
                        onClick={() => handleBook(sched.id, cls.id)}
                        disabled={isActing}
                        className="w-full py-2.5 rounded-xl text-[13px] font-bold transition-all active:scale-[0.97] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none disabled:opacity-50"
                        style={{
                          backgroundColor: isFull ? 'rgba(245,158,11,0.15)' : accentColor,
                          color: isFull ? '#F59E0B' : '#000',
                          border: isFull ? '1px solid rgba(245,158,11,0.3)' : 'none',
                        }}
                      >
                        {isActing ? '...' : isFull ? t('classes.joinWaitlist') : t('classes.book')}
                      </button>
                    )}

                    {/* Recurring toggle */}
                    {(isBooked || isRecurring) && !isAttended && (
                      <button
                        onClick={() => handleToggleRecurring(sched.id, cls.id)}
                        className="w-full mt-2 py-2 rounded-xl text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] min-h-[36px]"
                        style={{
                          backgroundColor: isRecurring ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
                          color: isRecurring ? '#10B981' : 'rgba(255,255,255,0.5)',
                          border: isRecurring ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <Repeat size={12} />
                        {t('classes.repeatWeekly')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* My Bookings */}
        <section className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-2 mb-4">
            <CalendarCheck size={16} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('classes.myBookings')}</h2>
          </div>

          {(todayBookings.length + upcomingBookings.length + pastBookings.length) === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('classes.noBookings')}</p>
          ) : (
            <div className="space-y-4">
              {/* Today's bookings */}
              {todayBookings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent)' }}>
                    {isEs ? 'Hoy' : 'Today'}
                  </p>
                  {todayBookings.map(b => {
                    const sched = b.gym_class_schedules;
                    const cls = sched?.gym_classes;
                    if (!sched || !cls) return null;
                    const isAttd = b.status === 'attended';
                    const hasRating = !!b.rating;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between px-3 py-3 rounded-xl"
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
                            onClick={() => setRatingModal({ bookingId: b.id, className: cls.name })}
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
                            onClick={() => handleCheckIn(b.id, cls.name)}
                            disabled={actionLoading === b.id}
                            className="text-[11px] px-3 py-1 rounded-full font-semibold flex-shrink-0 min-h-[32px] transition-all active:scale-95 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-success)', color: '#000' }}
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
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between px-3 py-3 rounded-xl"
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

              {/* Past attended bookings */}
              {pastBookings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('classes.attended')}
                  </p>
                  {pastBookings.map(b => {
                    const sched = b.gym_class_schedules;
                    const cls = sched?.gym_classes;
                    if (!sched || !cls) return null;
                    const hasRating = !!b.rating;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between px-3 py-3 rounded-xl"
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
                            onClick={() => setRatingModal({ bookingId: b.id, className: cls.name })}
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-semibold shadow-lg" style={{
          backgroundColor: toast.type === 'error' ? 'var(--color-danger)' : toast.type === 'success' ? 'var(--color-success)' : 'var(--color-bg-card)',
          color: toast.type === 'info' ? 'var(--color-text-primary)' : '#fff',
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
        onSubmitted={loadData}
      />
    </div>
  );
}
