import React from 'react';
import GymLockup from './GymLockup';
import MuscleMap from './MuscleMap';
import { TuFont } from './ShareFormats';

function EditStat({ label, value, unit, big }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1.4, color: '#96A0AA', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
        <span style={{ fontFamily: TuFont.display, fontSize: 28 * big, fontWeight: 800, color: '#0A0D10', letterSpacing: -1, lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontSize: 10, color: '#5A6570', fontWeight: 600 }}>{unit}</span>
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
}) {
  const pad = Math.round(w * 0.06);
  const big = w > 320 ? 1 : 0.88;

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        background: '#FAFAF7',
        fontFamily: TuFont.body,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top strip */}
      <div style={{ padding: `${pad}px ${pad}px 0`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: accent, textTransform: 'uppercase' }}>
            Workout · {data.date}
          </div>
          <div
            style={{
              fontFamily: TuFont.display,
              fontSize: 22 * big,
              fontWeight: 800,
              color: '#0A0D10',
              letterSpacing: -0.8,
              lineHeight: 1.05,
              marginTop: 4,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: w - pad * 4,
            }}
          >
            {data.name}
          </div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#5A6570', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span>{data.user}</span>
        </div>
      </div>

      {/* Hero stats grid */}
      <div style={{ padding: `${pad * 0.6}px ${pad}px`, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: pad * 0.8 }}>
          <EditStat big={big} label="DURATION" value={data.duration} unit="min" />
          <EditStat
            big={big}
            label="VOLUME"
            value={showExactWeights ? data.volume : `${Math.round((data.volume || 0) / 100) * 100}+`}
            unit="lbs"
          />
          <EditStat big={big} label="SETS" value={data.sets} unit={`× ${data.reps} reps`} />
          <EditStat big={big} label="CALORIES" value={data.kcal} unit="kcal" />
        </div>

        {showPRs && data.prs?.length > 0 && (
          <div style={{ marginTop: pad * 0.8, padding: pad * 0.7, borderRadius: 14, background: '#0A0D10', color: '#fff' }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1.4, color: accent, textTransform: 'uppercase', marginBottom: 6 }}>
              🏆 New PRs
            </div>
            {data.prs.slice(0, 2).map((pr, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: i === 0 ? 0 : 4, gap: 8 }}>
                <span style={{ fontSize: 12 * big, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pr.lift}
                </span>
                <span style={{ fontFamily: TuFont.display, fontSize: 14 * big, fontWeight: 800, letterSpacing: -0.3, flexShrink: 0 }}>
                  {showExactWeights ? pr.weight : '—'}
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', fontWeight: 600, marginLeft: 2 }}>lbs</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {showMuscles && (
          <div style={{ marginTop: pad * 0.7, display: 'flex', alignItems: 'center', gap: pad * 0.6 }}>
            <MuscleMap muscles={data.muscles || {}} size={58} color={accent} dim="#D8D8D2" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1.4, color: '#96A0AA', textTransform: 'uppercase' }}>
                Muscles hit
              </div>
              <div
                style={{
                  fontFamily: TuFont.display,
                  fontSize: 13 * big,
                  fontWeight: 800,
                  color: '#0A0D10',
                  letterSpacing: -0.3,
                  marginTop: 2,
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
        }}
      >
        {showGym && data.gym ? (
          <GymLockup gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="dark" />
        ) : (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#96A0AA', letterSpacing: 0.8, textTransform: 'uppercase' }}>
            TuGymPR
          </div>
        )}
        <div
          style={{
            padding: '5px 9px',
            borderRadius: 999,
            background: accent,
            color: '#001512',
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
          }}
        >
          TuGymPR
        </div>
      </div>
    </div>
  );
}
