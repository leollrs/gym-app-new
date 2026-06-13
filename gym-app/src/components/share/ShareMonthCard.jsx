// ShareMonthCard.jsx — "Wrapped × Strava" monthly-recap cards.
// Ported pixel-faithfully from the Claude Design handoff (smonth-kit.jsx +
// smonth-cards.jsx, chat35). Loud full-bleed gradient slides, giant Anton
// poster type, playful flex copy. Each card is its own bold color story.
//
// Cards auto-hide zero stats and reframe quiet months instead of shaming.
// Authored at 360×680 (9:16-ish) and scaled to fit BOTH dimensions via
// smScale, so 1:1 / 4:5 reflow instead of cropping.
//
// NOTE on "The Flex" (percentile) card from the design: it needs gym-wide
// ranking data we don't compute, so it's intentionally omitted here rather
// than fabricated. The other four directions run on real recap data.
import { useTranslation } from 'react-i18next';

// ── fonts (Anton added to index.html for the poster numerals) ──────────────
// Brand fonts (matches the design). They render in the preview via the Google
// CDN and in the EXPORT via the base64 @font-face embedded at raster time
// (embeddedFonts.js + rasterizeNode), so the upload matches the preview.
const SMFont = {
  huge:    '"Anton","Archivo Black",system-ui,sans-serif',
  numeral: '"Archivo","Familjen Grotesk",system-ui,sans-serif',
  display: '"Familjen Grotesk","Archivo",system-ui,sans-serif',
  body:    '-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif',
};

// ── vivid gradient palettes (brand-derived: teal · orange · purple) ────────
export const SM_PALS = {
  magma:    { grad: 'linear-gradient(150deg,#FFD15C 0%,#FF7A3D 42%,#F0245E 100%)', ink: '#2A0710', sub: 'rgba(42,7,16,0.66)',  chip: 'rgba(42,7,16,0.12)',  spot: '#FF7A3D', dark: false },
  electric: { grad: 'linear-gradient(160deg,#21E0D6 0%,#2C7BFF 52%,#7A2BE2 100%)', ink: '#FFFFFF', sub: 'rgba(255,255,255,0.8)', chip: 'rgba(255,255,255,0.18)', spot: '#2C7BFF', dark: true },
  violet:   { grad: 'linear-gradient(160deg,#A98BFF 0%,#6C45E6 44%,#16B6C4 100%)', ink: '#FFFFFF', sub: 'rgba(255,255,255,0.82)', chip: 'rgba(255,255,255,0.18)', spot: '#A98BFF', dark: true },
  lime:     { grad: 'linear-gradient(155deg,#DCF84E 0%,#46E2A8 52%,#16C0C4 100%)', ink: '#06231D', sub: 'rgba(6,35,29,0.62)',  chip: 'rgba(6,35,29,0.12)',  spot: '#46E2A8', dark: false },
};

