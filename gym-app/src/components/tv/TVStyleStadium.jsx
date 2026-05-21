/**
 * TVStyleStadium — V1 Dark Stadium.
 *
 * ESPN / CrossFit Games big board energy: deep dark background with radial
 * brand flares, a podium hero card for the #1 lifter, two stacked cards
 * for #2 and #3, and a 5-up grid for ranks 4–8.
 *
 * All brand colors flow from `palette` (derived in lib/tv/palette.js). The
 * hard-coded original ESPN-style oranges/teals are now `palette.hot` and
 * `palette.teal`, so every gym gets their own brand-tinted version.
 *
 * The original mock had richer per-row fields (handle, streak, delta, etc.)
 * that don't yet exist in our real RPC output. We render what we have
 * (name, score) and degrade gracefully — empty space where streak would be
 * is just trimmed. Add those fields to tv_get_dashboard_data later if you
 * want the richer look.
 */

import { TVAvatar, TVLogoMark, TVSparkBars } from './TVPrimitives';
import { alpha, mix } from '../../lib/tv/palette';
import { TV_METRIC_DEFS } from '../../lib/tv/palette';

export default function TVStyleStadium({ slide, palette, gymName, logoUrl, clock, timeFmt, dateFmt, slideIdx, totalSlides, metricKey }) {
  const entries = slide?.entries || [];
  const [first, ...rest] = entries;
  const topPodium = entries.slice(0, 3);
  const restRows = entries.slice(3, 8);
  const maxVal = first?.score || 1;
  const isMetric = slide?.kind === 'metric';
  const total = entries.reduce((s, e) => s + (Number(e.score) || 0), 0);

  // Format scores per metric type (volume → 34.7K, consistency → 87%, etc.)
  const fmt = (score, useK = true) => {
    if (score == null) return '—';
    if (metricKey === 'improved') return `+${score}%`;
    if (metricKey === 'consistency') return `${score}%`;
    if (metricKey === 'volume' && useK) {
      if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(2)}M`;
      if (score >= 1000) return `${(score / 1000).toFixed(1)}K`;
    }
    return Number(score).toLocaleString();
  };

  return (
    <div
      className="absolute inset-0 select-none overflow-hidden"
      style={{
        background: `
          radial-gradient(1200px 700px at 18% -10%, ${palette.hotGlow}, transparent 60%),
          radial-gradient(900px 600px at 100% 110%, ${palette.tealGlow}, transparent 55%),
          linear-gradient(180deg, ${palette.ink} 0%, #06090C 100%)
        `,
        color: palette.text,
        fontFamily: 'Barlow, system-ui, sans-serif',
      }}
    >
      {/* faint vertical grid */}
      <svg className="absolute inset-0 pointer-events-none" style={{ opacity: 0.08 }} preserveAspectRatio="none" width="100%" height="100%">
        {Array.from({ length: 22 }).map((_, i) => (
          <line key={i} x1={`${(i / 22) * 100}%`} y1="0" x2={`${(i / 22) * 100}%`} y2="100%" stroke="#fff" strokeWidth="0.5" />
        ))}
      </svg>

      {/* ── Header ─────────────────────────────────────── */}
      <header className="absolute top-0 left-0 right-0 flex items-center justify-between px-10 lg:px-14 py-4 lg:py-5" style={{ borderBottom: `1px solid ${palette.textGhost}` }}>
        <div className="flex items-center gap-4">
          <TVLogoMark src={logoUrl} size={48} color={palette.text} />
          <div>
            <div className="text-[11px] lg:text-[12px] font-bold tracking-[0.3em] uppercase flex items-center gap-2" style={{ color: palette.hot }}>
              <span className="inline-block w-2 h-2 rounded-full blink-dot" style={{ background: palette.hot }} />
              Live Leaderboard
            </div>
            <div className="text-[22px] lg:text-[26px] font-black leading-tight" style={{ letterSpacing: '-0.6px' }}>
              {gymName}
            </div>
          </div>
        </div>

        <div className="hidden xl:flex items-center gap-3 overflow-hidden flex-1 justify-center px-6">
          {TV_METRIC_DEFS.map((m) => {
            const isActive = m.key === metricKey;
            return (
              <span key={m.key} className="text-[11px] font-bold tracking-widest uppercase flex items-center gap-1.5" style={{ color: isActive ? palette.text : palette.textFaint, opacity: isActive ? 1 : 0.4 }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: isActive ? palette.hot : palette.textGhost }} />
                {m.label}
              </span>
            );
          })}
        </div>

        <div className="text-right">
          <p className="text-[30px] lg:text-[36px] font-black leading-none tabular-nums">{timeFmt.format(clock)}</p>
          <p className="text-[11px] tracking-widest uppercase mt-1" style={{ color: palette.hot }}>{dateFmt.format(clock)}</p>
        </div>
      </header>

      {/* ── Category title strip ───────────────────────── */}
      <div className="absolute left-0 right-0 px-10 lg:px-14" style={{ top: '90px' }}>
        <div className="flex items-end justify-between mt-6 lg:mt-8">
          <div>
            <div className="text-[12px] lg:text-[13px] font-extrabold tracking-[0.4em] uppercase" style={{ color: palette.hot }}>
              Category {String((TV_METRIC_DEFS.findIndex(m => m.key === metricKey) + 1) || 1).padStart(2, '0')} / 06 · {slide?.period || '30 DAYS'}
            </div>
            <div className="font-black uppercase text-[88px] lg:text-[120px] xl:text-[140px] leading-none mt-1" style={{ letterSpacing: '-5px' }}>
              {slide?.label || ''}
            </div>
          </div>
          <div className="text-right pb-3">
            <div className="text-[12px] lg:text-[13px] font-bold tracking-widest uppercase" style={{ color: palette.textDim }}>
              Gym total · top {entries.length || 0}
            </div>
            <div className="text-[40px] lg:text-[56px] xl:text-[64px] font-black leading-none tabular-nums mt-1" style={{ letterSpacing: '-2px' }}>
              {fmt(total)} <span className="text-[16px] lg:text-[22px]" style={{ color: palette.teal }}>{slide?.unit || ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body: hero + #2/#3 + ranks 4-8 ─────────────── */}
      {entries.length === 0 ? (
        <div className="absolute inset-x-0 flex flex-col items-center justify-center text-center" style={{ top: '50%', transform: 'translateY(-50%)' }}>
          <p className="text-[36px] font-bold" style={{ color: palette.textDim }}>No activity yet</p>
          <p className="text-[18px] mt-2" style={{ color: palette.textFaint }}>The first member on the board wins this slide</p>
        </div>
      ) : (
        <>
          {/* hero card + #2 / #3 stack */}
          <div className="absolute left-10 right-10 lg:left-14 lg:right-14 grid grid-cols-[1.35fr_1fr] gap-6" style={{ top: '380px', bottom: restRows.length > 0 ? '195px' : '60px' }}>
            {/* #1 hero */}
            {first && (
              <HeroCard entry={first} palette={palette} fmt={fmt} unit={slide?.unit} />
            )}
            {/* #2 / #3 stacked */}
            <div className="grid grid-rows-2 gap-3 min-h-0">
              {[topPodium[1], topPodium[2]].map((r, i) => r ? (
                <PodiumCard key={r.id || i} entry={r} rank={i + 2} palette={palette} fmt={fmt} unit={slide?.unit} />
              ) : <div key={i} />)}
            </div>
          </div>

          {/* ranks 4-8 */}
          {restRows.length > 0 && (
            <div className="absolute left-10 right-10 lg:left-14 lg:right-14 bottom-12 pt-4" style={{ borderTop: `1px solid ${palette.textGhost}` }}>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[11px] lg:text-[13px] font-black tracking-[0.3em] uppercase" style={{ color: palette.textDim }}>
                  Ranks 04 – {String(3 + restRows.length).padStart(2, '0')}
                </div>
                <div className="text-[11px] font-mono" style={{ color: palette.textFaint }}>
                  scale: 0 → {fmt(maxVal)} {slide?.unit?.toLowerCase() || ''}
                </div>
              </div>
              <div className="grid grid-cols-5 gap-3">
                {restRows.map((r, i) => {
                  const pct = (Number(r.score) / Number(maxVal)) * 100;
                  return (
                    <div key={r.id || i} className="relative px-3 py-2 rounded-lg" style={{ background: palette.textGhost, border: `1px solid ${palette.textGhost}` }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold" style={{ color: palette.textFaint }}>0{i + 4}</span>
                        <span className="text-[20px] lg:text-[24px] font-black tabular-nums" style={{ letterSpacing: '-0.6px' }}>{fmt(r.score)}</span>
                      </div>
                      <div className="text-[15px] lg:text-[17px] font-extrabold mb-2 truncate" style={{ letterSpacing: '-0.2px' }}>
                        {r.name}
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: palette.textGhost }}>
                        <div className="h-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${palette.teal}, ${palette.hot})` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-10 lg:px-14 text-[11px] font-mono" style={{ background: 'rgba(0,0,0,0.5)', color: palette.textFaint, letterSpacing: '1.4px' }}>
        <span>
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 blink-dot" style={{ background: palette.good }} />
          LIVE · rotates every 20s · {String(slideIdx + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')}
        </span>
        <span style={{ color: palette.textFaint }}>updated live</span>
      </footer>

      <style>{`
        @keyframes blink { 0%, 60% { opacity: 1 } 70%, 100% { opacity: 0.25 } }
        .blink-dot { animation: blink 1.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ── Hero card for #1 ────────────────────────────────────────────────────
function HeroCard({ entry, palette, fmt, unit }) {
  return (
    <div
      className="relative rounded-3xl overflow-hidden p-7 lg:p-10"
      style={{
        background: `linear-gradient(135deg, ${mix(palette.ink, palette.hot, 0.15)} 0%, ${mix(palette.ink, palette.hot, 0.05)} 100%)`,
        border: `1px solid ${alpha(palette.hot, 0.25)}`,
      }}
    >
      {/* Radial flare */}
      <div className="absolute -top-44 -right-32 w-[520px] h-[520px] rounded-full" style={{ background: `radial-gradient(circle, ${palette.hotGlow}, transparent 65%)` }} />
      {/* Big "1" watermark */}
      <div className="absolute -right-7 -bottom-28 font-black select-none pointer-events-none" style={{ fontSize: '580px', lineHeight: 0.8, color: alpha(palette.hot, 0.08), letterSpacing: '-30px' }}>1</div>

      <div className="relative flex items-center gap-3 mb-5">
        <span
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] lg:text-[12px] font-black uppercase tracking-widest"
          style={{ background: palette.hot, color: palette.onHot }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full blink-dot" style={{ background: palette.onHot }} />
          Top performer
        </span>
      </div>

      <div className="relative flex items-center gap-5 mb-6">
        <TVAvatar name={entry.name} size={104} ring ringColor={palette.hot} />
        <div className="min-w-0">
          <div className="text-[56px] lg:text-[72px] xl:text-[78px] font-black leading-none truncate" style={{ letterSpacing: '-2.5px' }}>
            {entry.name}
          </div>
        </div>
      </div>

      <div className="relative flex items-end gap-9 justify-between">
        <div>
          <div className="font-black tabular-nums text-[100px] lg:text-[130px] xl:text-[156px] leading-none" style={{ letterSpacing: '-5px' }}>
            {fmt(entry.score)}
          </div>
          <div className="text-[13px] lg:text-[16px] font-extrabold uppercase tracking-widest mt-1" style={{ color: palette.textDim }}>
            {unit}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact card for #2 / #3 ────────────────────────────────────────────
function PodiumCard({ entry, rank, palette, fmt, unit }) {
  const accent = rank === 2 ? palette.coach : palette.teal;
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 lg:p-7 flex items-center justify-between gap-5 min-h-0"
      style={{
        background: `linear-gradient(135deg, ${palette.ink2} 0%, ${palette.ink} 100%)`,
        border: `1px solid ${palette.textGhost}`,
      }}
    >
      <div className="absolute -right-5 -bottom-16 font-black select-none pointer-events-none" style={{ fontSize: '250px', lineHeight: 0.8, color: alpha(palette.text, 0.04), letterSpacing: '-10px' }}>{rank}</div>
      <div className="relative flex items-center gap-4 min-w-0 flex-1">
        <div className="text-[48px] lg:text-[64px] font-black leading-none tabular-nums" style={{ color: accent, letterSpacing: '-2px', minWidth: '50px' }}>
          {rank}
        </div>
        <TVAvatar name={entry.name} size={64} />
        <div className="min-w-0 flex-1">
          <div className="text-[26px] lg:text-[32px] font-black truncate" style={{ letterSpacing: '-1px' }}>
            {entry.name}
          </div>
        </div>
      </div>
      <div className="relative text-right flex-shrink-0">
        <div className="text-[52px] lg:text-[64px] font-black leading-none tabular-nums" style={{ letterSpacing: '-2px' }}>
          {fmt(entry.score)}
        </div>
        <div className="text-[11px] font-extrabold uppercase tracking-widest mt-1" style={{ color: palette.textDim }}>
          {unit}
        </div>
      </div>
    </div>
  );
}
