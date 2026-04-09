import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, ChevronDown,
  Footprints, Bike, Waves, CircleDot, TrendingUp,
  Zap, Droplets, PersonStanding, Flame,
  Swords, CircleDashed, Music, Mountain, Snowflake, Heart,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { estimateCardioCalories } from '../lib/cardioCalories';

const CARDIO_MAIN = [
  { key: 'running',       icon: Footprints,     color: '#10B981' },
  { key: 'cycling',       icon: Bike,           color: '#3B82F6' },
  { key: 'rowing',        icon: Waves,          color: '#06B6D4' },
  { key: 'elliptical',    icon: CircleDot,      color: '#8B5CF6' },
  { key: 'stair_climber', icon: TrendingUp,     color: '#F59E0B' },
  { key: 'jump_rope',     icon: Zap,            color: '#EF4444' },
  { key: 'swimming',      icon: Droplets,       color: '#0EA5E9' },
  { key: 'walking',       icon: PersonStanding, color: '#22C55E' },
  { key: 'hiit',          icon: Flame,          color: '#F97316' },
];

const CARDIO_MORE = [
  { key: 'basketball',    icon: CircleDashed,   color: '#F97316' },
  { key: 'soccer',        icon: CircleDashed,   color: '#22C55E' },
  { key: 'tennis',        icon: CircleDashed,   color: '#FBBF24' },
  { key: 'boxing',        icon: Swords,         color: '#EF4444' },
  { key: 'dance',         icon: Music,          color: '#EC4899' },
  { key: 'yoga',          icon: Heart,          color: '#8B5CF6' },
  { key: 'pilates',       icon: Heart,          color: '#06B6D4' },
  { key: 'martial_arts',  icon: Swords,         color: '#DC2626' },
  { key: 'skiing',        icon: Snowflake,      color: '#60A5FA' },
  { key: 'hiking',        icon: Mountain,       color: '#10B981' },
  { key: 'other',         icon: Flame,          color: '#6B7280' },
];

const DISTANCE_TYPES = new Set(['running', 'cycling', 'rowing', 'swimming', 'walking', 'hiking']);
const INTENSITIES = ['easy', 'moderate', 'hard', 'max'];
const INTENSITY_COLORS = { easy: '#22C55E', moderate: '#F59E0B', hard: '#EF4444', max: '#DC2626' };
const STORAGE_KEY = 'tugympr_live_cardio';