// ── helpers ────────────────────────────────────────────────────────────────
export function smVol(lbs) {
  if (lbs >= 1000) return { n: (lbs / 1000).toFixed(lbs >= 100000 ? 0 : 1).replace(/\.0$/, ''), suffix: 'K' };
  return { n: String(lbs), suffix: '' };
}
function smCalendar(firstDow, daysInMonth) {
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(0);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(0);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
const smQuiet = (d) => d.workouts <= 2;
// width governs for tall 9:16; height governs for 1:1 / 4:5 so nothing clips.
const smScale = (w, h) => Math.min(w / 360, h / 680);

function smStatList(d, t) {
  const v = smVol(d.volumeLbs);
  return [
    { label: t('shareMonth.stat.sessions', 'sessions'), value: d.workouts, show: d.workouts > 0 },
    { label: t('shareMonth.stat.lbs', 'lbs'), value: v.n + v.suffix, show: d.volumeLbs > 0 },
    { label: t('shareMonth.stat.prs', 'PRs'), value: d.prs, show: d.prs > 0 },
    { label: t('shareMonth.stat.streak', 'day streak'), value: d.streak, show: d.streak > 0 },
  ].filter(s => s.show);
}

// ── icons ────────────────────────────────────────────────────────────────
function SMDumbbell({ size = 16, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="1.5" y="8" width="3.5" height="8" rx="1.2" fill={color}/>
      <rect x="19" y="8" width="3.5" height="8" rx="1.2" fill={color}/>
      <rect x="5" y="9.7" width="2.6" height="4.6" rx="1" fill={color}/>
      <rect x="16.4" y="9.7" width="2.6" height="4.6" rx="1" fill={color}/>
      <rect x="7.4" y="10.8" width="9.2" height="2.4" rx="1.2" fill={color}/>
    </svg>
  );
}

// ── card surface (full-bleed gradient + blobs + grain) ─────────────────────
function SMCard({ w, h, pal, children, sticker = false, style = {} }) {
  const p = pal || SM_PALS.magma;
  const pad = Math.round(w * 0.082);
  const blob = p.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.28)';
  const blobDk = p.dark ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.10)';
  return (
    <div style={{
      position: 'relative', width: w, height: h, overflow: 'hidden',
      borderRadius: sticker ? Math.round(w * 0.055) : 0,
      background: p.grad, fontFamily: SMFont.body,
      display: 'flex', flexDirection: 'column',
      boxShadow: sticker ? '0 24px 60px rgba(0,0,0,0.45)' : 'none',
      ...style,
    }}>
      <div style={{ position: 'absolute', top: -h * 0.16, right: -w * 0.22,
        width: w * 0.85, height: w * 0.85, borderRadius: '50%',
        background: `radial-gradient(circle, ${blob}, transparent 66%)`, pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', bottom: -h * 0.12, left: -w * 0.28,
        width: w * 0.8, height: w * 0.8, borderRadius: '50%',
        background: `radial-gradient(circle, ${blobDk}, transparent 64%)`, pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 0.5px, transparent 0.6px)',
        backgroundSize: `${Math.max(3, w * 0.012)}px ${Math.max(3, w * 0.012)}px`,
        mixBlendMode: p.dark ? 'overlay' : 'soft-light' }}/>
      <div style={{ position: 'relative', zIndex: 1, flex: 1,
        display: 'flex', flexDirection: 'column', padding: pad }}>
        {children}
      </div>
    </div>
  );
}

function SMTopRow({ d, p, s, tag }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ display: 'inline-block', padding: `${5 * s}px ${11 * s}px`, borderRadius: 999,
        background: p.chip, fontFamily: SMFont.display, fontWeight: 700, fontSize: 11 * s,
        letterSpacing: 1.4 * s, color: p.ink, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {tag || `${d.monthLabel} ${d.year}`}</span>
      {d.handle && <span style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 12.5 * s,
        color: p.sub, whiteSpace: 'nowrap' }}>{d.handle}</span>}
    </div>
  );
}

function SMWordmark({ s = 1, color = '#fff', sub = 'rgba(255,255,255,0.7)', label, name = 'TuGymPR', logoUrl }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 * s }}>
      {logoUrl ? (
        <img src={logoUrl} alt="" crossOrigin="anonymous"
          style={{ width: 22 * s, height: 22 * s, borderRadius: 6 * s, objectFit: 'cover', flexShrink: 0 }}/>
      ) : (
        <SMDumbbell size={15 * s} color={color}/>
      )}
      <span style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 12 * s,
        letterSpacing: 2.5 * s, color, textTransform: 'uppercase', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 * s }}>{name}</span>
      <span style={{ fontSize: 11 * s, color: sub, marginLeft: 'auto', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function SMBottom({ d, p, s, stats, recapLabel }) {
  return (
    <div>
      {stats && stats.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 * s, marginBottom: 14 * s }}>
          {stats.map((st, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 * s,
              padding: `${5 * s}px ${10 * s}px`, borderRadius: 999, background: p.chip }}>
              <b style={{ fontFamily: SMFont.numeral, fontWeight: 800, fontSize: 14 * s,
                color: p.ink, letterSpacing: -0.3 }}>{st.value}</b>
              <span style={{ fontSize: 10.5 * s, fontWeight: 700, color: p.sub,
                textTransform: 'uppercase', letterSpacing: 0.4 }}>{st.label}</span>
            </span>
          ))}
        </div>
      )}
      <SMWordmark s={s} color={p.ink} sub={p.sub} label={recapLabel} name={d.gym || 'TuGymPR'} logoUrl={d.gymLogoUrl}/>
    </div>
  );
}

