import React from 'react';
import GymLockup from './GymLockup';
import MuscleMap from './MuscleMap';
import { TuFont } from './ShareFormats';

// `s` is the canvas-to-preview scale (w / 270). Multiplying every literal
// pixel by `s` keeps typography proportional whether we render at 270×480
// (in-app preview) or 1080×1920 (IG Story export). Without this the same
// 28 px hero stat looked chunky in the preview but lost on the full Story
// canvas — the entire reason the export felt small and spaced out.
function EditStat({ label, value, unit, s }) {
  return (
    <div style={{ minWidth: 0, overflow: 'hidden' }}>
      <div
        style={{
          fontSize: 8.5 * s,
          fontWeight: 800,
          letterSpacing: 1.4 * s,
          color: '#96A0AA',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 * s, marginTop: 3 * s, maxWidth: '100%', overflow: 'hidden' }}>
        <span
          style={{
            fontFamily: TuFont.display,
            fontSize: 28 * s,
            fontWeight: 800,
            color: '#0A0D10',
            letterSpacing: -1 * s,
            lineHeight: 1,
            minWidth: 0,
            flexShrink: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </span>
        <span style={{ fontSize: 10 * s, color: '#5A6570', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>{unit}</span>
      </div>
    </div>
  );
}

/**
 * TEMPLATE A — Editorial (Strava-like, clean light surface).
 * Ported from Share Workout.html reference.
 */
export default function ShareTplEditorial({
  w, h, data,
  showGym = true,
  showExactWeights = true,
  showMuscles = true,
  showPRs = true,
  accent = '#2EC4C4',
  transparent = false,
}) {
  const pad = Math.round(w * 0.06);
  // Single scale factor — see EditStat. 270 is the in-app preview width;
  // every literal pixel value multiplied by `s` stays proportional across
  // all export sizes (1080×1920 Story, 1080×1080 square, 1080×1350 portrait).
  const s = w / 270;
  // data.gym is an object ({name, location}) on the workout path, but may be a
  // plain string from other callers. Render only the NAME as text — never the
  // raw object, which crashes React ("Objects are not valid as a React child").
  const gymLabel = (typeof data?.gym === 'string' ? data.gym : data?.gym?.name) || 'TuGymPR';

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        // Drop the surface fill when in sticker mode so the rasterized PNG
        // carries alpha — lets the user layer the card over their own IG
        // Story photo. The inner highlight cards keep their fills.
        background: transparent ? 'transparent' : '#FAFAF7',
        fontFamily: TuFont.body,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top strip */}
      <div style={{ padding: `${pad}px ${pad}px 0`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 * s }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div
            style={{
              fontSize: 9 * s,
              fontWeight: 800,
              letterSpacing: 1.4 * s,
              color: accent,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: w - pad * 4,
            }}
          >
            Workout · {data.date}
          </div>
          <div
            style={{
              fontFamily: TuFont.display,
              fontSize: 22 * s,
              fontWeight: 800,
              color: '#0A0D10',
              letterSpacing: -0.8 * s,
              lineHeight: 1.05,
              marginTop: 4 * s,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: w - pad * 4,
            }}
          >
            {data.name}
          </div>
        </div>
        <div style={{ fontSize: 10 * s, fontWeight: 700, color: '#5A6570', display: 'flex', alignItems: 'center', gap: 4 * s, flexShrink: 0, maxWidth: w * 0.38, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.user}</span>
        </div>
      </div>

      {/* Hero stats grid */}
      <div style={{ padding: `${pad * 0.6}px ${pad}px`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: pad * 0.8 }}>
          <EditStat s={s} label="DURATION" value={data.duration} unit="min" />
          <EditStat
            s={s}
            label="VOLUME"
            value={showExactWeights ? data.volume : `${Math.round((data.volume || 0) / 100) * 100}+`}
            unit="lbs"
          />
          <EditStat s={s} label="SETS" value={data.sets} unit={`× ${data.reps} reps`} />
          <EditStat s={s} label="CALORIES" value={data.kcal} unit="kcal" />
        </div>

        {showPRs && data.prs?.length > 0 && (
          <div style={{ marginTop: pad * 0.8, padding: pad * 0.7, borderRadius: 14 * s, background: '#0A0D10', color: '#fff' }}>
            <div style={{ fontSize: 8.5 * s, fontWeight: 800, letterSpacing: 1.4 * s, color: accent, textTransform: 'uppercase', marginBottom: 6 * s }}>
              🏆 New PRs
            </div>
            {data.prs.slice(0, 2).map((pr, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: i === 0 ? 0 : 4 * s, gap: 8 * s }}>
                <span style={{ fontSize: 12 * s, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pr.lift}
                </span>
                <span style={{ fontFamily: TuFont.display, fontSize: 14 * s, fontWeight: 800, letterSpacing: -0.3 * s, flexShrink: 0 }}>
                  {showExactWeights ? pr.weight : '—'}
                  <span style={{ fontSize: 9 * s, color: 'rgba(255,255,255,0.6)', fontWeight: 600, marginLeft: 2 * s }}>lbs</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {showMuscles && (
          <div style={{ marginTop: pad * 0.7, display: 'flex', alignItems: 'center', gap: pad * 0.6 }}>
            <MuscleMap muscles={data.muscles || {}} size={58 * s} color={accent} dim="#D8D8D2" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5 * s, fontWeight: 800, letterSpacing: 1.4 * s, color: '#96A0AA', textTransform: 'uppercase' }}>
                Muscles hit
              </div>
              <div
                style={{
                  fontFamily: TuFont.display,
                  fontSize: 13 * s,
                  fontWeight: 800,
                  color: '#0A0D10',
                  letterSpacing: -0.3 * s,
                  marginTop: 2 * s,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {data.muscleSummary}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: `${pad * 0.7}px ${pad}px`,
          borderTop: '1px solid rgba(10,13,16,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10 * s,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
          {showGym && data.gym ? (
            <GymLockup s={s} gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="dark" />
          ) : (
            <div
              style={{
                fontSize: 10 * s,
                fontWeight: 700,
                color: '#96A0AA',
                letterSpacing: 0.8 * s,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {gymLabel}
            </div>
          )}
        </div>
        <div
          style={{
            flexShrink: 0,
            maxWidth: w * 0.45,
            padding: `${5 * s}px ${9 * s}px`,
            borderRadius: 999,
            background: accent,
            color: '#001512',
            fontSize: 8.5 * s,
            fontWeight: 800,
            letterSpacing: 0.8 * s,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {gymLabel}
        </div>
      </div>
    </div>
  );
}
