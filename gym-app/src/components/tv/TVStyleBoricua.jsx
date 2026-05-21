/**
 * TVStyleBoricua — V3 Boricua Heat.
 *
 * Tropical sunset palette + sun motif + 3-column podium with #1 raised.
 * The sunset gradient is DERIVED from the gym's primary color:
 *   - sky1 (top): light-tinted primary (sun)
 *   - sky2: primary at full saturation
 *   - sky3: darker primary
 *   - sky4: deep purple (fixed)
 *   - sky5: near-black (fixed)
 *
 * For PR gym demo (#FF5A2E = orange), this reproduces the original sunset.
 * For a gym with a blue primary, this becomes a blue-to-purple twilight.
 * Either way it stays vibrant + warm-feeling.
 */

import { TVAvatar, TVLogoMark } from './TVPrimitives';
import { adjust, alpha, mix, TV_METRIC_DEFS, sizeForLabel } from '../../lib/tv/palette';
import { getTvStrings, getMetricSlides } from '../../lib/tv/strings';

export default function TVStyleBoricua({ slide, palette, gymName, logoUrl, clock, timeFmt, dateFmt, slideIdx, totalSlides, metricKey, lang = 'en' }) {
  const t = getTvStrings(lang);
  const localizedMetrics = getMetricSlides(lang);
  const entries = slide?.entries || [];
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 8);

  // Sunset palette derived from the gym's primary color.
  const sky1 = adjust(palette.hot, { l: 22, s: -10 });   // light gold-tinted top
  const sky2 = adjust(palette.hot, { l: 6 });             // primary
  const sky3 = adjust(palette.hot, { l: -18, s: 5 });     // darker primary
  const sky4 = '#3D1E5A';                                 // night purple (fixed)
  const sky5 = '#0B1428';                                 // deep ink (fixed)

  const fmt = (score, useK = true) => {
    if (score == null) return '—';
    if (metricKey === 'improved') return `+${score}%`;
    if (metricKey === 'consistency') return `${score}%`;
    if (metricKey === 'volume' && useK && Number(score) >= 1000) {
      return `${(Number(score) / 1000).toFixed(1)}K`;
    }
    return Number(score).toLocaleString();
  };

  return (
    <div className="absolute inset-0 select-none overflow-hidden" style={{
      background: `linear-gradient(180deg, ${sky1} 0%, ${sky2} 28%, ${sky3} 58%, ${sky4} 86%, ${sky5} 100%)`,
      color: '#FFFFFF',
      fontFamily: 'Barlow, system-ui, sans-serif',
    }}>
      {/* Sol */}
      <svg className="absolute inset-0 pointer-events-none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1920 1080" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="bsun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFF3C7" stopOpacity="0.95" />
            <stop offset="55%" stopColor={sky1} stopOpacity="0.7" />
            <stop offset="100%" stopColor={sky2} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="960" cy="540" r="520" fill="url(#bsun)" />
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i * 10) * Math.PI / 180;
          const x1 = 960 + Math.cos(a) * 280;
          const y1 = 540 + Math.sin(a) * 280;
          const x2 = 960 + Math.cos(a) * 920;
          const y2 = 540 + Math.sin(a) * 920;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFE6A8" strokeWidth="2" opacity="0.18" />;
        })}
        <line x1="0" y1="700" x2="1920" y2="700" stroke="#fff" strokeOpacity="0.18" strokeWidth="2" />
      </svg>

      {/* Texture grain */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0 1px, transparent 1px 4px)',
        mixBlendMode: 'overlay',
      }} />

      {/* ── Header ─────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 px-10 lg:px-14 pt-6 flex items-start justify-between">
        <div className="flex items-center gap-4">
          <TVLogoMark src={logoUrl} size={46} color="#fff" />
          <div>
            <div className="text-[22px] lg:text-[24px] font-black leading-none" style={{ letterSpacing: '-0.4px', textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
              {gymName}
            </div>
            <div className="text-[12px] font-extrabold tracking-[0.3em] uppercase opacity-85 mt-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full blink-dot bg-white" />
              {t.live} · {t.liveLeaderboard}
            </div>
          </div>
        </div>

        <div className="text-center hidden xl:block">
          <div className="flex gap-4 items-center">
            {localizedMetrics.map((m) => {
              const isActive = m.key === metricKey;
              return (
                <span key={m.key} className="text-[11px] font-bold tracking-widest uppercase" style={{ opacity: isActive ? 1 : 0.45 }}>
                  {m.label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[32px] lg:text-[38px] font-black tabular-nums leading-none" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
            {timeFmt.format(clock)}
          </div>
          <div className="text-[11px] font-extrabold tracking-widest uppercase opacity-85 mt-1">
            {dateFmt.format(clock)}
          </div>
        </div>
      </div>

      {/* ── Headline ───────────────────────────────────── */}
      <div className="absolute left-10 right-10 lg:left-14 lg:right-14 text-center" style={{ top: '110px' }}>
        <div className="text-[13px] lg:text-[14px] font-black tracking-[0.5em] uppercase opacity-85">
          {t.losMasFuertes} · {slide?.period}
        </div>
        <div className={`font-black uppercase mt-1 ${sizeForLabel(slide?.label || '', [
          { maxLen: 7,  classes: 'text-[120px] lg:text-[170px] xl:text-[200px]' },
          { maxLen: 11, classes: 'text-[96px] lg:text-[136px] xl:text-[160px]' },
          { maxLen: 14, classes: 'text-[76px] lg:text-[108px] xl:text-[130px]' },
          { maxLen: 99, classes: 'text-[60px] lg:text-[86px] xl:text-[104px]' },
        ])} leading-[0.85]`} style={{ letterSpacing: '-7px', textShadow: '0 6px 30px rgba(0,0,0,0.35)' }}>
          {slide?.label}
        </div>
      </div>

      {/* ── Podium (3 columns) ─────────────────────────── */}
      {top3.length > 0 ? (
        <div className="absolute left-10 right-10 lg:left-14 lg:right-14 grid grid-cols-3 gap-5 items-end" style={{ top: '460px', bottom: rest.length > 0 ? '170px' : '60px' }}>
          {[top3[1], top3[0], top3[2]].map((r, displayIdx) => {
            if (!r) return <div key={displayIdx} />;
            const rank = displayIdx === 0 ? 2 : displayIdx === 1 ? 1 : 3;
            const podiumBg =
              rank === 1
                ? `linear-gradient(180deg, ${adjust(palette.hot, { l: 25 })} 0%, ${adjust(palette.hot, { l: 10 })} 35%, ${adjust(palette.hot, { l: -8 })} 100%)`
                : rank === 2
                  ? `linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,225,200,0.75) 100%)`
                  : `linear-gradient(180deg, rgba(255,230,200,0.92) 0%, rgba(255,180,140,0.78) 100%)`;
            return (
              <div
                key={r.id || rank}
                className="relative rounded-t-3xl p-5 lg:p-7 flex flex-col justify-between"
                style={{
                  height: rank === 1 ? '440px' : rank === 2 ? '370px' : '330px',
                  background: podiumBg,
                  border: '1px solid rgba(255,255,255,0.5)',
                  boxShadow: '0 -8px 40px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.7)',
                  transform: rank === 1 ? 'translateY(-30px)' : 'none',
                }}
              >
                {/* rank ribbon */}
                <div className="absolute -top-5 left-6 right-6 flex items-center justify-between">
                  <div
                    className={`w-16 h-16 lg:w-[70px] lg:h-[70px] rounded-full flex items-center justify-center font-black text-[34px] lg:text-[38px] tabular-nums leading-none ${rank === 1 ? 'pulse-ring' : ''}`}
                    style={{
                      background: rank === 1 ? '#FFF' : rank === 2 ? palette.coach : palette.teal,
                      border: '4px solid #fff',
                      color: rank === 1 ? palette.hot : '#FFF',
                      letterSpacing: '-1px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    }}
                  >
                    {rank}
                  </div>
                  {rank === 1 && (
                    <div
                      className="px-3 py-1.5 rounded-full text-[10px] lg:text-[11px] font-black uppercase tracking-widest"
                      style={{ background: palette.ink, color: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.3)' }}
                    >
                      🏆 {t.champion}
                    </div>
                  )}
                </div>

                {/* portrait */}
                <div className="mt-9 flex items-center justify-center">
                  <TVAvatar name={r.name} size={rank === 1 ? 110 : 88} ring={rank === 1} ringColor="#fff" />
                </div>

                {/* name + value */}
                <div className="text-center min-w-0 px-1">
                  <div
                    className={`font-black uppercase leading-none truncate ${rank === 1 ? sizeForLabel(r.name || '', [
                      { maxLen: 10, classes: 'text-[36px] lg:text-[44px]' },
                      { maxLen: 16, classes: 'text-[28px] lg:text-[34px]' },
                      { maxLen: 99, classes: 'text-[22px] lg:text-[26px]' },
                    ]) : sizeForLabel(r.name || '', [
                      { maxLen: 10, classes: 'text-[26px] lg:text-[32px]' },
                      { maxLen: 16, classes: 'text-[20px] lg:text-[24px]' },
                      { maxLen: 99, classes: 'text-[16px] lg:text-[20px]' },
                    ])}`}
                    style={{ color: palette.ink, letterSpacing: '-1px' }}
                  >
                    {r.name}
                  </div>
                  <div
                    className={`font-black tabular-nums leading-[0.9] mt-3 ${rank === 1 ? sizeForLabel(fmt(r.score), [
                      { maxLen: 4, classes: 'text-[76px] lg:text-[96px]' },
                      { maxLen: 7, classes: 'text-[60px] lg:text-[76px]' },
                      { maxLen: 99, classes: 'text-[44px] lg:text-[58px]' },
                    ]) : sizeForLabel(fmt(r.score), [
                      { maxLen: 4, classes: 'text-[60px] lg:text-[72px]' },
                      { maxLen: 7, classes: 'text-[44px] lg:text-[56px]' },
                      { maxLen: 99, classes: 'text-[32px] lg:text-[42px]' },
                    ])}`}
                    style={{ color: palette.ink, letterSpacing: '-3px' }}
                  >
                    {fmt(r.score)}
                  </div>
                  <div className="text-[11px] lg:text-[12px] font-black uppercase tracking-widest mt-1 opacity-75" style={{ color: palette.ink }}>
                    {slide?.unit?.toLowerCase()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="absolute inset-x-0 text-center" style={{ top: '50%', transform: 'translateY(-50%)' }}>
          <div className="text-[36px] font-black">{t.noActivity}</div>
          <div className="text-[16px] mt-2 opacity-70">{t.noActivitySub}</div>
        </div>
      )}

      {/* ── 4-8 strip ──────────────────────────────────── */}
      {rest.length > 0 && (
        <div className="absolute bottom-14 left-10 right-10 lg:left-14 lg:right-14 h-24 rounded-2xl px-7 grid items-center gap-4" style={{
          background: 'rgba(11,20,40,0.55)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.12)',
          gridTemplateColumns: '120px repeat(5, 1fr)',
        }}>
          <div className="text-[22px] font-black uppercase tracking-widest">4 – 8</div>
          {rest.map((r, i) => (
            <div key={r.id || i} className="flex items-center gap-3 pl-4" style={{ borderLeft: '1px solid rgba(255,255,255,0.14)' }}>
              <div className="text-[36px] font-black opacity-40 tabular-nums leading-none" style={{ letterSpacing: '-1px', minWidth: '36px' }}>
                {String(i + 4).padStart(2, '0')}
              </div>
              <TVAvatar name={r.name} size={40} />
              <div className="min-w-0">
                <div className="text-[16px] lg:text-[17px] font-extrabold truncate leading-tight">{r.name}</div>
                <div className="text-[20px] lg:text-[22px] font-black tabular-nums" style={{ color: '#FFD56B', letterSpacing: '-0.5px' }}>
                  {fmt(r.score)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-9 flex items-center justify-between px-10 lg:px-14 text-[11px] font-mono tracking-widest" style={{ color: 'rgba(255,255,255,0.7)' }}>
        <span>
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 blink-dot" style={{ background: '#FFD56B' }} />
          {t.live} · {t.rotatesEvery.toUpperCase()} · {String(slideIdx + 1).padStart(2, '0')} / {String(totalSlides).padStart(2, '0')}
        </span>
        <span>{t.next} ▸ {localizedMetrics[(localizedMetrics.findIndex(m => m.key === metricKey) + 1) % localizedMetrics.length]?.label?.toUpperCase()}</span>
      </div>

      <style>{`
        @keyframes blink { 0%, 60% { opacity: 1 } 70%, 100% { opacity: 0.25 } }
        @keyframes pulse-ring {
          0% { box-shadow: 0 0 0 0 ${alpha(palette.hot, 0.55)}; }
          70% { box-shadow: 0 0 0 18px ${alpha(palette.hot, 0)}; }
          100% { box-shadow: 0 0 0 0 ${alpha(palette.hot, 0)}; }
        }
        .blink-dot { animation: blink 1.6s ease-in-out infinite; }
        .pulse-ring { animation: pulse-ring 2s ease-out infinite; }
      `}</style>
    </div>
  );
}
