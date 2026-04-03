import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Minus, Plus, ChevronDown,
  Footprints, Bike, Waves, CircleDot, TrendingUp,
  Zap, Droplets, PersonStanding, Flame,
  Swords, CircleDashed, Music, Mountain, Snowflake, Heart,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { estimateCardioCalories } from '../lib/cardioCalories';
import useFocusTrap from '../hooks/useFocusTrap';

// Intensity multipliers applied on top of the base MET estimate
const INTENSITY_MULT = { easy: 0.75, moderate: 1.0, hard: 1.25, max: 1.5 };

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
const INTENSITY_COLORS = {
  easy:     '#22C55E',
  moderate: '#F59E0B',
  hard:     '#EF4444',
  max:      '#DC2626',
};

export default function CardioLogModal({ isOpen, onClose, onLogged }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const focusRef = useFocusTrap(isOpen);

  const [cardioType, setCardioType] = useState('running');
  const [duration, setDuration] = useState(30);
  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [intensity, setIntensity] = useState('moderate');
  const [submitting, setSubmitting] = useState(false);
  const [showMoreTypes, setShowMoreTypes] = useState(false);

  // Body weight for calorie estimation (from profile or default 165lbs)
  const bodyWeightLbs = profile?.weight_lbs
    ?? (profile?.weight_kg ? profile.weight_kg * 2.20462 : 165);

  // Distance in km for calorie calc
  const distanceKm = distance ? (distanceUnit === 'mi' ? parseFloat(distance) * 1.60934 : parseFloat(distance)) : null;

  // Use distance-based calculation when distance is provided (more accurate)
  const baseCal = estimateCardioCalories(cardioType, duration * 60, bodyWeightLbs, distanceKm);
  const estimatedCalories = distanceKm ? baseCal : Math.round(baseCal * (INTENSITY_MULT[intensity] ?? 1));

  const showDistance = DISTANCE_TYPES.has(cardioType);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCardioType('running');
      setDuration(30);
      setDistance('');
      setDistanceUnit('km');
      setIntensity('moderate');
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (submitting || !user) return;
    setSubmitting(true);

    try {
      const distanceKm = distance
        ? (distanceUnit === 'mi' ? parseFloat(distance) * 1.60934 : parseFloat(distance))
        : null;

      const { error } = await supabase.rpc('log_cardio_session', {
        p_cardio_type: cardioType,
        p_duration_seconds: duration * 60,
        p_distance_km: distanceKm,
        p_calories_burned: estimatedCalories,
        p_intensity: intensity,
        p_source: 'manual',
      });

      if (error) throw error;

      showToast(t('cardio.loggedSuccess'), 'success');
      onLogged?.();
      onClose();
    } catch (err) {
      console.error('Failed to log cardio:', err);
      showToast(t('cardio.logError'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, user, cardioType, duration, distance, distanceUnit, intensity, estimatedCalories, showToast, t, onLogged, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={focusRef}
        className="relative w-full max-w-[480px] mx-4 mb-4 sm:mb-0 rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--color-bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {t('cardio.title')}
            </h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('cardio.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Activity picker ────────────────────────────── */}
        <div className="px-5 pb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('cardio.activity')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[...CARDIO_MAIN, ...(showMoreTypes ? CARDIO_MORE : [])].map(ct => {
              const Icon = ct.icon;
              const selected = cardioType === ct.key;
              return (
                <button
                  key={ct.key}
                  type="button"
                  onClick={() => setCardioType(ct.key)}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all duration-150 ${
                    selected
                      ? 'border-opacity-50'
                      : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.06]'
                  }`}
                  style={selected ? {
                    backgroundColor: `${ct.color}15`,
                    borderColor: `${ct.color}50`,
                  } : undefined}
                >
                  <Icon size={20} style={{ color: selected ? ct.color : 'var(--color-text-subtle)' }} />
                  <span
                    className="text-[11px] font-semibold leading-tight text-center"
                    style={{ color: selected ? ct.color : 'var(--color-text-subtle)' }}
                  >
                    {t(`cardio.types.${ct.key}`, ct.key.replace(/_/g, ' '))}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowMoreTypes(s => !s)}
            className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 text-[11px] font-medium"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <ChevronDown size={12} className={`transition-transform ${showMoreTypes ? 'rotate-180' : ''}`} />
            {showMoreTypes ? t('cardio.showLess', 'Show less') : t('cardio.showMore', 'More activities')}
          </button>
        </div>

        {/* ── Duration ───────────────────────────────────── */}
        <div className="px-5 pb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('cardio.duration')}
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDuration(d => Math.max(5, d - 5))}
              className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors active:scale-95"
              style={{ color: 'var(--color-text-primary)' }}
              aria-label="Decrease duration"
            >
              <Minus size={16} />
            </button>
            <div className="flex-1 text-center">
              <input
                type="number"
                min="5"
                max="300"
                value={duration}
                onChange={e => setDuration(Math.max(5, Math.min(300, parseInt(e.target.value) || 5)))}
                className="w-20 text-center text-[28px] font-black border-none outline-none bg-transparent"
                style={{ color: 'var(--color-text-primary)' }}
              />
              <p className="text-[11px] -mt-1" style={{ color: 'var(--color-text-muted)' }}>{t('cardio.minutes')}</p>
            </div>
            <button
              type="button"
              onClick={() => setDuration(d => Math.min(300, d + 5))}
              className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors active:scale-95"
              style={{ color: 'var(--color-text-primary)' }}
              aria-label="Increase duration"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Estimated calories */}
          <p className="text-center mt-2 text-[13px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            ~{estimatedCalories} {t('cardio.cal')}
          </p>
        </div>

        {/* ── Distance (conditional) ─────────────────────── */}
        {showDistance && (
          <div className="px-5 pb-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('cardio.distance')} <span className="font-normal lowercase">({t('cardio.optional')})</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="0.0"
                value={distance}
                onChange={e => setDistance(e.target.value)}
                className="flex-1 border border-white/[0.06] rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37]"
                style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
              />
              <div className="flex rounded-xl border border-white/[0.06] overflow-hidden">
                {['km', 'mi'].map(unit => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setDistanceUnit(unit)}
                    className={`px-3 py-2.5 text-[12px] font-bold transition-all ${
                      distanceUnit === unit
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                        : 'bg-white/[0.04] hover:bg-white/[0.06]'
                    }`}
                    style={distanceUnit !== unit ? { color: 'var(--color-text-subtle)' } : undefined}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Intensity ──────────────────────────────────── */}
        <div className="px-5 pb-5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('cardio.intensity')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {INTENSITIES.map(level => {
              const selected = intensity === level;
              const color = INTENSITY_COLORS[level];
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setIntensity(level)}
                  className={`py-2.5 rounded-xl border text-[12px] font-bold transition-all duration-150 ${
                    selected
                      ? 'border-opacity-50'
                      : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.06]'
                  }`}
                  style={selected ? {
                    backgroundColor: `${color}15`,
                    borderColor: `${color}50`,
                    color: color,
                  } : { color: 'var(--color-text-subtle)' }}
                >
                  {t(`cardio.intensities.${level}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Log button ─────────────────────────────────── */}
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3.5 rounded-2xl text-[15px] font-bold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-accent, #D4AF37)',
              color: '#000',
            }}
          >
            {submitting ? t('cardio.logging') : t('cardio.logButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
