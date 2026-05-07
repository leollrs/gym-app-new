import React from 'react';
import GymLockup from './GymLockup';
import { TuFont } from './ShareFormats';

function BoldStat({ label, value, mid }) {
  return (
    <div
      style={{
        padding: '0 10px',
        borderLeft: mid ? '1px solid rgba(255,255,255,0.12)' : 'none',
        borderRight: mid ? '1px solid rgba(255,255,255,0.12)' : 'none',
      }}
    >
      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: TuFont.display, fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.6, marginTop: 2, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

/**
 * TEMPLATE B — Bold Sport (high-contrast dark, gym-tinted).
 * Ported from Share Workout.html reference.
 */
export default function ShareTplBoldSport({
  w, h, data,
  showGym = true,
  showExactWeights = true,
  // showMuscles unused in Bold template (kept for API parity)
  showMuscles = true, // eslint-disable-line no-unused-vars
  showPRs = true,
  accent = '#2EC4C4',
}) {
  const pad = Math.round(w * 0.055);
  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        background: '#0A0D10',
        fontFamily: TuFont.body,
      }}
    >
      {/* gym-color wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse 90% 60% at 20% 0%, ${accent}3d 0%, transparent 55%), radial-gradient(ellipse 80% 50% at 100% 100%, ${accent}24 0%, transparent 50%)`,
        }}
      />
      {/* big number background */}
      <div
        style={{
          position: 'absolute',
          right: -w * 0.05,
          top: h * 0.28,
          fontFamily: '"Archivo Black", "Archivo", sans-serif',
          fontSize: w * 0.72,
          fontWeight: 900,
          color: accent,
          opacity: 0.09,
          lineHeight: 0.85,
          letterSpacing: -6,
          pointerEvents: 'none',
        }}
      >
        {data.duration}
      </div>

      {/* content */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: `${pad * 1.2}px ${pad}px ${pad}px`,
        }}
      >
        {/* Top */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1.6,
                color: accent,
                textTransform: 'uppercase',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: 3, background: accent }} />
              Session complete
            </div>
            <div
              style={{
                fontFamily: TuFont.display,
                fontSize: 30,
                fontWeight: 800,
                color: '#fff',
                letterSpacing: -1.2,
                lineHeight: 0.95,
                marginTop: 8,
                maxWidth: w * 0.72,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {(data.name || '').toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600, marginTop: 6, letterSpacing: 0.4 }}>
              {data.date} · {data.user}
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Headline stat */}
        <div style={{ marginBottom: pad * 0.8 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
            Total volume
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
            <span
              style={{
                fontFamily: TuFont.display,
                fontSize: 64,
                fontWeight: 800,
                color: '#fff',
                letterSpacing: -3,
                lineHeight: 0.9,
              }}
            >
              {showExactWeights ? (data.volume || 0).toLocaleString() : `${Math.round((data.volume || 0) / 1000)}k+`}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>lbs</span>
          </div>
        </div>

        {/* Stat row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 1,
            padding: '10px 0',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            marginBottom: pad * 0.7,
          }}
        >
          <BoldStat label="TIME" value={`${data.duration}m`} />
          <BoldStat label="SETS" value={data.sets} mid />
          <BoldStat label="KCAL" value={data.kcal} />
        </div>

        {/* PR row */}
        {showPRs && data.prs?.[0] && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: pad * 0.7 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                background: accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
                color: '#001512',
                flexShrink: 0,
              }}
            >
              🏆
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: accent, textTransform: 'uppercase' }}>New PR</div>
              <div
                style={{
                  fontFamily: TuFont.display,
                  fontSize: 14,
                  fontWeight: 800,
                  color: '#fff',
                  letterSpacing: -0.3,
                  lineHeight: 1.1,
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {data.prs[0].lift}
                {showExactWeights ? ` · ${data.prs[0].weight} lbs` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: pad * 0.6,
            borderTop: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {showGym && data.gym ? (
            <GymLockup gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="light" />
          ) : (
            <div />
          )}
          <div style={{ fontFamily: TuFont.display, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>
            TuGym<span style={{ color: accent }}>PR</span>
          </div>
        </div>
      </div>
    </div>
  );
}
