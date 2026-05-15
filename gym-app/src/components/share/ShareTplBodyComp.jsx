import React from 'react';
import { TuFont } from './ShareFormats';

// Body composition before/after share card.
//
// Different layout from ShareTplSticker (which is a single centered stat
// card) — body comp lives on the photos. Two photos side by side at the
// top, headline metric below ("LOST 12 LBS · 90 DAYS"), supporting deltas.
//
// Sensitive content: the entry point gates on the existing AI photo
// consent flow. This template doesn't try to handle "no photos" — the
// share button is only shown when both before + after photo URLs exist.
//
// Data shape:
//   { beforeUrl, afterUrl,
//     beforeLabel?, afterLabel?,
//     deltaLbs?,        // negative = loss, positive = gain
//     deltaPct?,
//     daysApart?,
//     beforeBfPct?, afterBfPct?,
//     user?, gym?, gymLogo? }

function Stat({ label, value, accent, s }) {
  return (
    <div>
      <div style={{
        fontSize: 8.5 * s, fontWeight: 800,
        letterSpacing: 1.4 * s,
        color: 'rgba(255,255,255,0.55)',
        textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontFamily: TuFont.display,
        fontSize: 22 * s, fontWeight: 900, color: accent,
        letterSpacing: -0.6 * s, lineHeight: 1, marginTop: 3 * s,
      }}>{value}</div>
    </div>
  );
}

export default function ShareTplBodyComp({
  w, h, data = {},
  accent = '#2EC4C4',
  transparent = false,
}) {
  const s = w / 270;
  const pad = 16 * s;

  const deltaLbs = data.deltaLbs;
  const isLoss = typeof deltaLbs === 'number' && deltaLbs < 0;
  const isGain = typeof deltaLbs === 'number' && deltaLbs > 0;
  const headline = isLoss
    ? `LOST ${Math.abs(deltaLbs).toFixed(1)} LB`
    : isGain
      ? `GAINED ${deltaLbs.toFixed(1)} LB`
      : 'PROGRESS';
  const dayLabel = data.daysApart ? `${data.daysApart} DAYS` : null;
  const headlineColor = isLoss ? '#10B981' : isGain ? accent : '#fff';

  return (
    <div style={{
      width: w, height: h, position: 'relative', overflow: 'hidden',
      background: transparent ? 'transparent' : '#05070B',
      fontFamily: TuFont.body,
      color: '#fff',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Photos row — paired before/after */}
      <div style={{
        position: 'relative', zIndex: 1,
        flex: 1,
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 4 * s,
        padding: pad,
      }}>
        {[
          { src: data.beforeUrl, label: data.beforeLabel || 'BEFORE' },
          { src: data.afterUrl,  label: data.afterLabel  || 'AFTER' },
        ].map((p, i) => (
          <div key={i} style={{
            position: 'relative',
            borderRadius: 12 * s,
            overflow: 'hidden',
            background: '#0A0D10',
          }}>
            {p.src && (
              <img
                src={p.src}
                alt={p.label}
                crossOrigin="anonymous"
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  display: 'block',
                }}
              />
            )}
            <div style={{
              position: 'absolute', top: 8 * s, left: 8 * s,
              padding: `${3 * s}px ${8 * s}px`,
              borderRadius: 999,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              fontSize: 8.5 * s, fontWeight: 800, letterSpacing: 1.4 * s,
              color: '#fff',
            }}>{p.label}</div>
          </div>
        ))}
      </div>

      {/* Stats strip */}
      <div style={{
        position: 'relative', zIndex: 1,
        padding: `${pad * 0.6}px ${pad}px ${pad}px`,
        background: transparent
          ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 30%)'
          : 'rgba(10,13,16,0.92)',
      }}>
        {/* Big headline */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: pad * 0.5,
        }}>
          <div style={{
            fontFamily: TuFont.display,
            fontSize: 26 * s, fontWeight: 900,
            color: headlineColor,
            letterSpacing: -1.2 * s, lineHeight: 1,
          }}>{headline}</div>
          {dayLabel && (
            <div style={{
              fontSize: 9 * s, fontWeight: 800, letterSpacing: 1.6 * s,
              color: 'rgba(255,255,255,0.6)',
            }}>{dayLabel}</div>
          )}
        </div>

        {/* Sub stats grid */}
        {(data.deltaPct != null || data.beforeBfPct != null || data.afterBfPct != null) && (
          <div style={{
            marginTop: 12 * s,
            paddingTop: 12 * s,
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: pad * 0.5,
          }}>
            {data.deltaPct != null && (
              <Stat
                label={isLoss ? 'BODY' : 'WEIGHT'}
                value={`${data.deltaPct > 0 ? '+' : ''}${data.deltaPct.toFixed(1)}%`}
                accent={headlineColor}
                s={s}
              />
            )}
            {data.beforeBfPct != null && (
              <Stat label="BF %" value={`${data.beforeBfPct.toFixed(0)}→${data.afterBfPct?.toFixed(0) ?? '?'}`} accent={accent} s={s} />
            )}
            <Stat label="GYM" value={data.gym || 'TuGymPR'} accent="#fff" s={s} />
          </div>
        )}
      </div>
    </div>
  );
}
