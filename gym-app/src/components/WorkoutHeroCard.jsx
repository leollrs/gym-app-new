import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Timer, CheckCircle2, Dumbbell, Clock, Flame, Trash2 } from 'lucide-react';
import { exName } from '../lib/exerciseName';
import ReadinessModal from './ReadinessModal';
import { useAuth } from '../contexts/AuthContext';
import { useRecentSessionsWithSets } from '../hooks/useSupabaseQuery';
import { computeDashboardReadiness } from '../lib/readinessEngine';
import { useRecoveryMetrics } from '../hooks/useRecoveryMetrics';

const CYCLE_INTERVAL = 4000; // ms per exercise

const WorkoutHeroCard = ({
  routineId,
  exercises = [],
  isActive = false,
  isCompleted = false,
  activeSetsCompleted = 0,
  activeSetsTotal = 0,
  routineName = '',
  exerciseCount = 0,
  estimatedMin = 0,
  estimatedCal = 0,
  onAttachCardio,
  cardioAttached = false,
  cardioFinisher = null,
  completedSession = null, // { id, duration_seconds, total_volume_lbs, name, completed_at }
  onDelete = null, // Optional: when isCompleted, renders a trash-icon button that calls this.
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [readyVideos, setReadyVideos] = useState(new Set());
  const [readinessOpen, setReadinessOpen] = useState(false);
  const videoRefs = useRef({});

  // Live readiness score — uses the same function the Recovery modal does
  // so the two surfaces can't drift. `readinessOpen` is in the dep array
  // so closing the modal (where a fresh wellness check-in / metric fetch
  // may have updated localStorage) re-runs the memo immediately.
  const { user } = useAuth();
  const { data: recentSessions = [] } = useRecentSessionsWithSets(user?.id, 14);
  // Self-refreshing recovery metrics (mount + app foreground), shared with the
  // Dashboard chip so the pill and chip never drift. `readinessOpen` re-reads
  // the cache when the modal closes.
  const recoveryMetrics = useRecoveryMetrics(readinessOpen);
  const readinessScore = React.useMemo(() => {
    let todaySoreness = null;
    try {
      const d = new Date();
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const raw = localStorage.getItem('tugympr_wellness_last_checkin');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === dateKey && typeof parsed.soreness === 'number') {
          todaySoreness = parsed.soreness;
        }
      }
    } catch { /* ignore */ }
    return computeDashboardReadiness({
      sessions: recentSessions,
      recoveryMetrics,
      soreness: todaySoreness,
    });
  }, [recentSessions, recoveryMetrics, readinessOpen]);

  // Preload all exercise videos on mount
  useEffect(() => {
    exercises.forEach((ex, i) => {
      if (ex.video && !videoRefs.current[i]) {
        const v = document.createElement('video');
        v.src = ex.video;
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.load();
        videoRefs.current[i] = v;
      }
    });
  }, [exercises]);

  const handleVideoReady = useCallback((idx) => {
    setReadyVideos(prev => new Set(prev).add(idx));
  }, []);

  // Cycle through exercises
  useEffect(() => {
    if (exercises.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % exercises.length);
    }, CYCLE_INTERVAL);
    return () => clearInterval(timer);
  }, [exercises.length]);

  const current = exercises[currentIndex] || {};
  const exerciseName = exName(current) || t('workoutHeroCard.workout');
  const exerciseVideo = current.video || null;
  const hasMedia = !!exerciseVideo;

  const displayName = routineName || exerciseName;
  const displayExCount = exerciseCount || exercises.length;

  // ── Big completed-state hero card ────────────────────────────────────────
  // Tall, prominent green-tinted card with a large check badge, a "WORKOUT
  // COMPLETED" pill, the routine name, and a stats grid. Tapping the card
  // opens the session summary; the trash icon in the top-right invokes
  // onDelete (parent handles confirm + delete).
  if (isCompleted) {
    const durMin = Math.round((completedSession?.duration_seconds || 0) / 60);
    const totalVol = parseFloat(completedSession?.total_volume_lbs) || 0;
    const volLabel = totalVol >= 1000 ? `${(totalVol / 1000).toFixed(1)}k` : Math.round(totalVol);
    const handleOpenSummary = () => {
      if (completedSession?.id) {
        navigate('/session-summary', {
          state: {
            routineName: completedSession.name || routineName,
            elapsedTime: completedSession.duration_seconds,
            totalVolume: totalVol,
            sessionId: completedSession.id,
            completedAt: completedSession.completed_at,
          },
        });
      }
    };
    return (
      <div className="relative w-full">
        <motion.button
          type="button"
          onClick={handleOpenSummary}
          whileTap={{ scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          aria-label={t('workoutHeroCard.ariaCompleted', { name: displayName, defaultValue: `${displayName} completed` })}
          className="w-full text-left rounded-[22px] block focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] overflow-hidden"
          style={{
            background:
              'linear-gradient(165deg, color-mix(in srgb, #10B981 14%, var(--color-bg-card)) 0%, var(--color-bg-card) 70%)',
            border: '1px solid color-mix(in srgb, #10B981 28%, transparent)',
            padding: '22px 20px 18px',
            boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 10px 28px rgba(16,185,129,0.10)',
            minHeight: 200,
          }}
        >
          {/* Big check badge */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'rgba(16,185,129,0.18)',
              border: '1px solid rgba(16,185,129,0.40)',
            }}
          >
            <CheckCircle2 size={30} strokeWidth={2.4} style={{ color: '#10B981' }} />
          </div>

          {/* Pill label */}
          <div
            className="inline-block text-[10px] font-bold uppercase mb-2 px-2 py-1 rounded-full"
            style={{
              color: '#10B981',
              letterSpacing: '0.14em',
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.25)',
            }}
          >
            {t('workoutHeroCard.workoutComplete', 'Workout completed')}
          </div>

          {/* Routine name */}
          <h3
            className="leading-tight"
            style={{
              color: 'var(--color-text-primary)',
              fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
              fontWeight: 900,
              fontSize: 24,
              letterSpacing: -0.5,
              marginTop: 6,
              marginBottom: 16,
              paddingRight: 40, // leave room for the trash button
            }}
          >
            {routineName || t('workoutHeroCard.workout', 'Workout')}
          </h3>

          {/* Stats grid */}
          <div
            className="grid grid-cols-3 gap-2"
            style={{
              borderTop: '1px solid color-mix(in srgb, #10B981 18%, transparent)',
              paddingTop: 14,
            }}
          >
            <CompletedStat value={durMin} unit={t('dashboard.min', 'min')} />
            {totalVol > 0
              ? <CompletedStat value={volLabel} unit="lbs" />
              : <CompletedStat value="–" unit="lbs" />}
            <CompletedStat value={displayExCount} unit={t('dashboard.exercises', 'exer')} />
          </div>
        </motion.button>

        {/* Trash icon — overlaid top-right, doesn't trigger card click */}
        {onDelete && completedSession?.id ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(completedSession);
            }}
            aria-label={t('dashboard.deleteSession', 'Delete session')}
            className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{
              background: 'color-mix(in srgb, var(--color-bg-card) 92%, transparent)',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.10))',
              color: 'var(--color-text-muted)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-[22px] overflow-hidden"
      style={{ boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}
    >
      {/* ── Hero Image Area ── */}
      <motion.button
        type="button"
        onClick={() => {
          if (isCompleted && completedSession?.id) {
            navigate('/session-summary', {
              state: {
                routineName: completedSession.name || routineName,
                elapsedTime: completedSession.duration_seconds,
                totalVolume: parseFloat(completedSession.total_volume_lbs) || 0,
                sessionId: completedSession.id,
                completedAt: completedSession.completed_at,
              },
            });
          } else {
            navigate(`/session/${routineId}`);
          }
        }}
        aria-label={displayName}
        className="relative w-full text-left group focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none block"
        style={{ height: 220 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {/* Background: gradient + decorative gym SVG + videos (green-tinted when completed) */}
        <div
          className="absolute inset-0"
          style={{
            background: isCompleted
              ? 'linear-gradient(180deg, rgba(16,185,129,0.18) 0%, var(--color-bg-card) 100%)'
              : 'linear-gradient(180deg, #3a3530 0%, #1a1817 100%)',
          }}
        >
          {/* Ambient light effect */}
          <div className="absolute inset-0" style={{
            backgroundImage: isCompleted
              ? 'radial-gradient(circle at 20% 40%, rgba(16,185,129,0.22), transparent 55%), radial-gradient(circle at 75% 65%, rgba(16,185,129,0.08), transparent 60%)'
              : 'radial-gradient(circle at 20% 40%, rgba(255,200,100,0.15), transparent 50%), radial-gradient(circle at 75% 65%, rgba(40,40,40,0.8), transparent 60%)'
          }} />
          {/* Decorative barbell rack SVG */}
          <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full" style={{ opacity: hasMedia ? 0 : 0.45 }}>
            <rect x="240" y="40" width="8" height="150" fill="#111"/>
            <rect x="320" y="40" width="8" height="150" fill="#111"/>
            <rect x="236" y="95" width="96" height="6" fill="#222"/>
            <circle cx="260" cy="120" r="28" fill="#0a0a0a"/>
            <circle cx="260" cy="120" r="20" fill="#2a2a2a"/>
            <circle cx="308" cy="120" r="28" fill="#0a0a0a"/>
            <circle cx="308" cy="120" r="20" fill="#2a2a2a"/>
          </svg>

          {/* Exercise videos — hidden in completed state */}
          {!isCompleted && exercises.map((ex, i) => ex.video && (
            <video
              key={ex.video}
              src={ex.video}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              onCanPlay={() => handleVideoReady(i)}
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
              style={{ opacity: i === currentIndex && readyVideos.has(i) ? 1 : 0 }}
            />
          ))}

          {/* Gradient overlay for text readability — only when not completed */}
          {!isCompleted && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
          )}
        </div>

        {/* ── Completed-state content ── */}
        {isCompleted ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
              style={{
                background: 'rgba(16,185,129,0.18)',
                border: '1px solid rgba(16,185,129,0.35)',
              }}
            >
              <CheckCircle2 size={30} strokeWidth={2.4} style={{ color: '#10B981' }} />
            </div>
            <div
              className="text-[10px] font-bold mb-1.5"
              style={{ color: '#10B981', letterSpacing: '0.14em' }}
            >
              {t('workoutHeroCard.workoutComplete', 'WORKOUT COMPLETE')}
            </div>
            <h3
              className="text-[22px] leading-tight"
              style={{
                color: 'var(--color-text-primary)',
                fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                fontWeight: 800,
                letterSpacing: -0.4,
              }}
            >
              {routineName || t('workoutHeroCard.workout', 'Workout')}
            </h3>
            {completedSession && (
              <p
                className="text-[12px] mt-1.5"
                style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round((completedSession.duration_seconds || 0) / 60)}{' '}
                {t('dashboard.min', 'min')}
                {(parseFloat(completedSession.total_volume_lbs) || 0) > 0 && (
                  <>
                    {' \u00B7 '}
                    {(() => {
                      const vol = parseFloat(completedSession.total_volume_lbs) || 0;
                      return vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : Math.round(vol);
                    })()}{' '}
                    lbs
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Content overlay (default) */}
            <div className="absolute left-[18px] bottom-[18px] right-[18px]" style={{ color: '#fff' }}>
              {/* Routine label */}
              <div className="text-[10px] font-bold mb-1.5" style={{ color: '#2EC4C4', letterSpacing: '0.12em' }}>
                {routineName ? routineName.toUpperCase() : t('dashboard.today').toUpperCase()} {'\u00B7'} {displayExCount} {t('dashboard.exercises').toUpperCase()}
              </div>
              {/* Exercise name */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                >
                  <h3 className="text-[26px] leading-none" style={{ color: '#fff', fontFamily: '"Familjen Grotesk", "Archivo", system-ui', fontWeight: 800, letterSpacing: -0.5 }}>
                    {exerciseName}
                  </h3>
                  {current.sets && current.reps && (
                    <p className="text-[13px] mt-1.5" style={{ color: 'rgba(255,255,255,0.72)' }}>
                      {current.sets} {t('workoutHeroCard.sets', 'sets')} × {current.reps} {t('workoutHeroCard.reps', 'reps')} · {t('workoutHeroCard.thenMore', { count: Math.max(0, displayExCount - (currentIndex + 1)) }, `then ${Math.max(0, displayExCount - (currentIndex + 1))} more lifts`)}
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Exercise counter dots */}
            {exercises.length > 1 && (
              <div className="absolute top-[14px] right-[14px] flex items-center gap-[5px]">
                {exercises.map((_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-300"
                    style={{
                      width: i === currentIndex ? 16 : 5,
                      height: 5,
                      background: i === currentIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Status badge — emerald in completed state, teal-accented in-progress otherwise */}
        {isCompleted ? (
          <div className="absolute top-4 left-[18px] flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{
                background: 'rgba(16,185,129,0.18)',
                border: '1px solid rgba(16,185,129,0.35)',
              }}
            >
              <CheckCircle2 size={12} strokeWidth={2.6} style={{ color: '#10B981' }} />
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#10B981' }}>
                {t('workoutHeroCard.completed', 'Completed')}
              </span>
            </div>
          </div>
        ) : isActive ? (
          <div className="absolute top-4 left-[18px] flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                {t('dashboard.inProgress')}
              </span>
            </div>
          </div>
        ) : null}
      </motion.button>

      {/* ── Stats Row ── */}
      <div
        className="flex items-center justify-around px-[18px] py-3.5"
        style={{
          background: 'var(--color-bg-card, #fff)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(15,20,25,0.07))',
        }}
      >
        <StatItem icon={<Dumbbell size={13} />} label={`${displayExCount} ${t('dashboard.exercises')}`} />
        <StatItem icon={<Clock size={13} />} label={`${estimatedMin} ${t('dashboard.min')}`} />
        <StatItem icon={<Flame size={13} />} label={`~${estimatedCal} ${t('dashboard.cal')}`} color="var(--color-hot, #FF5A2E)" />
      </div>

      {/* ── CTA Row ── */}
      {/* Note: the cardio-finisher attach affordance used to live here as a
          row inside the hero card. It now renders as its own standalone card
          in Dashboard.jsx, directly below the hero. The onAttachCardio /
          cardioAttached / cardioFinisher props are still accepted for
          backwards compatibility but no longer rendered here. */}
      <div
        className="flex gap-2.5 p-3.5"
        style={{ background: 'var(--color-bg-card, #fff)' }}
      >
        <button
          type="button"
          onClick={() => {
            if (isCompleted && completedSession?.id) {
              navigate('/session-summary', {
                state: {
                  routineName: completedSession.name || routineName,
                  elapsedTime: completedSession.duration_seconds,
                  totalVolume: parseFloat(completedSession.total_volume_lbs) || 0,
                  sessionId: completedSession.id,
                  completedAt: completedSession.completed_at,
                },
              });
            } else if (!isCompleted) {
              navigate(`/session/${routineId}`);
            }
          }}
          disabled={isCompleted && !completedSession?.id}
          className="flex-1 flex items-center justify-center gap-2 rounded-[16px] text-[14px] font-bold transition-all active:scale-[0.98]"
          style={{
            padding: '15px',
            background: isCompleted
              ? 'rgba(16,185,129,0.12)'
              : isActive
              ? '#10B981'
              : 'var(--color-accent, #2EC4C4)',
            color: isCompleted
              ? '#10B981'
              : '#fff',
            border: isCompleted ? '1px solid rgba(16,185,129,0.2)' : 'none',
            fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
            letterSpacing: -0.2,
            opacity: isCompleted && !completedSession?.id ? 0.6 : 1,
            cursor: isCompleted && !completedSession?.id ? 'default' : 'pointer',
          }}
        >
          {isCompleted ? (
            <CheckCircle2 size={18} strokeWidth={2.5} />
          ) : isActive ? (
            <Timer size={18} strokeWidth={2.5} />
          ) : (
            <Play size={16} fill="currentColor" strokeWidth={0} />
          )}
          {isCompleted
            ? (completedSession?.id
                ? t('workoutHeroCard.viewSummary', 'View Summary')
                : t('workoutHeroCard.workoutCompleted', 'Workout Completed'))
            : isActive
            ? t('workoutHeroCard.resumeWorkout')
            : t('workoutHeroCard.startWorkout')}
        </button>

        {/* Readiness indicator — always visible (including post-completion
            and mid-session) so the recovery map is one tap away regardless
            of the workout state. */}
        <button
          type="button"
          onClick={() => setReadinessOpen(true)}
          aria-label={t('workoutHeroCard.openReadiness', 'View recovery map')}
          className="flex flex-col items-center justify-center rounded-[16px] transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          style={{
            width: 56,
            background: 'var(--color-surface-hover, #F2F2EF)',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 0',
          }}
        >
          <span
            className="leading-none"
            style={{
              fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
              fontSize: 20,
              fontWeight: 800,
              color: 'var(--color-accent, #2EC4C4)',
              letterSpacing: -0.5,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {readinessScore}
          </span>
          <span className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
            {t('workoutHeroCard.ready', 'READY')}
          </span>
        </button>
      </div>
      <ReadinessModal open={readinessOpen} onClose={() => setReadinessOpen(false)} />
    </div>
  );
};

/* Small stat item used in the stats row */
const StatItem = ({ icon, label, color }) => (
  <div className="flex items-center gap-[5px]">
    <span style={{ color: color || 'var(--color-text-muted)' }}>{icon}</span>
    <span className="text-[12px] font-semibold" style={{ color: color || 'var(--color-text-muted)' }}>{label}</span>
  </div>
);

/* Compact stat used in the Strava-style completed-state card */
const CompactStat = ({ value, unit }) => (
  <div className="flex flex-col items-end leading-none" style={{ minWidth: 38 }}>
    <span
      style={{
        fontFamily: '"Archivo", "Familjen Grotesk", system-ui',
        fontWeight: 900,
        fontSize: 18,
        letterSpacing: -0.5,
        color: 'var(--color-text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </span>
    <span
      style={{
        fontSize: 9,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
        color: 'var(--color-text-muted)',
        marginTop: 2,
      }}
    >
      {unit}
    </span>
  </div>
);

/* Big stat tile used inside the completed-state hero card */
const CompletedStat = ({ value, unit }) => (
  <div className="flex flex-col items-center text-center" style={{ minWidth: 0 }}>
    <span
      style={{
        fontFamily: '"Archivo", "Familjen Grotesk", system-ui',
        fontWeight: 900,
        fontSize: 22,
        letterSpacing: -0.6,
        color: 'var(--color-text-primary)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.05,
      }}
    >
      {value}
    </span>
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        color: '#10B981',
        marginTop: 4,
      }}
    >
      {unit}
    </span>
  </div>
);

// memo: Dashboard re-renders frequently (timer ticks, modal toggles). Without
// this, every parent state change re-rendered the hero card's heavy subtree.
export default memo(WorkoutHeroCard);