function SMLabel({ children, p, s, style = {} }) {
  return (
    <div style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 13 * s,
      letterSpacing: 2 * s, textTransform: 'uppercase', color: p.sub, ...style }}>{children}</div>
  );
}
function SMPill({ children, p, s }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 * s, alignSelf: 'flex-start',
      padding: `${8 * s}px ${14 * s}px`, borderRadius: 999, background: p.chip,
      fontFamily: SMFont.display, fontWeight: 700, fontSize: 14 * s, color: p.ink, letterSpacing: -0.2,
      whiteSpace: 'nowrap' }}>{children}</span>
  );
}

// ── DIRECTION 1 · THE HEADLINE (volume) ────────────────────────────────────
function CardVolume({ d, w, h, t }) {
  const s = smScale(w, h), p = SM_PALS.magma, q = smQuiet(d), v = smVol(d.volumeLbs);
  const recapLabel = t('shareMonth.recapLabel', 'Monthly Recap');
  return (
    <SMCard w={w} h={h} pal={p}>
      <SMTopRow d={d} p={p} s={s}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {q ? (
          <>
            <SMLabel p={p} s={s}>{t('shareMonth.volume.quietEyebrow', 'This month you logged')}</SMLabel>
            <div style={{ fontFamily: SMFont.huge, fontSize: 96 * s, lineHeight: 0.84,
              color: p.ink, letterSpacing: -1 * s, marginTop: 6 * s }}>{t('shareMonth.volume.quietHero', 'DAY 1')}</div>
            <div style={{ fontSize: 16 * s, color: p.sub, marginTop: 14 * s, maxWidth: 250 * s,
              fontWeight: 600 }}>{t('shareMonth.volume.quietSub', 'One session on the board. The number only climbs from here.')}</div>
          </>
        ) : (
          <>
            <SMLabel p={p} s={s}>{t('shareMonth.volume.eyebrow', 'You moved')}</SMLabel>
            {/* marginTop clears the Anton glyph's upward overflow (lineHeight<1)
                so the giant number doesn't cover the eyebrow above it. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 20 * s }}>
              <span style={{ fontFamily: SMFont.huge, fontSize: 158 * s, lineHeight: 0.78,
                color: p.ink, letterSpacing: -2 * s }}>{v.n}</span>
              <span style={{ fontFamily: SMFont.huge, fontSize: 64 * s, color: p.ink,
                marginTop: 8 * s, marginLeft: 16 * s }}>{v.suffix}</span>
            </div>
            <div style={{ fontFamily: SMFont.huge, fontSize: 40 * s, color: p.ink,
              letterSpacing: 6 * s, marginTop: -2 * s }}>{t('shareMonth.volume.pounds', 'POUNDS')}</div>
            {d.comparison && (
              <div style={{ marginTop: 20 * s }}>
                <SMPill p={p} s={s}>{`🏋️ ${t('shareMonth.volume.comparison', 'heavier than {{thing}}', { thing: d.comparison })}`}</SMPill>
              </div>
            )}
          </>
        )}
      </div>
      <SMBottom d={d} p={p} s={s} recapLabel={recapLabel} stats={smStatList(d, t).filter(x => x.label !== t('shareMonth.stat.lbs', 'lbs')).slice(0, 3)}/>
    </SMCard>
  );
}

// ── DIRECTION 2 · THE COUNTDOWN (top lifts) ────────────────────────────────
function CardCountdown({ d, w, h, t }) {
  const s = smScale(w, h), p = SM_PALS.electric, q = (d.lifts || []).length === 0;
  const lifts = (d.lifts || []).slice(0, 4);
  const recapLabel = t('shareMonth.recapLabel', 'Monthly Recap');
  return (
    <SMCard w={w} h={h} pal={p}>
      <SMTopRow d={d} p={p} s={s} tag={t('shareMonth.countdown.tag', 'TOP LIFTS')}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 * s }}>
        {q ? (
          <>
            <div style={{ fontFamily: SMFont.huge, fontSize: 72 * s, lineHeight: 0.84,
              color: p.ink, letterSpacing: -1 * s }} dangerouslySetInnerHTML={{ __html: t('shareMonth.countdown.quietHero', 'BACK<br/>AT IT') }}/>
            <div style={{ fontSize: 16 * s, color: p.sub, marginTop: 14 * s, maxWidth: 250 * s, fontWeight: 600 }}>
              {t('shareMonth.countdown.quietSub', 'No PRs yet — but every set is a rep toward the next one.')}</div>
          </>
        ) : (
          <>
            <SMLabel p={p} s={s} style={{ marginBottom: 10 * s }}>{t('shareMonth.countdown.eyebrow', 'Your heaviest hits')}</SMLabel>
            {lifts.map((lf, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 * s,
                padding: `${9 * s}px 0`, borderTop: i ? `1px solid ${p.chip}` : 'none' }}>
                <span style={{ fontFamily: SMFont.huge, fontSize: 38 * s, lineHeight: 1,
                  color: p.ink, opacity: i === 0 ? 1 : 0.42, width: 34 * s }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 17 * s,
                    color: p.ink, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lf.name}</div>
                  <div style={{ fontSize: 11.5 * s, color: p.sub, fontWeight: 700, marginTop: 1 * s }}>
                    {lf.pr ? `+${lf.pr} ${lf.unit} ${t('shareMonth.countdown.prTag', 'PR')}` : t('shareMonth.countdown.prGeneric', 'personal record')}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 * s }}>
                  <span style={{ fontFamily: SMFont.numeral, fontWeight: 800, fontSize: 30 * s,
                    color: p.ink, letterSpacing: -1 * s }}>{lf.val}</span>
                  <span style={{ fontSize: 12 * s, fontWeight: 700, color: p.sub }}>{lf.unit}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <SMBottom d={d} p={p} s={s} recapLabel={recapLabel} stats={smStatList(d, t).slice(0, 3)}/>
    </SMCard>
  );
}

// ── DIRECTION 3 · THE SHOW-UP (heatmap) ────────────────────────────────────
function CardShowUp({ d, w, h, t }) {
  const s = smScale(w, h), p = SM_PALS.violet, q = smQuiet(d);
  const weeks = smCalendar(d.firstDow, d.daysInMonth);
  const recapLabel = t('shareMonth.recapLabel', 'Monthly Recap');
  const fill = (lvl) => lvl === 3 ? '#fff'
    : lvl === 2 ? 'rgba(255,255,255,0.66)'
    : lvl === 1 ? 'rgba(255,255,255,0.36)'
    : 'rgba(255,255,255,0.14)';
  return (
    <SMCard w={w} h={h} pal={p}>
      <SMTopRow d={d} p={p} s={s}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 * s }}>
        <div>
          <SMLabel p={p} s={s}>{t('shareMonth.showup.eyebrow', 'You showed up')}</SMLabel>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 * s, marginTop: 14 * s }}>
            <span style={{ fontFamily: SMFont.huge, fontSize: 110 * s, lineHeight: 0.78,
              color: p.ink, letterSpacing: -2 * s }}>{d.daysTrained ?? d.workouts}</span>
            <span style={{ fontFamily: SMFont.huge, fontSize: 38 * s, color: p.ink,
              letterSpacing: 3 * s, paddingBottom: 12 * s }}>{(d.daysTrained ?? d.workouts) === 1 ? t('shareMonth.showup.day', 'DAY') : t('shareMonth.showup.days', 'DAYS')}</span>
          </div>
          <div style={{ fontSize: 14 * s, color: p.sub, fontWeight: 600, marginTop: 4 * s }}>
            {q ? t('shareMonth.showup.quietSub', 'the comeback starts here')
               : t('shareMonth.showup.sub', 'best week: {{best}} sessions · {{avg}}/wk average', { best: d.bestWeek, avg: d.perWeek })}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 * s }}>
          {weeks.flat().map((day, i) => {
            const lvl = day ? (d.trained[day] || 0) : -1;
            return <div key={i} style={{ aspectRatio: '1', borderRadius: 5 * s,
              background: lvl === -1 ? 'transparent' : fill(lvl),
              boxShadow: lvl === 3 ? `0 0 ${9 * s}px rgba(255,255,255,0.6)` : 'none' }}/>;
          })}
        </div>
      </div>
      <SMBottom d={d} p={p} s={s} recapLabel={recapLabel} stats={smStatList(d, t).filter(x => x.label !== t('shareMonth.stat.sessions', 'sessions')).slice(0, 3)}/>
    </SMCard>
  );
}

// ── DIRECTION 4 · THE COME-UP (volume climb) ───────────────────────────────
function CardClimb({ d, w, h, t }) {
  const s = smScale(w, h), p = SM_PALS.lime, q = smQuiet(d);
  const vals = (d.weeklyVol && d.weeklyVol.length) ? d.weeklyVol : [0, 0, 0, 0];
  const max = Math.max(...vals, 1);
  const pad = Math.round(w * 0.082);
  const cw = w - 2 * pad, ch = 150 * s;
  const recapLabel = t('shareMonth.recapLabel', 'Monthly Recap');
  const pts = vals.map((v, i) => ({
    x: vals.length === 1 ? cw / 2 : (i / (vals.length - 1)) * cw,
    y: ch - (v / max) * (ch - 22 * s) - 10 * s,
  }));
  const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x},${pt.y}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x},${ch} L${pts[0].x},${ch} Z`;
  return (
    <SMCard w={w} h={h} pal={p}>
      <SMTopRow d={d} p={p} s={s} tag={t('shareMonth.climb.tag', 'THE COME-UP')}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 * s }}>
        <div>
          <SMLabel p={p} s={s}>{t('shareMonth.climb.eyebrow', 'Volume, week by week')}</SMLabel>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 * s, marginTop: 14 * s }}>
            <span style={{ fontFamily: SMFont.huge, fontSize: 104 * s, lineHeight: 0.78,
              color: p.ink, letterSpacing: -2 * s }}>{q ? '+1' : `+${d.growth}`}</span>
            {!q && <span style={{ fontFamily: SMFont.huge, fontSize: 48 * s, color: p.ink, marginTop: 8 * s }}>%</span>}
          </div>
          <div style={{ fontSize: 15 * s, color: p.sub, fontWeight: 600, marginTop: 4 * s }}>
            {q ? t('shareMonth.climb.quietSub', 'your first data point on the board') : t('shareMonth.climb.sub', 'more weight, every single week')}</div>
        </div>
        <svg width={cw} height={ch + 24 * s} style={{ overflow: 'visible' }}>
          <defs>
            <linearGradient id="smClimbG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.ink} stopOpacity="0.28"/>
              <stop offset="100%" stopColor={p.ink} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={area} fill="url(#smClimbG)"/>
          <path d={line} fill="none" stroke={p.ink} strokeWidth={3.5 * s}
            strokeLinecap="round" strokeLinejoin="round"/>
          {pts.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={(i === pts.length - 1 ? 7 : 4) * s}
              fill={i === pts.length - 1 ? p.ink : '#DCF84E'}
              stroke={p.ink} strokeWidth={2.5 * s}/>
          ))}
          {/* week labels make it explicit the plot is volume per week of month */}
          {pts.map((pt, i) => (
            <text key={`wk${i}`} x={pt.x} y={ch + 18 * s}
              textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
              fontFamily={SMFont.display} fontWeight="700" fontSize={11 * s} fill={p.sub}>
              {`${t('shareMonth.climb.week', 'WK')}${i + 1}`}
            </text>
          ))}
        </svg>
      </div>
      <SMBottom d={d} p={p} s={s} recapLabel={recapLabel} stats={smStatList(d, t).slice(0, 3)}/>
    </SMCard>
  );
}

// ── sticker (vivid recap chip over the user's photo) ───────────────────────
function SMSticker({ d, w, h, t }) {
  const s = smScale(w, h), p = SM_PALS.magma;
  const sw = w * 0.84;
  const stats = smStatList(d, t).slice(0, 3);
  const sessionsLabel = t('shareMonth.stat.sessions', 'sessions');
  return (
    <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden',
      borderRadius: 18 * s, background: 'transparent' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%) rotate(-3deg)',
        width: sw, padding: 22 * s, borderRadius: 22 * s, background: p.grad,
        boxShadow: '0 22px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 11 * s,
            letterSpacing: 1.4 * s, color: p.ink, textTransform: 'uppercase' }}>{d.monthLabel} {d.year}</span>
          {d.handle && <span style={{ fontFamily: SMFont.display, fontWeight: 700, fontSize: 11.5 * s, color: p.sub }}>{d.handle}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 * s, marginTop: 6 * s }}>
          <span style={{ fontFamily: SMFont.huge, fontSize: 72 * s, lineHeight: 0.8, color: p.ink, letterSpacing: -1 * s }}>{d.workouts}</span>
          <span style={{ fontFamily: SMFont.huge, fontSize: 24 * s, color: p.ink, paddingBottom: 8 * s, letterSpacing: 1 * s }}>
            {d.workouts === 1 ? t('shareMonth.sticker.session', 'SESSION') : t('shareMonth.sticker.sessions', 'SESSIONS')}</span>
        </div>
        <div style={{ display: 'flex', gap: 7 * s, marginTop: 14 * s, flexWrap: 'wrap' }}>
          {stats.filter(x => x.label !== sessionsLabel).map((st, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 * s,
              padding: `${5 * s}px ${10 * s}px`, borderRadius: 999, background: p.chip }}>
              <b style={{ fontFamily: SMFont.numeral, fontWeight: 800, fontSize: 14 * s, color: p.ink }}>{st.value}</b>
              <span style={{ fontSize: 10.5 * s, fontWeight: 700, color: p.sub, textTransform: 'uppercase' }}>{st.label}</span>
            </span>
          ))}
        </div>
        <div style={{ marginTop: 14 * s }}><SMWordmark s={s * 0.92} color={p.ink} sub={p.sub} label={t('shareMonth.recapLabel', 'Monthly Recap')} name={d.gym || 'TuGymPR'} logoUrl={d.gymLogoUrl}/></div>
      </div>
    </div>
  );
}

