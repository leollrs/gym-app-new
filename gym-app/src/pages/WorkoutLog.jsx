import React, { useState, useEffect, useMemo } from 'react';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { es as esLocale, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronDown, ChevronRight, Trophy, Dumbbell, Clock, Zap, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import { sanitize } from '../lib/sanitize';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import BackdatedWorkoutModal from '../components/BackdatedWorkoutModal';

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const formatDate = (iso, locale) => {
  return format(new Date(iso), 'EEE, MMM d', { locale });
};

const formatMonthYear = (iso, locale) => {
  return format(new Date(iso), 'LLLL yyyy', { locale });
};

// ── Session Card ──────────────────────────────────────────────────────────────
const SessionCard = ({ session, onEdit }) => {
  const { t, i18n } = useTranslation('pages');
  const dfLocale = i18n.language === 'es' ? esLocale : enUS;
  const [expanded, setExpanded] = useState(false);

  const exercises  = session.session_exercises ?? [];
  const allSets    = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prSets     = allSets.filter(s => s.is_pr);
  const volumeK    = (parseFloat(session.total_volume_lbs) || 0);

  const sortedExercises = useMemo(
    () => [...exercises].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [exercises]
  );
  const volumeStr  = volumeK >= 1000
    ? `${(volumeK / 1000).toFixed(1)}k lbs`
    : `${Math.round(volumeK)} lbs`;

  return (
    <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">

      {/* Main row */}
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-t-2xl"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        {/* Date block */}
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">
            {format(new Date(session.completed_at), 'LLL', { locale: dfLocale })}
          </p>
          <p className="text-[24px] font-black leading-none" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary)' }}>
            {new Date(session.completed_at).getDate()}
          </p>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[16px] leading-tight truncate" style={{ color: 'var(--color-text-primary)' }}>
            {sanitize(session.name)}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={11} /> {formatDuration(session.duration_seconds)}
            </span>
            <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Zap size={11} /> {volumeStr}
            </span>
            <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              <Dumbbell size={11} /> {t('workoutLog.exercisesCount', { count: exercises.length })}
            </span>
            {prSets.length > 0 && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-[#D4AF37]">
                <Trophy size={11} /> {t('workoutLog.prCount', { count: prSets.length })}
              </span>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        <ChevronDown
          size={18}
          className="flex-shrink-0 mt-1 transition-transform duration-200"
          style={{ color: 'var(--color-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Expanded exercise list */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-white/[0.06]">
          <div className="pt-3 flex justify-end">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit?.(session); }}
              className="inline-flex items-center gap-1.5 transition-colors active:scale-95"
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid var(--color-border-default, rgba(127,127,127,0.18))',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
              }}
              aria-label={t('workoutLog.editAria')}
            >
              <Pencil size={11} strokeWidth={2.4} />
              {t('workoutLog.edit')}
            </button>
          </div>
          <div className="pt-3 flex flex-col gap-3">
            {sortedExercises
              .map((ex) => {
                const completedSets = (ex.session_sets ?? []).filter(s => s.is_completed);
                const sortedSets = [...completedSets].sort((a, b) => a.set_number - b.set_number);
                const hasPR = completedSets.some(s => s.is_pr);

                return (
                  <div key={ex.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                        {sanitize(ex.snapshot_name)}
                      </p>
                      {hasPR && <Trophy size={13} className="text-[#D4AF37]" />}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-col gap-1.5">
                        {sortedSets.map((set) => {
                          const drops = Array.isArray(set.drops) ? set.drops.filter(d => (parseInt(d.reps, 10) || 0) > 0) : [];
                          return (
                            <div key={`set-${set.set_number}`} className="flex flex-wrap items-center gap-1.5">
                              <div
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                                style={
                                  set.is_pr
                                    ? { background: 'rgba(212,175,55,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(212,175,55,0.25)' }
                                    : { background: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid rgba(255,255,255,0.08)' }
                                }
                              >
                                <span>{set.weight_lbs} × {set.reps}</span>
                                {set.is_pr && <span>{t('workoutLog.prBadge')}</span>}
                                {set.rpe && (
                                  <span
                                    className="text-[10px] font-bold rounded px-1 py-px ml-0.5"
                                    style={{
                                      background: set.rpe <= 3 ? 'rgba(16,185,129,0.15)' : set.rpe <= 6 ? 'rgba(234,179,8,0.15)' : set.rpe <= 8 ? 'rgba(249,115,22,0.15)' : 'rgba(239,68,68,0.15)',
                                      color: set.rpe <= 3 ? '#34D399' : set.rpe <= 6 ? '#FBBF24' : set.rpe <= 8 ? '#FB923C' : '#F87171',
                                    }}
                                  >
                                    @{set.rpe}
                                  </span>
                                )}
                              </div>
                              {drops.map((d, di) => (
                                <div
                                  key={`drop-${set.set_number}-${di}`}
                                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold"
                                  style={{
                                    background: 'rgba(212,175,55,0.06)',
                                    color: 'var(--color-text-muted)',
                                    border: '1px dashed rgba(212,175,55,0.30)',
                                  }}
                                >
                                  <span className="text-[9px] font-extrabold tracking-wider opacity-70">↓D{di + 1}</span>
                                  <span>{d.weight || 0} × {d.reps}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      {/* Show notes for sets that have them */}
                      {sortedSets.filter(s => s.notes).length > 0 && (
                        <div className="flex flex-col gap-0.5 pl-0.5">
                          {sortedSets
                            .filter(s => s.notes)
                            .map(set => (
                              <p key={`note-${set.set_number}`} className="text-[11px] italic truncate" style={{ color: 'var(--color-text-subtle)' }}>
                                {t('workoutLog.setLabel', { number: set.set_number })}: {set.notes}
                              </p>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const WorkoutLog = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const dfLocale = i18n.language === 'es' ? esLocale : enUS;

  const logCacheKey = `workout-log-${user?.id}`;
  const [sessions, setSessions] = useCachedState(logCacheKey, []);
  const [loading, setLoading]   = useState(!hasCachedState(logCacheKey));
  const [visibleCount, setVisibleCount] = useState(embedded ? 5 : 20);
  const [routines, setRoutines] = useState([]);
  const [editingSession, setEditingSession] = useState(null);

  // Load the user's routines so the edit modal's routine-mode picker can
  // resolve names. The set is small and rarely changes, so a single fetch
  // alongside the session list is fine.
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    supabase
      .from('routines')
      .select('id, name')
      .eq('profile_id', user.id)
      .then(({ data }) => { if (alive) setRoutines(data || []); });
    return () => { alive = false; };
  }, [user?.id]);

  const handleEditSaved = () => {
    // The edit flow soft-deletes the original and re-logs — refetch the list.
    setEditingSession(null);
    if (!user?.id) return;
    supabase
      .from('workout_sessions')
      .select(`
        id, name, routine_id, started_at, completed_at, duration_seconds, total_volume_lbs,
        session_exercises(
          id, exercise_id, snapshot_name, position,
          session_sets(set_number, weight_lbs, reps, is_completed, is_pr, rpe, notes, drops)
        )
      `)
      .eq('profile_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(embedded ? 5 : 100)
      .then(({ data }) => setSessions(data ?? []));
  };

  useEffect(() => { document.title = `${t('workoutLog.title')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from('workout_sessions')
        .select(`
          id, name, routine_id, started_at, completed_at, duration_seconds, total_volume_lbs,
          session_exercises(
            id, exercise_id, snapshot_name, position,
            session_sets(set_number, weight_lbs, reps, is_completed, is_pr, rpe, notes, drops)
          )
        `)
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(embedded ? 5 : 100);

      if (error) { logger.error('WorkoutLog: failed to load sessions:', error); }
      setSessions(data ?? []);
      setLoading(false);
    };

    load();
  }, [user]);

  // Limit visible sessions for progressive loading
  const visibleSessions = sessions.slice(0, visibleCount);

  // Group visible sessions by month
  const grouped = visibleSessions.reduce((acc, s) => {
    const key = formatMonthYear(s.completed_at, dfLocale);
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const months = Object.keys(grouped);

  // Collapse state per month — first month open by default
  const [collapsedMonths, setCollapsedMonths] = useState({});
  const toggleMonth = (month) =>
    setCollapsedMonths(prev => ({ ...prev, [month]: !prev[month] }));

  return (
    <div className={embedded ? 'animate-fade-in' : 'mx-auto w-full max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 md:px-6 lg:px-8 pt-6 pb-28 md:pb-12 animate-fade-in'}>

      {/* Header */}
      {!embedded && (
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('workoutLog.back')}
          className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors hover:opacity-70 flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-muted)' }}
        >
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-[22px] leading-tight truncate" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('workoutLog.title')}
          </h1>
          {!loading && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('workoutLog.workoutsCompleted', { count: sessions.length })}
            </p>
          )}
        </div>
      </div>
      )}

      {/* Loading */}
      {loading && (
        <Skeleton variant="list-item" count={3} />
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <EmptyState
          icon={Dumbbell}
          title={t('workoutLog.emptyTitle')}
          description={t('workoutLog.emptyDescription')}
          actionLabel={t('workoutLog.emptyAction')}
          onAction={() => navigate('/workouts')}
        />
      )}

      {/* Sessions grouped by month (collapsible) */}
      {!loading && months.map((month, idx) => {
        const isCollapsed = collapsedMonths[month] ?? (idx > 0);
        return (
          <div key={month} className="mb-8">
            <button
              type="button"
              onClick={() => toggleMonth(month)}
              aria-expanded={!isCollapsed}
              className="flex items-center gap-2 mb-3 group w-full text-left min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
            >
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                style={{ color: 'var(--color-text-subtle)' }}
              />
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] transition-colors" style={{ color: 'var(--color-text-muted)' }}>
                {month}
              </p>
              <span className="text-[10px] font-medium ml-1" style={{ color: 'var(--color-text-subtle)' }}>
                ({grouped[month].length})
              </span>
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                {grouped[month].map(session => (
                  <SessionCard key={session.id} session={session} onEdit={setEditingSession} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Load more button */}
      {!loading && visibleCount < sessions.length && (
        <button
          onClick={() => setVisibleCount(prev => prev + 20)}
          className="w-full py-3 mt-4 rounded-2xl bg-white/[0.04] text-[13px] font-semibold hover:bg-white/[0.06] transition-colors duration-200 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('workoutLog.loadMore', { count: sessions.length - visibleCount })}
        </button>
      )}

      {/* Edit modal — opens with the chosen session pre-populated. */}
      <BackdatedWorkoutModal
        open={!!editingSession}
        onClose={() => setEditingSession(null)}
        onSaved={handleEditSaved}
        routines={routines}
        editingSession={editingSession}
      />
    </div>
  );
};

export default WorkoutLog;
