/**
 * TVStyleTelemetry — V4 Live Telemetry.
 *
 * Mission-control monospace: dense table with bars, CRT scanlines overlay,
 * 4 KPI tiles, event log stream in the footer. Uses primarily teal
 * (derived from gym accent) as the signal color, hot for #1 rank and
 * negative deltas, amber for streaks.
 *
 * This style is intentionally less brand-flexible — the ops-console look
 * relies on the cyan/orange/amber semantic split. We still derive the
 * "teal" and "hot" from the gym's brand colors so it tints toward the
 * gym, but a gym with very different brand colors will see less of their
 * identity here vs. the other 3 styles. That's by design — telemetry is
 * about utility and signal density, not about lobby decor.
 */

import { TVAvatar, TVLogoMark, TVSparkBars } from './TVPrimitives';
import { TV_METRIC_DEFS, alpha } from '../../lib/tv/palette';

export default function TVStyleTelemetry({ slide, palette, gymName, logoUrl, clock, timeFmt, dateFmt, slideIdx, totalSlides, metricKey }) {
  const entries = slide?.entries || [];
  const max = entries[0]?.score || 1;
  const sum = entries.reduce((a, r) => a + (Number(r.score) || 0), 0);
  const avg = entries.length > 0 ? Math.round(sum / entries.length) : 0;

  // Telemetry-specific palette derived from gym brand
  const t = {
    bg: '#06090C',
    panel: '#0B1014',
    panel2: '#0F151B',
    line: alpha(palette.teal, 0.18),
    line2: 'rgba(255,255,255,0.06)',
    teal: palette.teal,
    hot: palette.hot,
    amber: palette.amber,
    dim: 'rgba(255,255,255,0.45)',
    faint: 'rgba(255,255,255,0.25)',
  };

  const fmt = (score) => {
    if (score == null) return '—';
    if (metricKey === 'improved') return `+${score}%`;
    if (metricKey === 'consistency') return `${score}%`;
    return Number(score).toLocaleString();
  };

  // Stand-in spark data per row — derived from rank position
  // (real per-day activity would require an extra query; punted for v1).
  const sparkFor = (i) => Array.from({ length: 14 }, (_, k) => Math.max(1, 80 - i * 6 + ((k * 17) % 13) - 6));

  return (
    <div className="absolute inset-0 overflow-hidden select-none" style={{
      background: t.bg, color: '#FFFFFF',
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    }}>
      {/* CRT scanlines */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `repeating-linear-gradient(0deg, ${alpha(palette.teal, 0.04)} 0 1px, transparent 1px 3px)`,
        zIndex: 5,
      }} />
      {/* corner crops */}
      {[
        { top: '20px', left: '20px',  borderTopWidth: 1, borderLeftWidth: 1 },
        { top: '20px', right: '20px', borderTopWidth: 1, borderRightWidth: 1 },
        { bottom: '20px', left: '20px', borderBottomWidth: 1, borderLeftWidth: 1 },
        { bottom: '20px', right: '20px', borderBottomWidth: 1, borderRightWidth: 1 },
      ].map((style, i) => (
        <div key={i} className="absolute w-6 h-6" style={{ ...style, borderColor: t.line, borderStyle: 'solid' }} />
      ))}

      {/* ── Top bar ────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 h-16 px-10 flex items-center justify-between" style={{ background: t.panel, borderBottom: `1px solid ${t.line}` }}>
        <div className="flex items-center gap-5">
          <TVLogoMark src={logoUrl} size={28} color={t.teal} />
          <div className="text-[13px] font-bold tracking-widest" style={{ color: t.teal }}>{gymName?.toUpperCase()} // OPS</div>
          <div className="w-px h-5" style={{ background: t.line }} />
          <div className="text-[12px] tracking-wide" style={{ color: t.dim }}>NODE-01 · LIVE</div>
          <div className="w-px h-5" style={{ background: t.line }} />
          <div className="text-[12px] tracking-wide" style={{ color: t.dim }}>FEED ▸ <span style={{ color: '#fff' }}>retention/leaderboard</span></div>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-[12px] tracking-wide flex items-center gap-2" style={{ color: '#2FA66B' }}>
            <span className="inline-block w-2 h-2 rounded-full blink-dot" style={{ background: '#2FA66B' }} />
            STREAMING
          </span>
          <span className="text-[13px] font-bold tabular-nums" style={{ letterSpacing: '1.4px' }}>
            {clock.toISOString().slice(0, 10)} · {timeFmt.format(clock)}
          </span>
        </div>
      </div>

      {/* ── Category strip ─────────────────────────────── */}
      <div className="absolute left-0 right-0 h-11 flex items-center px-10" style={{ top: '64px', background: t.panel2, borderBottom: `1px solid ${t.line2}` }}>
        <span className="text-[11px] tracking-widest mr-4" style={{ color: t.dim }}>METRIC ▸</span>
        {TV_METRIC_DEFS.map((m, i) => {
          const isActive = m.key === metricKey;
          return (
            <span key={m.key} className="text-[12px] px-3 py-1 mr-1.5 font-bold tracking-wider uppercase"
              style={{
                border: `1px solid ${isActive ? t.teal : t.line2}`,
                color: isActive ? t.bg : t.dim,
                background: isActive ? t.teal : 'transparent',
              }}
            >
              [{String(i + 1).padStart(2, '0')}] {m.label}
            </span>
          );
        })}
        <span className="ml-auto text-[11px] tracking-wide" style={{ color: t.dim }}>
          WINDOW · {slide?.period} · MEMBERS={entries.length} · LIVE
        </span>
      </div>

      {/* ── Big title + KPIs ───────────────────────────── */}
      <div className="absolute left-10 right-10 grid grid-cols-[1.4fr_1fr] gap-5" style={{ top: '130px' }}>
        <div className="px-7 pt-5 pb-6 relative" style={{ border: `1px solid ${t.line}` }}>
          <div className="text-[11px] tracking-widest mb-1" style={{ color: t.dim }}>
            METRIC ▸ {metricKey?.toUpperCase()} / {slide?.period?.replace(' ', '_')} / RANKED_DESC
          </div>
          <div className="font-black uppercase leading-[0.88] text-[80px] lg:text-[100px] xl:text-[110px]" style={{ letterSpacing: '-4px' }}>
            {slide?.label?.toUpperCase() || ''}<span style={{ color: t.teal }}>_</span>
          </div>
          <div className="text-[12px] mt-2 tracking-wide" style={{ color: t.dim }}>
            DESC ▸ {leaderboardDescription(metricKey)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { l: 'GYM_TOTAL', v: fmt(sum), u: slide?.unit?.toLowerCase() },
            { l: 'AVG_MEMBER', v: fmt(avg), u: slide?.unit?.toLowerCase() },
            { l: 'ENTRIES', v: entries.length, u: `/ ${entries.length || 0}` },
            { l: 'LEADER', v: entries[0]?.name?.split(' ')[0]?.toUpperCase() || '—', u: 'top rank' },
          ].map((k) => (
            <div key={k.l} className="px-4 py-3" style={{ border: `1px solid ${t.line}`, background: t.panel }}>
              <div className="text-[10.5px] tracking-widest" style={{ color: t.dim }}>{k.l}</div>
              <div className="font-black tabular-nums leading-none mt-1 text-[28px] lg:text-[36px] truncate" style={{ letterSpacing: '-1.2px' }}>
                {k.v}
              </div>
              <div className="text-[11px] mt-1 tracking-wide" style={{ color: t.dim }}>{k.u}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main table ─────────────────────────────────── */}
      <div className="absolute left-10 right-10" style={{ top: '400px', bottom: '130px' }}>
        <div className="flex items-center justify-between py-2 px-4" style={{ background: t.panel, border: `1px solid ${t.line}`, borderBottom: 'none' }}>
          <span className="text-[12px] tracking-widest font-bold" style={{ color: t.teal }}>── rankings.tsv</span>
          <span className="text-[11px] tracking-wide" style={{ color: t.dim }}>cols=5 · sorted_by=score · order=DESC</span>
        </div>

        {/* header */}
        <div className="grid items-center py-2.5 px-4 text-[11px] tracking-widest font-bold" style={{
          gridTemplateColumns: '60px 1.4fr 1.2fr 0.8fr 1.2fr',
          color: t.dim,
          background: t.panel2,
          border: `1px solid ${t.line}`,
        }}>
          <span>RANK</span><span>LIFTER</span><span>14D · ACTIVITY</span><span>POS</span><span className="text-right">SCORE · {slide?.unit?.toUpperCase()}</span>
        </div>

        {entries.length === 0 ? (
          <div className="py-12 text-center" style={{ border: `1px solid ${t.line}`, borderTop: 'none' }}>
            <div className="text-[24px] font-black" style={{ color: t.teal }}>NO_DATA</div>
            <div className="text-[14px] mt-2" style={{ color: t.dim }}>tail -f gym.log · awaiting first entry</div>
          </div>
        ) : (
          entries.slice(0, 8).map((r, i) => {
            const rank = i + 1;
            const pct = (Number(r.score) / Number(max)) * 100;
            const rankColor = rank === 1 ? t.hot : rank === 2 ? t.amber : rank === 3 ? t.teal : t.dim;
            return (
              <div key={r.id || i} className="grid items-center py-3 px-4 tabular-nums" style={{
                gridTemplateColumns: '60px 1.4fr 1.2fr 0.8fr 1.2fr',
                borderLeft: `1px solid ${t.line}`,
                borderRight: `1px solid ${t.line}`,
                borderBottom: `1px solid ${t.line2}`,
                background: rank === 1 ? alpha(t.hot, 0.06) : i % 2 === 0 ? t.panel : 'transparent',
              }}>
                <span className="text-[26px] lg:text-[30px] font-black leading-none" style={{ color: rankColor, letterSpacing: '-0.5px' }}>
                  {String(rank).padStart(2, '0')}
                </span>
                <span className="flex items-center gap-2.5 min-w-0">
                  <TVAvatar name={r.name} size={36} />
                  <div className="min-w-0">
                    <div className="text-[16px] lg:text-[18px] font-extrabold truncate leading-none" style={{ fontFamily: 'Barlow, sans-serif', letterSpacing: '-0.2px' }}>{r.name}</div>
                    <div className="text-[11px] mt-1 tracking-wide" style={{ color: t.dim }}>id_{(r.id || '').toString().slice(0, 8)}</div>
                  </div>
                </span>
                <span>
                  <TVSparkBars data={sparkFor(i)} w={180} h={24} color={t.teal} restColor="rgba(255,255,255,0.08)" />
                </span>
                <span className="text-[15px] lg:text-[17px] font-semibold">#{rank}</span>
                <span className="text-right">
                  <div className="flex items-center justify-end gap-2.5">
                    <div className="w-24 h-1.5 relative" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: rank === 1 ? t.hot : rank <= 3 ? t.teal : '#5A6A7A' }} />
                    </div>
                    <span className="text-[26px] lg:text-[30px] font-black" style={{ minWidth: '120px', textAlign: 'right', letterSpacing: '-0.8px' }}>
                      {fmt(r.score)}
                    </span>
                  </div>
                </span>
              </div>
            );
          })
        )}

        <div className="py-2 px-4 text-[11px] flex justify-between tracking-wide" style={{ background: t.panel, border: `1px solid ${t.line}`, borderTop: 'none', color: t.dim }}>
          <span>── end · {entries.length} rows · total = {fmt(sum)} {slide?.unit?.toLowerCase()}</span>
          <span>auto-refresh ▸ on · interval=30s</span>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-[110px] grid grid-cols-[1fr_320px]" style={{ background: t.panel, borderTop: `1px solid ${t.line}` }}>
        <div className="px-5 py-2.5 overflow-hidden" style={{ borderRight: `1px solid ${t.line}` }}>
          <div className="text-[11px] tracking-widest mb-2" style={{ color: t.teal }}>SLIDE QUEUE</div>
          <div className="space-y-1">
            {TV_METRIC_DEFS.map((m, i) => {
              const isActive = m.key === metricKey;
              return (
                <div key={m.key} className="text-[12px] tracking-wide flex items-center gap-2" style={{ color: isActive ? '#FFF' : t.dim }}>
                  <span style={{ color: isActive ? t.teal : t.faint }}>{isActive ? '▶' : '·'}</span>
                  <span className="font-bold w-7">[{String(i + 1).padStart(2, '0')}]</span>
                  <span>{m.label}</span>
                  <span style={{ color: t.faint }}>· {m.period}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="px-5 py-3 flex flex-col justify-between">
          <div>
            <div className="text-[11px] tracking-widest mb-2" style={{ color: t.teal }}>NEXT</div>
            <div className="flex gap-1">
              {TV_METRIC_DEFS.map((m, i) => {
                const isActive = m.key === metricKey;
                return (
                  <div key={m.key} className="flex-1 h-1.5" style={{
                    background: isActive ? t.teal : t.line,
                    border: isActive ? `1px solid ${t.teal}` : 'none',
                  }} />
                );
              })}
            </div>
            <div className="text-[11px] mt-2 tracking-wide" style={{ color: t.dim }}>
              {String(slideIdx + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')} · 20s rotation
            </div>
          </div>
          <div className="text-[11px] tracking-wide flex justify-between" style={{ color: t.dim }}>
            <span>tugympr.com/tv</span>
            <span style={{ color: '#2FA66B' }}>OK · 200</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%, 60% { opacity: 1 } 70%, 100% { opacity: 0.25 } }
        .blink-dot { animation: blink 1.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

function leaderboardDescription(key) {
  switch (key) {
    case 'volume':      return 'Total weight (lbs) moved across logged sets, 30d window';
    case 'workouts':    return 'Count of completed workout sessions, 30d window';
    case 'prs':         return 'Estimated 1RM from logged personal records, all-time';
    case 'improved':    return 'Volume gain vs prior month, %';
    case 'consistency': return 'Distinct workout days ÷ days elapsed in month, %';
    case 'checkins':    return 'Door check-ins logged, 30d window';
    default: return '';
  }
}