// ── registry + router ──────────────────────────────────────────────────────
export const SM_CARD_IDS = [
  { id: 'volume',    labelKey: 'shareMonth.cards.volume',    labelDefault: 'The Headline', Comp: CardVolume },
  { id: 'countdown', labelKey: 'shareMonth.cards.countdown', labelDefault: 'Top Lifts',    Comp: CardCountdown },
  { id: 'showup',    labelKey: 'shareMonth.cards.showup',    labelDefault: 'The Show-Up',  Comp: CardShowUp },
  { id: 'climb',     labelKey: 'shareMonth.cards.climb',     labelDefault: 'The Come-Up',  Comp: CardClimb },
];

// Renders a card by id. Sticker overrides everything (it's a different surface).
export function ShareMonthCard({ id, data, w, h, sticker = false }) {
  const { t } = useTranslation('pages');
  if (sticker) return <SMSticker d={data} w={w} h={h} t={t}/>;
  const entry = SM_CARD_IDS.find(c => c.id === id) || SM_CARD_IDS[0];
  const Comp = entry.Comp;
  return <Comp d={data} w={w} h={h} t={t}/>;
}

// ── real-data mapper ────────────────────────────────────────────────────────
// Maps the recap + this month's sessions/PRs into the SM_DATA card shape.
// Everything degrades: zero stats auto-hide and quiet months reframe.
const ELEPHANT_LB = 12000, CAR_LB = 4000;
function buildComparison(lbs, t) {
  if (lbs >= ELEPHANT_LB) {
    const n = Math.max(1, Math.round(lbs / ELEPHANT_LB));
    return t('shareMonth.compare.elephants', '{{count}} elephants', { count: n });
  }
  if (lbs >= CAR_LB) {
    const n = Math.max(1, Math.round(lbs / CAR_LB));
    return t('shareMonth.compare.cars', '{{count}} cars', { count: n });
  }
  return '';
}

