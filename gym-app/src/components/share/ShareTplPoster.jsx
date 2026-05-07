import React from 'react';
import GymLockup from './GymLockup';

function PosterStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: '"Archivo", sans-serif', fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: -0.5, lineHeight: 1, marginTop: 1 }}>
        {value}
      </div>
    </div>
  );
}

/**
 * TEMPLATE C — Poster (layered, magazine). Orange accent fixed (#FF5A2E).
 * Ported from Share Workout.html reference.
 */
export default function ShareTplPoster({
  w, h, data,
  showGym = true,
  showExactWeights = true,
  showMuscles = true, // eslint-disable-line no-unused-vars
  showPRs = true,
  accent = '#FF5A2E',
}) {
  const pad = Math.round(w * 0.055);
  const nameWords = (data.name || '').split(' ').slice(0, 2);

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        background: '#EEEBE3',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      }}
    >
      {/* paper texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.35,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(10,13,16,0.04) 0, rgba(10,13,16,0.04) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* accent splash */}
      <div
        style={{
          position: 'absolute',
          top: h * 0.32,
          left: -w * 0.15,
          width: w * 1.3,
          height: w * 0.7,
          borderRadius: '50%',
          background: accent,
          transform: 'rotate(-8deg)',
        }}
      />

      {/* Top label */}
      <div
        style={{
          position: 'absolute',
          top: pad,
          left: pad,
          right: pad,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 3,
        }}
      >
        <div
          style={{
            fontFamily: '"Archivo", sans-serif',
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: 2.2,
            color: '#0A0D10',
            textTransform: 'uppercase',
            borderBottom: '1.5px solid #0A0D10',
            paddingBottom: 4,
          }}
        >
          Vol. 01 — Log No. {data.sessionNo || '—'}
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#0A0D10', letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {data.date}
        </div>
      </div>

      {/* Giant headline */}
      <div
        style={{
          position: 'absolute',
          top: pad * 2.4,
          left: pad,
          right: pad,
          zIndex: 3,
          fontFamily: '"Archivo Black", "Archivo", sans-serif',
          fontSize: w * 0.22,
          fontWeight: 900,
          color: '#0A0D10',
          letterSpacing: -2,
          lineHeight: 0.82,
          textTransform: 'uppercase',
        }}
      >
        {nameWords.length > 0
          ? nameWords.map((word, i) => (
              <div
                key={i}
                style={{
                  color: i === 1 ? '#FAFAF7' : '#0A0D10',
                  WebkitTextStroke: i === 1 ? '1.5px #0A0D10' : 'none',
                  textShadow: i === 1 ? '3px 3px 0 #0A0D10' : 'none',
                }}
              >
                {word}
              </div>
            ))
          : <div>WORKOUT</div>}
      </div>

      {/* Stat card */}
      <div
        style={{
          position: 'absolute',
          bottom: pad * 3.8,
          right: pad,
          zIndex: 4,
          background: '#0A0D10',
          color: '#fff',
          padding: `${pad * 0.8}px ${pad * 0.9}px`,
          transform: 'rotate(-2deg)',
          boxShadow: '4px 4px 0 rgba(255,255,255,0.8)',
          maxWidth: w * 0.62,
        }}
      >
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1.6, color: accent, textTransform: 'uppercase' }}>
          The Numbers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
          <PosterStat label="Time" value={`${data.duration}'`} />
          <PosterStat label="Sets" value={data.sets} />
          <PosterStat
            label="Vol"
            value={
              showExactWeights
                ? `${Math.round(((data.volume || 0) / 1000) * 10) / 10}k`
                : `${Math.round((data.volume || 0) / 1000)}k+`
            }
          />
          <PosterStat label="Kcal" value={data.kcal} />
        </div>
        {showPRs && data.prs?.[0] && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid rgba(255,255,255,0.15)',
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ color: accent }}>🏆 PR · </span>
            {data.prs[0].lift}
            {showExactWeights && data.prs[0].weight ? ` — ${data.prs[0].weight} lbs` : ''}
          </div>
        )}
      </div>

      {/* Footer stripe */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 5,
          background: '#0A0D10',
          color: '#fff',
          padding: `${pad * 0.55}px ${pad}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {showGym && data.gym ? (
          <GymLockup gym={data.gym} logoUrl={data.gymLogoUrl} size="sm" tone="light" />
        ) : (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>@{data.userHandle || data.user}</div>
        )}
        <div style={{ fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: -0.3 }}>
          TuGymPR
        </div>
      </div>
    </div>
  );
}
