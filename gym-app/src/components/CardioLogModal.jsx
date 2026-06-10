// CardioLogModal.jsx
// Warm-paper redesigned manual cardio log sheet. Matches onboarding / ExerciseLibrary aesthetic.
// - createPortal, body scroll lock, no Framer Motion
// - Archivo 900 title, Familjen Grotesk body
// - 18px rounded tiles with colored icon chips
// - Preserves existing log_cardio_session RPC payload

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  X, Minus, Plus, ChevronDown, Activity,
  Footprints, Bike, Waves, CircleDot, TrendingUp,
  Zap, Droplets, PersonStanding, Flame,
  Swords, CircleDashed, Music, Mountain, Snowflake, Heart,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { estimateCardioCalories } from '../lib/cardioCalories';
import posthogClient from 'posthog-js';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

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
const GPS_TYPES = new Set(['running', 'cycling', 'walking', 'hiking']);
const INTENSITIES = ['easy', 'moderate', 'hard', 'max'];
const INTENSITY_COLORS = { easy: '#22C55E', moderate: '#F59E0B', hard: '#EF4444', max: '#DC2626' };

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: 'var(--color-text-muted)',
        marginBottom: 8,
        fontFamily: FONT_BODY,
      }}
    >
      {children}
    </div>
  );
}