export default function LiveCardio() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Restore state from localStorage on mount
  const [state] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.startedAt) return saved;
    } catch {}
    return null;
  });

  const [phase, setPhase] = useState(state ? (state.phase || 'tracking') : 'pick'); // pick → tracking → done
  const [cardioType, setCardioType] = useState(state?.cardioType || 'running');
  const [showMore, setShowMore] = useState(false);

  // Timer
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const accumRef = useRef(state ? (state.accumulatedSec || 0) : 0);
  const rafRef = useRef(null);

  // Post-finish inputs
  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [intensity, setIntensity] = useState('moderate');
  const [submitting, setSubmitting] = useState(false);

  const bodyWeightLbs = profile?.weight_lbs ?? 165;
  const sessionEndedRef = useRef(false);

  // Auto-resume if we have saved state
  useEffect(() => {
    if (state?.running && state?.startedAt) {
      // Calculate elapsed since last save
      const savedAccum = state.accumulatedSec || 0;
      const timeSinceSave = (Date.now() - new Date(state.startedAt).getTime()) / 1000;
      accumRef.current = savedAccum + timeSinceSave;
      startRef.current = Date.now();
      setRunning(true);
      setPhase('tracking');
    } else if (state?.accumulatedSec > 0) {
      accumRef.current = state.accumulatedSec;
      setElapsed(Math.floor(state.accumulatedSec));
      setPhase('tracking');
    }
  }, []);

  // Drift-free timer
  useEffect(() => {
    if (!running) { cancelAnimationFrame(rafRef.current); return; }
    if (!startRef.current) startRef.current = Date.now();
    const tick = () => {
      const e = accumRef.current + (Date.now() - startRef.current) / 1000;
      setElapsed(Math.floor(e));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  // Persist to localStorage every 5 seconds while running
  useEffect(() => {
    if (phase !== 'tracking') return;
    const save = () => {
      const totalAccum = running && startRef.current
        ? accumRef.current + (Date.now() - startRef.current) / 1000
        : accumRef.current;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cardioType,
        accumulatedSec: totalAccum,
        startedAt: running ? new Date().toISOString() : null,
        running,
        phase,
      }));
    };
    save();
    const interval = setInterval(save, 3000);
    return () => clearInterval(interval);
  }, [phase, running, cardioType]);

  // Save state on unmount so it survives navigation
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Skip save if session was intentionally finished or discarded
      if (sessionEndedRef.current) return;
      // Persist current state on unmount
      if (phase === 'tracking' || (phase === 'done' && accumRef.current > 0)) {
        const totalAccum = running && startRef.current
          ? accumRef.current + (Date.now() - startRef.current) / 1000
          : accumRef.current;
        if (totalAccum > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            cardioType,
            accumulatedSec: totalAccum,
            startedAt: running ? new Date().toISOString() : null,
            running,
            phase,
          }));
        }
      }
    };
  }, [phase, running, cardioType]);

  const handleStart = () => {
    setPhase('tracking');
    startRef.current = Date.now();
    accumRef.current = 0;
    setRunning(true);
  };

  const handlePauseResume = () => {
    if (running) {
      accumRef.current += (Date.now() - startRef.current) / 1000;
      startRef.current = null;
      setRunning(false);
    } else {
      startRef.current = Date.now();
      setRunning(true);
    }
  };

  const handleFinish = () => {
    if (running) {
      accumRef.current += (Date.now() - startRef.current) / 1000;
      startRef.current = null;
      setRunning(false);
    }
    setElapsed(Math.floor(accumRef.current));
    setPhase('done');
  };

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const durationSec = Math.floor(accumRef.current);
      const distKm = distance ? (distanceUnit === 'mi' ? parseFloat(distance) * 1.60934 : parseFloat(distance)) : null;
      const cal = estimateCardioCalories(cardioType, durationSec, bodyWeightLbs, distKm);

      const { error } = await supabase.rpc('log_cardio_session', {
        p_payload: {
          cardio_type: cardioType,
          duration_seconds: durationSec,
          distance_km: distKm,
          calories_burned: cal,
          intensity,
          source: 'manual',
        },
      });
      if (error) throw error;

      sessionEndedRef.current = true;
      localStorage.removeItem(STORAGE_KEY);
      showToast(t('cardio.loggedSuccess', 'Cardio logged!'), 'success');
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Failed to log cardio:', err);
      showToast(t('cardio.logError', 'Failed to log. Try again.'), 'error');
      setSubmitting(false);
    }
  }, [submitting, cardioType, distance, distanceUnit, intensity, bodyWeightLbs, showToast, t, navigate]);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const handleBack = () => {
    if (phase === 'tracking' || (phase === 'done' && accumRef.current > 0)) {
      // Active session — save state explicitly, then navigate
      const totalAccum = running && startRef.current
        ? accumRef.current + (Date.now() - startRef.current) / 1000
        : accumRef.current;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        cardioType,
        accumulatedSec: totalAccum,
        startedAt: running ? new Date().toISOString() : null,
        running,
        phase,
      }));
      sessionEndedRef.current = true; // prevent unmount from overwriting
      navigate('/', { replace: true });
    } else {
      // Pick phase — nothing to save
      sessionEndedRef.current = true;
      localStorage.removeItem(STORAGE_KEY);
      navigate('/', { replace: true });
    }
  };

  const handleDiscard = () => {
    sessionEndedRef.current = true;
    localStorage.removeItem(STORAGE_KEY);
    navigate('/', { replace: true });
  };

  // Format time
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const currentType = [...CARDIO_MAIN, ...CARDIO_MORE].find(c => c.key === cardioType);
  const showDist = DISTANCE_TYPES.has(cardioType);
  const cal = estimateCardioCalories(cardioType, elapsed, bodyWeightLbs, distance ? (distanceUnit === 'mi' ? parseFloat(distance) * 1.60934 : parseFloat(distance)) : null);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'var(--color-bg-primary)', paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12">
        <button onClick={handleBack} aria-label={t('cardio.goBack', 'Go back')} className="w-11 h-11 rounded-xl flex items-center justify-center focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
          <ChevronLeft size={22} />
        </button>
        <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {phase === 'pick' ? t('cardio.trackLive', 'Track Live') : currentType ? t(`cardio.types.${currentType.key}`, currentType.key) : ''}
        </p>
        <div className="w-11" />
      </div>

      {/* ── Phase: Pick activity ── */}
      {phase === 'pick' && (
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
          <p className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-muted)' }}>
            {t('cardio.activity', 'Activity')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[...CARDIO_MAIN, ...(showMore ? CARDIO_MORE : [])].map(ct => {
              const Icon = ct.icon;
              const sel = cardioType === ct.key;
              return (
                <button key={ct.key} type="button" onClick={() => setCardioType(ct.key)}
                  aria-label={t(`cardio.types.${ct.key}`, ct.key.replace(/_/g, ' '))}
                  aria-pressed={sel}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all min-h-[44px] focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none ${sel ? '' : 'bg-white/[0.04] border-white/[0.06]'}`}
                  style={sel ? { backgroundColor: `${ct.color}15`, borderColor: `${ct.color}50` } : undefined}
                >
                  <Icon size={20} style={{ color: sel ? ct.color : 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-semibold text-center" style={{ color: sel ? ct.color : 'var(--color-text-subtle)' }}>
                    {t(`cardio.types.${ct.key}`, ct.key.replace(/_/g, ' '))}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setShowMore(s => !s)} aria-expanded={showMore} className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
            <ChevronDown size={12} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
            {showMore ? t('cardio.showLess', 'Show less') : t('cardio.showMore', 'More activities')}
          </button>
        </div>
      )}

      {/* ── Phase: Tracking ── */}
      {phase === 'tracking' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {/* Timer */}
          <p className="text-[64px] font-black tabular-nums tracking-tight" style={{ color: running ? '#10B981' : 'var(--color-text-primary)' }}>
            {timeStr}
          </p>
          <p className="text-[13px] mt-1 mb-8" style={{ color: 'var(--color-text-muted)' }}>
            {running ? t('cardio.tracking', 'Tracking...') : elapsed > 0 ? t('cardio.paused', 'Paused') : ''}
          </p>

          {/* Live calories */}
          {elapsed > 10 && (
            <p className="text-[16px] font-bold mb-8" style={{ color: 'var(--color-text-subtle)' }}>
              ~{cal} {t('cardio.cal', 'cal')}
            </p>
          )}

          {/* Controls */}
          <div className="flex gap-4">
            <button onClick={handlePauseResume}
              className="px-10 py-4 rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none"
              style={running ? { backgroundColor: 'rgba(239,68,68,0.15)', color: '#EF4444' } : { backgroundColor: '#10B981', color: '#fff' }}
            >
              {running ? t('cardio.pause', 'Pause') : t('cardio.resume', 'Resume')}
            </button>
            {!running && elapsed > 0 && (
              <button onClick={handleFinish}
                className="px-8 py-4 rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none"
                style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
              >
                {t('cardio.finish', 'Finish')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Phase: Done — input distance/intensity and log ── */}
      {phase === 'done' && (
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8">
          {/* Summary */}
          <div className="text-center mb-6">
            <p className="text-[36px] font-black tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{timeStr}</p>
            <p className="text-[14px] font-semibold mt-1" style={{ color: '#10B981' }}>~{cal} {t('cardio.cal', 'cal')}</p>
          </div>

          {/* Distance */}
          {showDist && (
            <div className="mb-5">
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
                {t('cardio.distance', 'Distance')}
              </label>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="decimal" min="0" step="0.1" placeholder="0.0" value={distance}
                  onChange={e => setDistance(e.target.value)}
                  aria-label={t('cardio.distanceInput', 'Distance')}
                  className="flex-1 border border-white/[0.06] rounded-xl px-3 py-2.5 outline-none min-h-[44px]"
                  style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)', fontSize: '16px' }}
                />
                <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
                  {['km', 'mi'].map(u => (
                    <button key={u} type="button" onClick={() => setDistanceUnit(u)}
                      aria-label={t(`cardio.unit_${u}`, `Distance unit: ${u}`)}
                      aria-pressed={distanceUnit === u}
                      className="px-3 py-2.5 text-[12px] font-semibold transition-colors min-w-[44px] min-h-[44px]"
                      style={distanceUnit === u ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-text-muted)' }}
                    >{u}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Intensity */}
          <div className="mb-6">
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('cardio.intensity', 'Intensity')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {INTENSITIES.map(i => (
                <button key={i} type="button" onClick={() => setIntensity(i)}
                  aria-pressed={intensity === i}
                  className="py-2.5 min-h-[44px] rounded-xl text-[11px] font-bold uppercase transition-all border"
                  style={intensity === i
                    ? { backgroundColor: `${INTENSITY_COLORS[i]}20`, borderColor: `${INTENSITY_COLORS[i]}50`, color: INTENSITY_COLORS[i] }
                    : { backgroundColor: 'transparent', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--color-text-subtle)' }
                  }
                >{t(`cardio.intensities.${i}`, i)}</button>
              ))}
            </div>
          </div>

          {/* Log button */}
          <button onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-transform disabled:opacity-50 focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none"
            style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
          >
            {submitting ? t('cardio.logging', 'Logging...') : t('cardio.finishAndLog', 'Finish & Log')}
          </button>
        </div>
      )}

      {/* Bottom: Start button (pick phase only) */}
      {phase === 'pick' && (
        <div className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
          <button onClick={handleStart}
            className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37]/50 focus:outline-none"
            style={{ backgroundColor: '#10B981', color: '#FFFFFF' }}
          >
            {t('cardio.start', 'Start')}
          </button>
        </div>
      )}
    </div>
  );
}
