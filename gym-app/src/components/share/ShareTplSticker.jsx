import React from 'react';
import GymLockup from './GymLockup';
import { TuFont } from './ShareFormats';

/**
 * TEMPLATE — Sticker (transparent background).
 *
 * Designed to be overlaid on the user's own IG Story photo: most of the
 * canvas is transparent, with a single compact frosted-glass card centered
 * on screen carrying the headline stats. Mirrors Strava's "Stats Sticker"
 * UX — the share image is the user's gym selfie + this card on top.
 *
 * Different from the four full-bleed templates because the layout is
 * size-agnostic (the canvas is mostly empty) and the card itself sizes
 * proportionally to `w` so it reads correctly at every export resolution
 * (1080×1920 / 1080×1080 / 1080×1350).
 */
export default function ShareTplSticker({
  w,
  h,
  data = {},
  showGym = true,
  showExactWeights = true,
  showPRs = true,
  accent = '#2EC4C4',
  // 'workout' | 'pr' | 'streak' | 'monthly' — drives the card's headline.
  kind = 'workout',
}) {
  // Typography scales off width so the same template renders correctly at
  // 270 (preview) and 1080 (export) without re-tuning per-format.
  const s = w / 270;
  const cardW = w * 0.78;
  const pad = 18 * s;
  const radius = 22 * s;
  // data.gym may be a string or an object ({name,location}). Normalize to a
  // name string for text + a gym object for the lockup (a raw object rendered
  // as a React child crashes the share sheet).
  const gymLabel = (typeof data?.gym === 'string' ? data.gym : data?.gym?.name) || 'TuGymPR';
  const gymObj = typeof data?.gym === 'string' ? { name: data.gym } : (data?.gym || null);

  // ── Headline content per share kind ──────────────────────────────────────
  let label = 'WORKOUT';
  let bigValue = data.volume ? `${data.volume.toLocaleString()}` : '0';
  let bigUnit = 'lbs';
  let subValue = data.name || 'Workout complete';
  let stats = [
    { label: 'TIME', value: data.duration || '0', unit: 'min' },
    { label: 'SETS', value: data.sets || '0', unit: '' },
    { label: 'KCAL', value: data.kcal || '0', unit: '' },
  ];

  if (kind === 'pr') {
    label = 'NEW PR';
    bigValue = data.prValue || '0';
    bigUnit = data.prUnit || 'lbs';
    subValue = data.prExercise || 'Personal record';
    stats = data.prPrevious
      ? [{ label: 'PREVIOUS', value: data.prPrevious, unit: data.prUnit || 'lbs' }]
      : [];
  } else if (kind === 'streak') {
    label = 'STREAK';
    bigValue = String(data.streakDays || 0);
    bigUnit = 'days';
    subValue = data.streakSubtitle || `Day ${data.streakDays || 0}`;
    stats = [];
  } else if (kind === 'monthly') {
    label = data.monthLabel || 'THIS MONTH';
    bigValue = String(data.workoutsCount || 0);
    bigUnit = 'workouts';
    subValue = data.monthlyHeadline || '';
    stats = [
      { label: 'VOLUME', value: data.volume ? `${Math.round(data.volume / 1000)}k` : '0', unit: 'lbs' },
      { label: 'PRs', value: data.prCount || 0, unit: '' },
      { label: 'STREAK', value: data.streakDays || 0, unit: 'd' },
    ];
  } else if (kind === 'body') {
    // Body progress is stats-only by design — actual progress photos go on
    // the user's own IG Story background; the sticker shows the delta.
    label = 'PROGRESS';
    const weeks = Number(data.weeksBetween) || 0;
    bigValue = String(weeks);
    bigUnit = weeks === 1 ? 'week' : 'weeks';
    subValue = 'Body composition update';
    stats = [];
    if (data.deltaLbs != null) {
      const v = Number(data.deltaLbs);
      stats.push({
        label: v < 0 ? 'LOST' : 'GAINED',
        value: Math.abs(v).toFixed(1),
        unit: 'lbs',
      });
    }
    if (data.deltaBodyFat != null) {
      const v = Number(data.deltaBodyFat);
      stats.push({
        label: 'BODY FAT',
        value: `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
        unit: '%',
      });
    }
  }

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        // Transparent so this overlays on the user's IG photo. Everything
        // visible lives inside the centered card below.
        background: 'transparent',
        fontFamily: TuFont.body,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: cardW,
          padding: `${pad * 1.1}px ${pad}px`,
          borderRadius: radius,
          // Frosted-glass: dark translucent fill + subtle border. Reads on
          // both light and dark backgrounds so users don't have to pick a
          // photo with specific tonality for the sticker to look good.
          background: 'rgba(10,13,16,0.78)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1.5px solid rgba(255,255,255,0.12)',
          boxShadow: `0 ${10 * s}px ${30 * s}px rgba(0,0,0,0.35)`,
          color: '#fff',
        }}
      >
        {/* Top: small label + gym lockup */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 * s }}>
          <div
            style={{
              minWidth: 0,
              flexShrink: 1,
              fontSize: 10 * s,
              fontWeight: 800,
              letterSpacing: 2 * s,
              color: accent,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </div>
          {showGym && gymObj && (
            <div style={{ flexShrink: 0, transform: `scale(${s * 0.9})`, transformOrigin: 'right center', opacity: 0.9 }}>
              <GymLockup
                gym={gymObj}
                logoUrl={data.gymLogoUrl}
                tone="light"
                size="sm"
                s={s}
              />
            </div>
          )}
        </div>

        {/* Big number */}
        <div
          style={{
            marginTop: 12 * s,
            display: 'flex',
            alignItems: 'baseline',
            gap: 6 * s,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontFamily: TuFont.display,
              fontSize: 64 * s,
              fontWeight: 900,
              letterSpacing: -2 * s,
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 0,
              flexShrink: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {bigValue}
          </span>
          {bigUnit && (
            <span
              style={{
                fontSize: 16 * s,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.6)',
                letterSpacing: -0.2,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {bigUnit}
            </span>
          )}
        </div>

        {/* Subtitle */}
        {subValue && (
          <div
            style={{
              marginTop: 4 * s,
              fontSize: 13 * s,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.8)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: cardW - pad * 2,
            }}
          >
            {subValue}
          </div>
        )}

        {/* Secondary stats row */}
        {stats.length > 0 && (
          <div
            style={{
              marginTop: 16 * s,
              paddingTop: 14 * s,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              // minmax(0,1fr) lets cells shrink so wide values truncate instead
              // of overflowing the sticker card.
              gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`,
              gap: 8 * s,
            }}
          >
            {stats.map((stat, i) => (
              <div key={i}>
                <div
                  style={{
                    fontSize: 8.5 * s,
                    fontWeight: 800,
                    letterSpacing: 1.4 * s,
                    color: 'rgba(255,255,255,0.5)',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {stat.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 * s, marginTop: 3 * s, maxWidth: '100%', overflow: 'hidden' }}>
                  <span
                    style={{
                      fontFamily: TuFont.display,
                      fontSize: 20 * s,
                      fontWeight: 800,
                      letterSpacing: -0.5 * s,
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 0,
                      flexShrink: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {stat.value}
                  </span>
                  {stat.unit && (
                    <span style={{ fontSize: 10 * s, fontWeight: 700, color: 'rgba(255,255,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {stat.unit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PRs callout — workout-kind only */}
        {kind === 'workout' && showPRs && data.prs?.length > 0 && (
          <div
            style={{
              marginTop: 14 * s,
              padding: `${10 * s}px ${12 * s}px`,
              borderRadius: 12 * s,
              background: `color-mix(in srgb, ${accent} 18%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
            }}
          >
            <div
              style={{
                fontSize: 8.5 * s,
                fontWeight: 800,
                letterSpacing: 1.4 * s,
                color: accent,
                textTransform: 'uppercase',
              }}
            >
              🏆 New PRs
            </div>
            {data.prs.slice(0, 2).map((pr, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginTop: i === 0 ? 4 * s : 2 * s,
                  gap: 8 * s,
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    flexShrink: 1,
                    fontSize: 11 * s,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {pr.name}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 11 * s,
                    fontWeight: 800,
                    color: accent,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {showExactWeights ? `${pr.value} ${pr.unit || 'lbs'}` : 'PR'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer brand */}
        <div
          style={{
            marginTop: 14 * s,
            fontSize: 9 * s,
            fontWeight: 700,
            letterSpacing: 1.5 * s,
            color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          {gymLabel}
        </div>
      </div>
    </div>
  );
}