export default function CardioLogModal({ isOpen, onClose, onLogged }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [cardioType, setCardioType] = useState('running');
  const [duration, setDuration] = useState(30);
  const [distance, setDistance] = useState('');
  // Default to imperial when metric_units is undefined — keep this in lockstep
  // with LiveCardio + CardioSessionDetail + ActiveSession.
  const [distanceUnit, setDistanceUnit] = useState(profile?.metric_units === true ? 'km' : 'mi');
  const [intensity, setIntensity] = useState('moderate');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showMoreTypes, setShowMoreTypes] = useState(false);

  const bodyWeightLbs = profile?.weight_lbs ?? (profile?.weight_kg ? profile.weight_kg * 2.20462 : 165);

  const durationSec = (duration || 0) * 60;
  const distanceKm = distance
    ? (distanceUnit === 'mi' ? parseFloat(distance) * 1.60934 : parseFloat(distance))
    : null;
  const baseCal = estimateCardioCalories(cardioType, durationSec, bodyWeightLbs, distanceKm);
  const estimatedCalories = distanceKm ? baseCal : Math.round(baseCal * (INTENSITY_MULT[intensity] ?? 1));

  const showDistance = DISTANCE_TYPES.has(cardioType);
  const canTrackLive = GPS_TYPES.has(cardioType);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setCardioType('running');
      setDuration(30);
      setDistance('');
      setIntensity('moderate');
      setNotes('');
      setSubmitting(false);
      setShowMoreTypes(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (submitting || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('log_cardio_session', {
        p_payload: {
          cardio_type: cardioType,
          duration_seconds: durationSec,
          distance_km: distanceKm,
          calories_burned: estimatedCalories,
          intensity,
          source: 'manual',
          notes: notes?.trim() || null,
        },
      });
      if (error) throw error;
      posthogClient?.capture('cardio_logged', { source: 'manual' });
      showToast(t('cardio.loggedSuccess', 'Cardio logged!'), 'success');
      onLogged?.();
      onClose();
    } catch (err) {
      console.error('Failed to log cardio:', err);
      showToast(t('cardio.logError', 'Failed to log. Try again.'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, user, cardioType, durationSec, distanceKm, intensity, estimatedCalories, notes, showToast, t, onLogged, onClose]);

  const goLive = () => {
    onClose();
    setTimeout(() => navigate('/cardio-live', { state: { cardioType } }), 120);
  };

  if (!isOpen) return null;

  const accent = 'var(--color-accent, #2EC4C4)';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('cardio.title', 'Log Cardio')}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(10,13,16,0.55)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-bg-card, #FAFAF7)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: '0 -12px 44px rgba(15,20,25,0.18)',
          overflow: 'hidden',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Grip */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
          <div style={{ width: 44, height: 4, borderRadius: 2, background: 'var(--color-border-subtle, rgba(15,20,25,0.12))' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 20px 10px' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', color: accent, fontFamily: FONT_BODY }}>
              {t('cardio.logPast', 'Log Cardio')}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 28, letterSpacing: -0.8, color: 'var(--color-text-primary)', marginTop: 2 }}>
              {t('cardio.title', 'Log Cardio')}
            </div>
          </div>
          <button
            type="button" onClick={onClose} aria-label={t('cardioLog.close', { defaultValue: 'Close' })}
            style={{
              width: 40, height: 40, borderRadius: 14, border: 'none',
              background: 'var(--color-surface-hover, rgba(15,20,25,0.06))',
              color: 'var(--color-text-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 20px' }}>
          {/* Activity grid */}
          <SectionLabel>{t('cardio.activity', 'Activity')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[...CARDIO_MAIN, ...(showMoreTypes ? CARDIO_MORE : [])].map(ct => {
              const Icon = ct.icon;
              const sel = cardioType === ct.key;
              return (
                <button
                  key={ct.key}
                  type="button"
                  onClick={() => setCardioType(ct.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '14px 8px',
                    borderRadius: 18,
                    border: `1px solid ${sel ? `${ct.color}66` : 'var(--color-border-subtle, rgba(15,20,25,0.08))'}`,
                    background: sel ? `color-mix(in srgb, ${ct.color} 10%, var(--color-bg-card))` : 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    cursor: 'pointer',
                    minHeight: 72,
                    fontFamily: FONT_BODY,
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 12,
                      background: sel ? `${ct.color}22` : 'var(--color-bg-card)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon size={18} style={{ color: sel ? ct.color : 'var(--color-text-muted)' }} />
                  </div>
                  <span
                    style={{
                      fontSize: 11, fontWeight: 800, textAlign: 'center',
                      color: sel ? ct.color : 'var(--color-text-primary)',
                    }}
                  >
                    {t(`cardio.types.${ct.key}`, ct.key.replace(/_/g, ' '))}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button" onClick={() => setShowMoreTypes(s => !s)}
            style={{
              width: '100%', marginTop: 6, padding: '8px 0',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              fontFamily: FONT_BODY,
            }}
          >
            <ChevronDown size={12} style={{ transform: showMoreTypes ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
            {showMoreTypes ? t('cardio.showLess', 'Show less') : t('cardio.showMore', 'More activities')}
          </button>

          {/* Live tracking CTA for GPS activities */}
          {canTrackLive && (
            <button
              type="button"
              onClick={goLive}
              style={{
                width: '100%', marginTop: 12, padding: '12px 14px',
                borderRadius: 16,
                border: `1.5px solid ${accent}`,
                background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 10%, var(--color-bg-card))',
                color: accent,
                fontFamily: FONT_BODY, fontWeight: 800, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer',
              }}
            >
              <Activity size={16} />
              {t('cardio.trackLiveWithGps', 'Track live with GPS')}
            </button>
          )}

          {/* Duration stepper */}
          <div style={{ marginTop: 18 }}>
            <SectionLabel>{t('cardio.duration', 'Duration')}</SectionLabel>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 10,
                borderRadius: 18,
                background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
              }}
            >
              <button
                type="button"
                onClick={() => setDuration(d => Math.max(1, (d || 1) - 5))}
                aria-label={t('cardioLog.decrease', { defaultValue: 'Decrease' })}
                style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: 'var(--color-bg-card)', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-text-primary)',
                }}
              >
                <Minus size={16} />
              </button>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 36,
                    color: 'var(--color-text-primary)', letterSpacing: -1,
                    lineHeight: 1,
                  }}
                >
                  {duration || 0}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {t('cardio.minutes', 'minutes')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDuration(d => Math.min(300, (d || 0) + 5))}
                aria-label={t('cardioLog.increase', { defaultValue: 'Increase' })}
                style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: 'var(--color-bg-card)', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--color-text-primary)',
                }}
              >
                <Plus size={16} />
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)' }}>
              ~{estimatedCalories} {t('cardio.cal', 'cal')}
            </div>
          </div>

          {/* Distance */}
          {showDistance && (
            <div style={{ marginTop: 18 }}>
              <SectionLabel>
                {t('cardio.distance', 'Distance')}{' '}
                <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                  ({t('cardio.optional', 'optional')})
                </span>
              </SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number" min="0" step="0.1" placeholder="0.0"
                  value={distance}
                  onChange={e => setDistance(e.target.value)}
                  style={{
                    flex: 1, padding: '12px 14px',
                    borderRadius: 16,
                    border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                    background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    color: 'var(--color-text-primary)',
                    fontSize: 16, fontFamily: FONT_BODY,
                    outline: 'none',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    borderRadius: 16,
                    overflow: 'hidden',
                    background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                    border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                  }}
                >
                  {['km', 'mi'].map(u => (
                    <button
                      key={u} type="button"
                      onClick={() => setDistanceUnit(u)}
                      style={{
                        padding: '0 16px', minWidth: 52,
                        border: 'none', cursor: 'pointer',
                        background: distanceUnit === u ? accent : 'transparent',
                        color: distanceUnit === u ? 'var(--color-bg-card)' : 'var(--color-text-muted)',
                        fontWeight: 800, fontSize: 12,
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Intensity */}
          <div style={{ marginTop: 18 }}>
            <SectionLabel>{t('cardio.intensity', 'Intensity')}</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {INTENSITIES.map(lvl => {
                const sel = intensity === lvl;
                const c = INTENSITY_COLORS[lvl];
                return (
                  <button
                    key={lvl} type="button"
                    onClick={() => setIntensity(lvl)}
                    style={{
                      padding: '12px 4px',
                      borderRadius: 16,
                      border: `1px solid ${sel ? `${c}66` : 'var(--color-border-subtle, rgba(15,20,25,0.08))'}`,
                      background: sel
                        ? `color-mix(in srgb, ${c} 12%, var(--color-bg-card))`
                        : 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                      color: sel ? c : 'var(--color-text-primary)',
                      cursor: 'pointer',
                      fontFamily: FONT_BODY, fontWeight: 800, fontSize: 12,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                    }}
                  >
                    {t(`cardio.intensities.${lvl}`, lvl)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginTop: 18 }}>
            <SectionLabel>{t('cardio.notes', 'Notes')} <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>({t('cardio.optional', 'optional')})</span></SectionLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t('cardio.notesPlaceholder', 'How did it feel?')}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 16,
                border: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
                background: 'var(--color-surface-hover, rgba(15,20,25,0.04))',
                color: 'var(--color-text-primary)',
                fontSize: 14, fontFamily: FONT_BODY,
                outline: 'none', resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Footer CTA */}
        <div
          style={{
            borderTop: '1px solid var(--color-border-subtle, rgba(15,20,25,0.08))',
            padding: '12px 20px 18px',
            background: 'var(--color-bg-card, #FAFAF7)',
          }}
        >
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: '100%', height: 52, borderRadius: 16,
              border: 'none', cursor: submitting ? 'default' : 'pointer',
              background: accent,
              color: 'var(--color-bg-card, #0A0D10)',
              fontFamily: FONT_BODY, fontWeight: 800, fontSize: 14,
              letterSpacing: 0.1,
              opacity: submitting ? 0.6 : 1,
              boxShadow: '0 6px 18px color-mix(in srgb, var(--color-accent, #2EC4C4) 30%, transparent)',
            }}
          >
            {submitting ? t('cardio.logging', 'Logging...') : t('cardio.logButton', 'Log cardio')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
