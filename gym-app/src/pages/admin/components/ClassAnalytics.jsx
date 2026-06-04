import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, UserX, XCircle, Dumbbell, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { format12h } from '../../../lib/admin/classScheduleHelpers';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';

// Attendance → traffic-light color so weak slots/days pop visually.
const attColor = (pct) => pct >= 75 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
const fmtISO = (d) => d.toISOString().slice(0, 10);

/**
 * Full per-class analytics. The same booking set is sliced every which way:
 *   • time navigator — Week (steppable ← →), Month (steppable), 90d, All
 *   • by trainer — attendance rolled up per slot-teacher (gym_class_schedules.trainer_id)
 *   • by time slot — EVERY scheduled slot listed (recurring always; specific in-range),
 *     with a "Sin datos" fallback when a slot had no bookings in the window
 *   • by day of week — attendance bars Sun→Sat
 *   • rating breakdown + recent workout results (template classes)
 *
 * trainer_id on schedules arrived in migration 0512; reads are resilient so
 * the page still works if it hasn't been applied yet (trainer just shows blank).
 */
export default function ClassAnalytics({ classItem, t, lang = 'es' }) {
  const classId = classItem?.id;
  const gymId = classItem?.gym_id;
  const hasTemplate = !!classItem?.workout_template_id;
  const maxCap = classItem?.max_capacity || 0;

  const [gran, setGran] = useState('week'); // 'week' | 'month' | '90' | 'all'
  const [anchor, setAnchor] = useState(() => new Date());

  const range = useMemo(() => {
    if (gran === 'all') return { from: null, to: null, label: t('admin.classes.periodAll', 'All time'), nav: false };
    if (gran === '90') {
      const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 90);
      return { from: fmtISO(from), to: fmtISO(to), label: t('admin.classes.last90', 'Last 90 days'), nav: false };
    }
    if (gran === 'month') {
      const y = anchor.getFullYear(), m = anchor.getMonth();
      return { from: fmtISO(new Date(y, m, 1)), to: fmtISO(new Date(y, m + 1, 0)), label: anchor.toLocaleDateString(lang, { month: 'long', year: 'numeric' }), nav: true };
    }
    // week (Sun–Sat containing anchor)
    const s = new Date(anchor); s.setDate(s.getDate() - s.getDay());
    const e = new Date(s); e.setDate(e.getDate() + 6);
    const label = `${s.toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return { from: fmtISO(s), to: fmtISO(e), label, nav: true };
  }, [gran, anchor, lang, t]);

  const step = (dir) => setAnchor(prev => {
    const d = new Date(prev);
    if (gran === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * 7);
    return d;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'class-analytics', classId, range.from, range.to],
    queryFn: async () => {
      // Bookings in window
      let q = supabase
        .from('gym_class_bookings')
        .select('schedule_id, status, attended, rating, booking_date')
        .eq('class_id', classId)
        .limit(8000);
      if (range.from) q = q.gte('booking_date', range.from);
      if (range.to) q = q.lte('booking_date', range.to);
      const { data: bookings } = await q;

      // Schedules WITH trainer_id — resilient to 0512 not being applied yet.
      let scheds = [];
      const full = await supabase.from('gym_class_schedules').select('id, day_of_week, start_time, specific_date, trainer_id').eq('class_id', classId);
      if (full.error) {
        const basic = await supabase.from('gym_class_schedules').select('id, day_of_week, start_time, specific_date').eq('class_id', classId);
        scheds = (basic.data || []).map(s => ({ ...s, trainer_id: null }));
      } else {
        scheds = full.data || [];
      }

      // Resolve trainer names
      const trainerIds = [...new Set(scheds.map(s => s.trainer_id).filter(Boolean))];
      const trainerNames = {};
      if (trainerIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', trainerIds);
        (profs || []).forEach(p => { trainerNames[p.id] = p.full_name; });
      }

      let recentResults = [];
      if (hasTemplate) {
        const { data: rr } = await supabase
          .from('gym_class_bookings')
          .select('profile_id, rating, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs)')
          .eq('class_id', classId)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        recentResults = rr || [];
      }
      return { bookings: bookings || [], scheds, trainerNames, recentResults };
    },
    staleTime: 60_000,
    enabled: !!classId,
  });

  const a = useMemo(() => {
    const bookings = data?.bookings || [];
    const scheds = data?.scheds || [];
    const trainerNames = data?.trainerNames || {};
    const today = fmtISO(new Date());
    const isPast = (b) => b.booking_date < today;

    // The class ALREADY has an instructor — use it as the per-slot fallback so
    // "by trainer" works out of the box. A per-slot trainer_id (0512) only
    // overrides it for classes where different instructors teach different slots.
    const classTrainers = (classItem?.gym_class_trainers || []).map(r => r?.trainer).filter(Boolean);
    const primaryTrainer = classItem?.trainer || classTrainers[0] || null;
    const classInstructorName = primaryTrainer?.full_name || classItem?.instructor_name || null;
    const classInstructorId = primaryTrainer?.id || (classItem?.instructor_name ? `name:${classItem.instructor_name}` : null);
    const effId = (s) => s.trainer_id || classInstructorId;
    const nameFor = (tid) => {
      if (!tid) return t('admin.classes.noTrainer', 'No trainer');
      if (classInstructorId && tid === classInstructorId) return classInstructorName || t('admin.classes.unknown', 'Unknown');
      return trainerNames[tid] || classInstructorName || t('admin.classes.unknown', 'Unknown');
    };

    const dowName = (dow) => new Date(2024, 0, 7 + dow).toLocaleDateString(lang, { weekday: 'short' }); // Jan 7 2024 = Sunday
    const slotLabel = (s) => {
      if (!s) return '—';
      if (s.specific_date) return `${new Date(s.specific_date + 'T00:00:00').toLocaleDateString(lang, { month: 'short', day: 'numeric' })} · ${format12h(s.start_time)}`;
      return `${dowName(s.day_of_week)} · ${format12h(s.start_time)}`;
    };

    const calc = (rows) => {
      const total = rows.length;
      const attended = rows.filter(b => b.attended).length;
      const cancelled = rows.filter(b => b.status === 'cancelled').length;
      const noShows = rows.filter(b => !b.attended && b.status === 'confirmed' && isPast(b)).length;
      const confirmedPast = rows.filter(b => isPast(b) && (b.status === 'confirmed' || b.attended)).length;
      const rated = rows.filter(b => b.attended && b.rating != null);
      const avgRating = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
      const sessions = new Set(rows.map(b => b.booking_date)).size;
      return {
        total, attended, cancelled, noShows, confirmedPast, sessions,
        attendanceRate: total ? Math.round((attended / total) * 100) : 0,
        noShowRate: confirmedPast ? Math.round((noShows / confirmedPast) * 100) : 0,
        cancellationRate: total ? Math.round((cancelled / total) * 100) : 0,
        avgRating: avgRating != null ? avgRating.toFixed(1) : null,
        avgFill: (sessions && maxCap) ? Math.round((total / sessions / maxCap) * 100) : null,
      };
    };

    const overall = calc(bookings);

    const starDist = [0, 0, 0, 0, 0];
    bookings.filter(b => b.attended && b.rating != null).forEach(b => {
      starDist[Math.max(0, Math.min(4, Math.round(b.rating) - 1))]++;
    });

    const bySchedId = {};
    bookings.forEach(b => { if (b.schedule_id) (bySchedId[b.schedule_id] ||= []).push(b); });

    // ALL schedules (recurring always; specific only if in-range), each with metrics or no-data
    const inRange = (s) => {
      if (!s.specific_date) return true;
      if (!range.from) return true;
      return s.specific_date >= range.from && s.specific_date <= range.to;
    };
    const visible = scheds.filter(inRange).sort((x, y) => {
      const xs = x.specific_date ? 1 : 0, ys = y.specific_date ? 1 : 0;
      if (xs !== ys) return xs - ys;
      if (!xs) return (x.day_of_week ?? 0) - (y.day_of_week ?? 0) || (x.start_time || '').localeCompare(y.start_time || '');
      return (x.specific_date || '').localeCompare(y.specific_date || '');
    });
    const bySlot = visible.map(s => {
      const rows = bySchedId[s.id] || [];
      return {
        sid: s.id, label: slotLabel(s),
        trainerId: effId(s),
        trainerName: effId(s) ? nameFor(effId(s)) : null,
        hasData: rows.length > 0,
        ...calc(rows),
      };
    });

    // best / worst (need ≥1 session)
    const ranked = bySlot.filter(s => s.hasData && s.sessions >= 1);
    let bestSid = null, worstSid = null;
    if (ranked.length >= 2) {
      const byAtt = [...ranked].sort((p, q) => q.attendanceRate - p.attendanceRate);
      if (byAtt[0].attendanceRate !== byAtt[byAtt.length - 1].attendanceRate) {
        bestSid = byAtt[0].sid; worstSid = byAtt[byAtt.length - 1].sid;
      }
    }

    // By trainer — roll up bookings across each effective trainer (per-slot
    // override else the class instructor).
    const anyTrainer = visible.some(s => effId(s));
    const trainerGroups = {};
    visible.forEach(s => {
      const key = effId(s) || '__none__';
      (trainerGroups[key] ||= { rows: [], slots: 0 });
      trainerGroups[key].rows.push(...(bySchedId[s.id] || []));
      trainerGroups[key].slots += 1;
    });
    const byTrainer = Object.entries(trainerGroups).map(([key, g]) => ({
      key,
      name: key === '__none__' ? t('admin.classes.noTrainer', 'No trainer') : nameFor(key),
      slots: g.slots,
      ...calc(g.rows),
    })).sort((x, y) => y.attendanceRate - x.attendanceRate);

    // By day of week (from booking dates)
    const byDowMap = {};
    bookings.forEach(b => { const dow = new Date(b.booking_date + 'T00:00:00').getDay(); (byDowMap[dow] ||= []).push(b); });
    const byDow = Object.entries(byDowMap).map(([dow, rows]) => ({ dow: Number(dow), name: dowName(Number(dow)), ...calc(rows) })).sort((x, y) => x.dow - y.dow);

    return { overall, starDist, bySlot, byTrainer, anyTrainer, byDow, bestSid, worstSid, hasSlots: visible.length > 0, hasBookings: bookings.length > 0 };
  }, [data, range, maxCap, lang, t, classItem]);

  const GRANS = [
    { key: 'week', label: t('admin.classes.granWeek', 'Week') },
    { key: 'month', label: t('admin.classes.granMonth', 'Month') },
    { key: '90', label: t('admin.classes.period90', '90d') },
    { key: 'all', label: t('admin.classes.periodAll', 'All') },
  ];

  return (
    <div className="space-y-4 p-1">
      {/* Granularity pills */}
      <div className="inline-flex w-full" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', borderRadius: 999, padding: 3, gap: 2 }}>
        {GRANS.map(g => {
          const on = gran === g.key;
          return (
            <button key={g.key} onClick={() => setGran(g.key)}
              className="flex-1"
              style={{ height: 28, borderRadius: 999, fontSize: 12, fontWeight: 700,
                color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                background: on ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent' }}>
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Range label + week/month stepper */}
      <div className="flex items-center justify-center gap-3">
        {range.nav && (
          <button onClick={() => step(-1)} aria-label={t('admin.classes.previousPeriod', 'Previous')} className="grid place-items-center"
            style={{ width: 32, height: 32, borderRadius: 999, border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)', color: 'var(--color-admin-text-sub)' }}>
            <ChevronLeft size={15} strokeWidth={2.2} />
          </button>
        )}
        <span className="text-center capitalize" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.2px', color: 'var(--color-text-primary)', minWidth: 150 }}>{range.label}</span>
        {range.nav && (
          <button onClick={() => step(1)} aria-label={t('admin.classes.nextPeriod', 'Next')} className="grid place-items-center"
            style={{ width: 32, height: 32, borderRadius: 999, border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)', color: 'var(--color-admin-text-sub)' }}>
            <ChevronRight size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 px-1">
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.loading', 'Loading...')}</span>
        </div>
      ) : (
        <>
          {/* Overall KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="p-3.5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.attendanceRate')}</p>
              <p className="text-[18px] font-bold" style={{ color: a.overall.total ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>{a.overall.total ? `${a.overall.attendanceRate}%` : '--'}</p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{a.overall.attended}/{a.overall.total}</p>
            </div>
            <div className="p-3.5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.avgRating')}</p>
              {a.overall.avgRating ? (
                <div className="flex items-center gap-1">
                  <p className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{a.overall.avgRating}</p>
                  <Star size={14} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
                </div>
              ) : <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>--</p>}
            </div>
            <div className="p-3.5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <UserX size={11} style={{ color: 'var(--color-danger)' }} />
                <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noShowRate')}</p>
              </div>
              <p className="text-[18px] font-bold" style={{ color: a.overall.noShowRate > 20 ? 'var(--color-danger)' : a.overall.noShowRate > 10 ? 'var(--color-warning)' : 'var(--color-success)' }}>{a.overall.confirmedPast ? `${a.overall.noShowRate}%` : '--'}</p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{a.overall.noShows} {t('admin.classes.noShows')}</p>
            </div>
            <div className="p-3.5 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <XCircle size={11} style={{ color: 'var(--color-warning)' }} />
                <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.cancellationRate')}</p>
              </div>
              <p className="text-[18px] font-bold" style={{ color: a.overall.cancellationRate > 30 ? 'var(--color-danger)' : a.overall.cancellationRate > 15 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>{a.overall.total ? `${a.overall.cancellationRate}%` : '--'}</p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{a.overall.cancelled} {t('admin.classes.cancellations')}</p>
            </div>
          </div>

          {/* By trainer */}
          {a.anyTrainer ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.byTrainer', 'By trainer')}</p>
              <div className="space-y-1.5">
                {a.byTrainer.map(tr => (
                  <div key={tr.key} className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="w-7 h-7 rounded-full grid place-items-center flex-shrink-0" style={{ background: tr.key === '__none__' ? 'var(--color-admin-panel)' : 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}>
                      <User size={13} style={{ color: tr.key === '__none__' ? 'var(--color-text-muted)' : 'var(--color-accent)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{tr.name}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{tr.slots} {t('admin.classes.slotsLabel', 'slots')} · {tr.sessions} {t('admin.classes.sessions', 'sessions')}{tr.avgRating ? ` · ${tr.avgRating}★` : ''}</p>
                    </div>
                    <span className="text-[15px] font-bold tabular-nums flex-shrink-0" style={{ fontFamily: DISPLAY_FONT, color: tr.total ? attColor(tr.attendanceRate) : 'var(--color-text-muted)' }}>{tr.total ? `${tr.attendanceRate}%` : '--'}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : a.hasSlots ? (
            <p className="text-[11px] italic px-1" style={{ color: 'var(--color-text-faint)' }}>{t('admin.classes.assignTrainersHint', 'Assign a trainer to each time slot (when adding schedules) to compare performance by trainer.')}</p>
          ) : null}

          {/* By time slot — all slots, no-data fallback */}
          {a.hasSlots ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.performanceBySlot', 'Performance by time slot')}</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-deep)' }}>
                {a.bySlot.map((s, i) => (
                  <div key={s.sid} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-subtle)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12.5px] font-semibold capitalize truncate" style={{ color: 'var(--color-text-primary)' }}>{s.label}</span>
                        {s.sid === a.bestSid && <span className="inline-flex items-center gap-0.5" style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--color-success-ink)', background: 'var(--color-success-soft)', padding: '1px 6px', borderRadius: 999 }}><TrendingUp size={9} /> {t('admin.classes.bestSlot', 'Best')}</span>}
                        {s.sid === a.worstSid && <span className="inline-flex items-center gap-0.5" style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--color-danger-ink)', background: 'var(--color-danger-soft)', padding: '1px 6px', borderRadius: 999 }}><TrendingDown size={9} /> {t('admin.classes.worstSlot', 'Weak')}</span>}
                      </div>
                      <p className="text-[10px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: 'var(--color-text-muted)' }}>
                        {s.trainerName && <span className="inline-flex items-center gap-0.5"><User size={9} style={{ color: 'var(--color-accent)' }} />{s.trainerName}</span>}
                        {s.trainerName && s.hasData && <span style={{ opacity: 0.5 }}>·</span>}
                        {s.hasData
                          ? <span>{s.sessions} {t('admin.classes.sessions', 'sessions')} · {s.total} {t('admin.classes.bookingsLower', 'bookings')}{s.avgFill != null ? ` · ${s.avgFill}% ${t('admin.classes.full', 'full')}` : ''}</span>
                          : <span style={{ fontStyle: 'italic', color: 'var(--color-text-faint)' }}>{t('admin.classes.noDataYet', 'No data yet')}</span>}
                      </p>
                    </div>
                    {s.hasData && s.avgRating && (
                      <span className="inline-flex items-center gap-0.5 flex-shrink-0" style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {s.avgRating}<Star size={10} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
                      </span>
                    )}
                    <div className="flex-shrink-0 text-right" style={{ width: 86 }}>
                      {s.hasData ? (
                        <>
                          <span className="text-[14px] font-bold tabular-nums" style={{ fontFamily: DISPLAY_FONT, color: attColor(s.attendanceRate) }}>{s.attendanceRate}%</span>
                          <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border-subtle)' }}>
                            <div className="h-full rounded-full" style={{ width: `${s.attendanceRate}%`, background: attColor(s.attendanceRate) }} />
                          </div>
                        </>
                      ) : (
                        <span className="text-[13px]" style={{ color: 'var(--color-text-faint)' }}>—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12px] italic py-2 px-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noScheduleSlots')}</p>
          )}

          {/* By day of week */}
          {a.byDow.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.byDayOfWeek', 'By day of week')}</p>
              <div className="space-y-1.5">
                {a.byDow.map(d => (
                  <div key={d.dow} className="flex items-center gap-2.5">
                    <span className="text-[11px] capitalize w-10 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{d.name}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-deep)' }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${d.attendanceRate}%`, background: attColor(d.attendanceRate) }} />
                    </div>
                    <span className="text-[11px] font-bold tabular-nums w-9 text-right flex-shrink-0" style={{ color: attColor(d.attendanceRate) }}>{d.attendanceRate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Star distribution */}
          {a.overall.avgRating && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.ratingBreakdown', 'Rating breakdown')}</p>
              <div className="space-y-1.5">
                {[5, 4, 3, 2, 1].map(star => {
                  const count = a.starDist[star - 1];
                  const maxCount = Math.max(...a.starDist, 1);
                  return (
                    <div key={star} className="flex items-center gap-1.5">
                      <span className="text-[9px] w-3 text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{star}</span>
                      <Star size={8} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: 'var(--color-accent)' }} />
                      </div>
                      <span className="text-[9px] w-4 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent workout results */}
          {hasTemplate && (data?.recentResults?.length > 0) && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.recentResults')}</p>
              <div className="space-y-1.5">
                {data.recentResults.map((r, i) => (
                  <div key={`${r.profile_id}-${i}`} className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    {r.profiles?.avatar_url ? (
                      <img src={r.profiles.avatar_url} alt={r.profiles?.full_name || ''} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                        <span className="text-[10px] font-bold" style={{ color: 'var(--color-accent)' }}>{r.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <span className="flex-1 text-[12px] truncate" style={{ color: 'var(--color-text-primary)' }}>{r.profiles?.full_name || t('admin.classes.unknown', 'Unknown')}</span>
                    {r.workout_sessions?.total_volume_lbs != null && (
                      <span className="text-[11px] flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                        <Dumbbell size={11} /> {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} {t('admin.classes.lbs', 'lbs')}
                      </span>
                    )}
                    {r.rating != null && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {[1, 2, 3, 4, 5].map(sIdx => (
                          <Star key={sIdx} size={10} style={sIdx <= Math.round(r.rating) ? { color: 'var(--color-accent)', fill: 'var(--color-accent)' } : { color: 'var(--color-text-faint)' }} />
                        ))}
                      </div>
                    )}
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