export function buildShareMonthData({ recap, monthSessions = [], monthPRs = [], user, gym, gymLogoUrl, t, lang }) {
  const now = new Date();
  // Derive month + year straight from the Date (the recap is always "this
  // month"). Parsing recap.monthLabel broke on the Spanish "junio de 2026"
  // form, which left a stray "DE". toLocaleDateString gives a clean,
  // language-correct month name.
  const year = String(now.getFullYear());
  const monthLabel = now.toLocaleDateString(lang || undefined, { month: 'long' }).toUpperCase();

  const volumeLbs = Math.round(recap.totalVolumeLbs || 0);
  const workouts = recap.workouts || 0;

  const monthIdx = now.getMonth(), yr = now.getFullYear();
  const daysInMonth = new Date(yr, monthIdx + 1, 0).getDate();
  const firstDow = new Date(yr, monthIdx, 1).getDay();

  // Per-day training intensity (1–3) from this month's sessions.
  const trained = {};
  monthSessions.forEach(sn => {
    const ds = sn.completed_at || sn.started_at;
    if (!ds) return;
    const day = new Date(ds).getDate();
    trained[day] = Math.min(3, (trained[day] || 0) + 1);
  });
  // DISTINCT days trained — NOT the session count. Two sessions on one day is
  // one day. The "Show-Up" headline counts days; the session total is a
  // separate stat chip. (workouts = sessions, daysTrained = unique days.)
  const daysTrained = Object.keys(trained).length;

  // Weekly volume buckets (week-of-month) + week-over-week growth.
  const weekBuckets = {};
  monthSessions.forEach(sn => {
    const ds = sn.completed_at || sn.started_at;
    if (!ds) return;
    const wk = Math.floor((new Date(ds).getDate() - 1) / 7);
    weekBuckets[wk] = (weekBuckets[wk] || 0) + (parseFloat(sn.total_volume_lbs) || 0);
  });
  const weekCount = Math.ceil(daysInMonth / 7);
  const weeklyVol = Array.from({ length: weekCount }, (_, i) => Math.round(weekBuckets[i] || 0));
  const nz = weeklyVol.filter(v => v > 0);
  const growth = nz.length >= 2 && nz[0] > 0
    ? Math.max(0, Math.round((nz[nz.length - 1] / nz[0] - 1) * 100))
    : 0;

  // Sessions per week-of-month → best week + per-week average.
  const wkCounts = {};
  monthSessions.forEach(sn => {
    const ds = sn.completed_at || sn.started_at;
    if (!ds) return;
    const wk = Math.floor((new Date(ds).getDate() - 1) / 7);
    wkCounts[wk] = (wkCounts[wk] || 0) + 1;
  });
  const bestWeek = Math.max(0, ...Object.values(wkCounts));
  const daysElapsed = Math.max(1, now.getDate());
  const perWeek = (workouts / daysElapsed * 7).toFixed(1).replace(/\.0$/, '');

  // Top lifts from this month's PRs (heaviest first).
  const lifts = [...monthPRs]
    .filter(pr => (pr.weight_lbs || pr.estimated_1rm))
    .sort((a, b) => (b.weight_lbs || b.estimated_1rm || 0) - (a.weight_lbs || a.estimated_1rm || 0))
    .slice(0, 4)
    .map(pr => ({
      name: pr.exercises?.name || pr.exercise_name || 'Lift',
      val: Math.round(pr.weight_lbs || pr.estimated_1rm || 0),
      unit: 'lb',
      pr: 0, // previous-best delta isn't stored; show generic "personal record"
    }));

  const username = user?.username ? `@${user.username}` : '';

  return {
    monthLabel, year,
    handle: username,
    gym: gym || '',
    gymLogoUrl: gymLogoUrl || null,
    volumeLbs,
    workouts,
    daysTrained,
    prs: recap.prCount || 0,
    streak: recap.streakDays || 0,
    daysInMonth, firstDow, trained,
    weeklyVol, growth,
    bestWeek, perWeek,
    lifts,
    comparison: buildComparison(volumeLbs, t),
  };
}
