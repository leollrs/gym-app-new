/**
 * TVStyleBrutal — V2 Brutalist Board.
 *
 * Editorial / race-results aesthetic: cream paper background, dark ink
 * text, gym's hot color as the right-side accent strip and per-row bars.
 * High-contrast top 8 table with rank cell, bar, sessions stub, total.
 *
 * Cream / ink stay constant across gyms (paper is paper). The gym's
 * primary color drives the hot accent strip, "VOLUME." period, and the
 * #1 row highlight tint. Teal/coach used for #2/#3 medal stripes.
 */

import { TVAvatar, TVLogoMark } from './TVPrimitives';
import { TV_METRIC_DEFS } from '../../lib/tv/palette';
import { alpha } from '../../lib/tv/palette';

export default function TVStyleBrutal({ slide, palette, gymName, logoUrl, clock, timeFmt, dateFmt, slideIdx, totalSlides, metricKey }) {
  const entries = slide?.entries || [];
  const max = entries[0]?.score || 1;
  const total = entries.reduce((s, e) => s + (Number(e.score) || 0), 0);

  const fmt = (score) => {
    if (score == null) return '—';
    if (metricKey === 'improved') return `+${score}%`;
    if (metricKey === 'consistency') return `${score}%`;
    return Number(score).toLocaleString();
  };

  const fmtTotal = (score) => {
    if (metricKey === 'improved' || metricKey === 'consistency') return `${score}%`;
    if (score >= 1_000_000) return `${(score / 1_000_000).toFixed(2)}M`;
    return Number(score).toLocaleString();
  };

  return (
    <div className="absolute inset-0 overflow-hidden select-none" style={{ background: palette.cream, color: palette.textInk, fontFamily: 'Barlow, system-ui, sans-serif' }}>
      {/* side strips */}
      <div className="absolute top-0 left-0 bottom-0 w-6" style={{ background: palette.ink }} />
      <div className="absolute top-0 right-0 bottom-0 w-6" style={{ background: palette.hot }} />

      {/* ── Header ─────────────────────────────────────── */}
      <div className="absolute top-0 left-6 right-6 px-10 pt-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <TVLogoMark src={logoUrl} size={48} color={palette.ink} />
          <div>
            <div className="text-[12px] font-mono font-bold tracking-[0.22em] uppercase flex items-center gap-2" style={{ color: palette.hot }}>
              <span className="inline-block w-2 h-2 blink-dot" style={{ background: palette.hot, transform: 'rotate(45deg)' }} />
              Live · {gymName}
            </div>
            <div className="text-[28px] lg:text-[30px] font-black leading-none mt-0.5" style={{ letterSpacing: '-1px' }}>
              The Board / Monthly
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end font-mono">
          <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: palette.textInkDim }}>
            {dateFmt.format(clock).toUpperCase()}
          </div>
          <div className="text-[36px] lg:text-[40px] font-bold tabular-nums leading-none mt-1" style={{ letterSpacing: '-1.5px' }}>
            {timeFmt.format(clock).split(' ')[0]}<span style={{ color: palette.hot }}>{timeFmt.format(clock).split(' ')[1] || ''}</span>
          </div>
        </div>
      </div>

      {/* ── Category index row ─────────────────────────── */}
      <div className="absolute left-6 right-6 px-10" style={{ top: '110px' }}>
        <div className="py-3 grid grid-cols-6" style={{ borderTop: `2px solid ${palette.ink}`, borderBottom: `2px solid ${palette.ink}` }}>
          {TV_METRIC_DEFS.map((m, i) => {
            const isActive = m.key === metricKey;
            return (
              <div key={m.key} className="px-4" style={{
                borderRight: i < 5 ? `1px solid ${alpha(palette.ink, 0.18)}` : 'none',
                background: isActive ? palette.ink : 'transparent',
                color: isActive ? palette.cream : palette.ink,
              }}>
                <div className="text-[10px] lg:text-[11px] font-mono font-bold tracking-widest opacity-70">
                  CAT 0{i + 1}
                </div>
                <div className="text-[18px] lg:text-[22px] font-black uppercase mt-0.5" style={{ letterSpacing: '-0.6px' }}>
                  {m.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Headline + gym total ───────────────────────── */}
      <div className="absolute left-6 right-6 px-10 pt-6 flex items-end justify-between" style={{ top: '210px' }}>
        <div>
          <div className="text-[13px] lg:text-[14px] font-mono font-bold tracking-[0.3em] uppercase" style={{ color: palette.hot }}>
            {slide?.label?.toUpperCase()} · {slide?.period} · all members
          </div>
          <div className="font-black uppercase leading-[0.82] mt-1 text-[150px] lg:text-[180px] xl:text-[220px]" style={{ letterSpacing: '-9px' }}>
            {slide?.label?.toUpperCase() || ''}<span style={{ color: palette.hot }}>.</span>
          </div>
        </div>
        <div className="text-right pb-6 max-w-md">
          <div className="text-[14px] lg:text-[16px] font-bold tracking-widest uppercase" style={{ color: palette.textInkDim }}>
            Gym total / {slide?.period?.toLowerCase()}
          </div>
          <div className="text-[64px] lg:text-[80px] xl:text-[92px] font-black tabular-nums leading-none mt-1" style={{ letterSpacing: '-3px' }}>
            {fmtTotal(total)}
          </div>
          <div className="text-[13px] lg:text-[14px] font-mono font-bold mt-2" style={{ color: palette.hot, letterSpacing: '1.4px' }}>
            {slide?.unit?.toUpperCase()} · {entries.length} ON THE BOARD
          </div>
        </div>
      </div>

      {/* ── The board (top 8) ──────────────────────────── */}
      <div className="absolute left-6 right-6 bottom-16 px-10" style={{ top: '540px' }}>
        {/* table head */}
        <div className="grid font-mono text-[12px] font-bold tracking-widest uppercase py-1.5 px-3" style={{
          gridTemplateColumns: '90px 1.6fr 1.2fr 0.7fr 1fr',
          color: palette.textInkDim,
          borderBottom: `2px solid ${palette.ink}`,
        }}>
          <span>RANK</span><span>LIFTER</span><span>VS PEERS</span><span>POSITION</span><span className="text-right">TOTAL · {slide?.unit?.toUpperCase()}</span>
        </div>

        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-[36px] font-black" style={{ color: palette.textInk }}>No activity yet</div>
            <div className="text-[16px] mt-2" style={{ color: palette.textInkDim }}>The first member on the board wins this slide.</div>
          </div>
        ) : (
          entries.slice(0, 8).map((r, i) => {
            const rank = i + 1;
            const isTop = rank <= 3;
            const accent = rank === 1 ? palette.hot : rank === 2 ? palette.coach : rank === 3 ? palette.teal : 'transparent';
            const pct = (Number(r.score) / Number(max)) * 100;
            return (
              <div key={r.id || i} className="relative grid items-center py-3 px-3" style={{
                gridTemplateColumns: '90px 1.6fr 1.2fr 0.7fr 1fr',
                borderBottom: `1px solid ${alpha(palette.ink, 0.12)}`,
                background: rank === 1 ? alpha(palette.hot, 0.08) : 'transparent',
              }}>
                {/* rank cell */}
                <div className="flex items-center gap-2">
                  {isTop && <div className="w-1.5" style={{ height: '38px', background: accent }} />}
                  <span className="font-black tabular-nums text-[38px] lg:text-[44px] leading-none" style={{ letterSpacing: '-1.5px' }}>
                    {String(rank).padStart(2, '0')}
                  </span>
                </div>

                {/* lifter */}
                <div className="flex items-center gap-3 min-w-0">
                  <TVAvatar name={r.name} size={48} />
                  <div className="min-w-0">
                    <div className="text-[24px] lg:text-[26px] font-black uppercase truncate leading-none" style={{ letterSpacing: '-0.6px' }}>
                      {r.name}
                    </div>
                  </div>
                </div>

                {/* bar */}
                <div className="pr-4">
                  <div className="h-3 relative overflow-hidden" style={{ background: alpha(palette.ink, 0.08) }}>
                    <div className="h-full" style={{ width: `${pct}%`, background: isTop ? accent : palette.ink }} />
                  </div>
                </div>

                <div className="text-[20px] lg:text-[24px] font-black tabular-nums">
                  #{rank}
                </div>

                <div className="text-right">
                  <span className="text-[36px] lg:text-[48px] font-black tabular-nums leading-none" style={{ letterSpacing: '-1.6px' }}>
                    {fmt(r.score)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer ticker ──────────────────────────────── */}
      <div className="absolute bottom-0 left-6 right-6 h-14 flex items-center overflow-hidden" style={{ background: palette.ink, color: palette.cream }}>
        <div className="px-5 h-full flex items-center text-[14px] lg:text-[16px] font-black uppercase tracking-widest flex-shrink-0" style={{ background: palette.hot, color: palette.onHot }}>
          <span className="inline-block w-2 h-2 mr-2 blink-dot" style={{ background: palette.onHot, transform: 'rotate(45deg)' }} />
          NOW
        </div>
        <div className="flex-1 overflow-hidden whitespace-nowrap px-6 font-mono text-[13px] lg:text-[15px] font-semibold tracking-wide">
          <span>EN VIVO · ROTATING EVERY 20S</span>
          <span className="mx-4" style={{ color: alpha(palette.cream, 0.3) }}>////</span>
          <span style={{ color: palette.hot }}>NEXT ▸ </span>
          <span>{TV_METRIC_DEFS[(TV_METRIC_DEFS.findIndex(m => m.key === metricKey) + 1) % TV_METRIC_DEFS.length]?.label?.toUpperCase()}</span>
          <span className="mx-4" style={{ color: alpha(palette.cream, 0.3) }}>////</span>
          <span>{entries.length} ON THE BOARD · {fmtTotal(total)} TOTAL</span>
        </div>
        <div className="px-5 h-full flex items-center font-mono text-[12px] lg:text-[13px] font-bold tracking-widest flex-shrink-0" style={{ background: palette.cream, color: palette.ink }}>
          {String(slideIdx + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')} · 20S
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%, 60% { opacity: 1 } 70%, 100% { opacity: 0.25 } }
        .blink-dot { animation: blink 1.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
