/* ============================================================
   TuGymPR · Analíticas Restyle — shared chart kit
   Ported from the Claude Design "Analíticas Restyle" handoff
   (analiticas-charts.jsx + analiticas-restyle.jsx). Pure-SVG /
   CSS charts on the admin CSS variables, so the warm mock is
   reproduced in light mode while staying theme- + white-label
   correct (accent = var(--color-accent)).
   ============================================================ */
import { TK, FK, TONE, Ico, Card } from '../retosKit';

export { TK, FK, TONE, Ico, Card };

/* analytics-specific inline icon paths (exact from the mock's AIC) */
export const AICON = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  sprout: <><path d="M12 21v-7M12 14c0-3-2-5-5-5H5v2c0 3 2 5 5 5h2ZM12 12c0-3 2-5 5-5h2v1c0 3-2 5-5 5h-2Z" /></>,
  bolt: <path d="M13 2 4 14h7l-2 8 9-12h-7l2-8Z" />,
  heart: <path d="M12 20s-7-4.5-9.5-9C1 8 2.5 4.5 6 4.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 15.5 12 20 12 20Z" />,
  scope: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" opacity="0.55" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>,
  chart: <><path d="M3 21h18" /><rect x="5" y="11" width="3.5" height="7" rx="1" /><rect x="10.5" y="6" width="3.5" height="12" rx="1" /><rect x="16" y="13" width="3.5" height="5" rx="1" /></>,
  users: <><path d="M16 19a4 4 0 0 0-8 0M12 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 11Z" /><path d="M21 18a3.2 3.2 0 0 0-4-3M7 15a3.2 3.2 0 0 0-4 3" /></>,
  flame: <path d="M12 2c1 3.5 4 5.2 4 9a4 4 0 0 1-8 0c0-1.4.5-2.4 1-3 .2 1 .8 1.7 1.6 1.9C10 8 11 5 12 2Z" />,
  dumbbell: <><path d="M6.5 6.5 17.5 17.5M3 7v10M21 7v10M6 4v16M18 4v16M2 12h2M20 12h2" /></>,
  pin: <><path d="M12 21s7-5.2 7-11a7 7 0 0 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  warn: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.5h.01" /></>,
  dollar: <><path d="M12 2v20M16.5 6.5C16.5 4.6 14.5 3.5 12 3.5S7.5 4.7 7.5 6.8 9.5 9.8 12 10.2s4.5 1.4 4.5 3.5-2 3.3-4.5 3.3-4.5-1.1-4.5-3" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5h.01" /></>,
  sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4L16 9.5" /></>,
  send: <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z" />,
  inbox: <><path d="M3 13h5l1.5 3h5L21 13M3 13l3-8h12l3 8M3 13v6h18v-6" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9.5h18" /></>,
  userx: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 11 0M16 8l4 4M20 8l-4 4" /></>,
  userplus: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 11 0M18 8v6M15 11h6" /></>,
  pulse: <path d="M3 12h4l3 7 4-14 3 7h4" />,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M9.5 14.5 9 18h6l-.5-3.5M8 21h8M12 18v3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  doc: <><path d="M6 2h8l4 4v16H6V2Z" /><path d="M14 2v4h4M9 13h6M9 17h6" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  chevL: <path d="m15 6-6 6 6 6" />,
  chevR: <path d="m9 6 6 6-6 6" />,
  printer: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6Z" /></>,
  eyeoff: <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9 9 0 0 1 21 12a9 9 0 0 1-1.6 2.6M6.1 6.1A9 9 0 0 0 3 12a9 9 0 0 0 8 5" /></>,
  trend: <><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></>,
};

/* ── smooth catmull-rom → bezier path through points [{x,y}] ── */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/* ── line/area chart ── */
export function LineChart({ data, xLabels = [], color = TK.accent, max, yTicks = 4, height = 230, target, unit = '', smooth = true }) {
  const W = 1000, H = height, padL = 44, padR = 18, padT = 18, padB = 30;
  const mx = max != null ? max : Math.max(1, ...data);
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xOf = i => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yOf = v => padT + innerH - (v / mx) * innerH;
  const pts = data.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
  const line = smooth ? smoothPath(pts) : 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
  const area = line + ` L ${xOf(data.length - 1)} ${padT + innerH} L ${xOf(0)} ${padT + innerH} Z`;
  const gid = 'ac_' + String(color).replace(/[^a-z0-9]/gi, '');
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (mx / yTicks) * i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((tv, i) => (
        <g key={i}>
          <line x1={padL} y1={yOf(tv)} x2={W - padR} y2={yOf(tv)} stroke={TK.divider} strokeWidth="1" strokeDasharray={i === 0 ? '0' : '4 6'} />
          <text x={padL - 10} y={yOf(tv) + 4} textAnchor="end" fontFamily={FK.mono} fontSize="13" fill={TK.textFaint}>{Math.round(tv)}{unit}</text>
        </g>
      ))}
      {target != null && (
        <line x1={padL} y1={yOf(target)} x2={W - padR} y2={yOf(target)} stroke={TK.accent} strokeWidth="1.5" strokeDasharray="6 5" opacity="0.55" />
      )}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {xLabels.map((lb, i) => {
        const idx = Math.round((i / (xLabels.length - 1)) * (data.length - 1));
        return <text key={i} x={xOf(idx)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
          fontFamily={FK.mono} fontSize="13" fill={TK.textMute}>{lb}</text>;
      })}
    </svg>
  );
}

/* ── donut ring ── */
export function Donut({ pct = 83, size = 150, stroke = 22, color = TK.accent, track = TK.surface3, label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span style={{ fontFamily: FK.display, fontSize: size * 0.22, fontWeight: 800, color, letterSpacing: -1 }}>{label || `${p}%`}</span>
      </div>
    </div>
  );
}

/* ── vertical bar chart ── */
export function BarChart({ data, height = 300, color = TK.accent }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, height, padding: '10px 6px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, height: '100%', justifyContent: 'flex-end', minWidth: 0 }}>
          <span style={{ fontFamily: FK.display, fontSize: 14, fontWeight: 800, color: TK.text }}>{d.value > 0 ? (d.label2 || d.value) : ''}</span>
          <div style={{
            width: '72%', maxWidth: 70, height: `${Math.max(2, (d.value / max) * 100)}%`, borderRadius: '7px 7px 3px 3px',
            background: d.value > 0 ? `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 78%, #ffffff))` : TK.surface3,
            boxShadow: d.value > 0 ? `0 2px 8px color-mix(in srgb, ${color} 26%, transparent)` : 'none', minHeight: 6,
          }} />
          <span style={{ fontFamily: FK.body, fontSize: 12, color: TK.textMute, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── funnel step list ── */
export function Funnel({ steps, color = TK.accent }) {
  const max = Math.max(1, ...steps.map(s => s.value));
  const lastColor = 'var(--color-coach)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: FK.mono, fontSize: 12, color: TK.textFaint, width: 14, textAlign: 'right' }}>{i}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 10 }}>
                <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
                  {s.drop ? <span style={{ fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: 'var(--color-danger)' }}>{s.drop}</span> : null}
                  <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.text }}>{s.value}</span>
                </span>
              </div>
              <div style={{ height: 9, borderRadius: 99, background: TK.surface3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(s.value / max) * 100}%`, borderRadius: 99, background: last ? lastColor : color }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── lifecycle stacked bar ── */
export function LifecycleBar({ segs, height = 34 }) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: 'flex', height, borderRadius: 10, overflow: 'hidden', gap: 3 }}>
      {segs.filter(s => s.value > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: 6 }} />
      ))}
    </div>
  );
}

/* ── cohort heatmap cell color (success/warning/danger soft + ink) ── */
export function cohortColor(v) {
  if (v == null) return { bg: TK.surface3, fg: TK.textFaint };
  if (v >= 70) return { bg: 'var(--color-success-soft)', fg: 'var(--color-success-ink, var(--color-success))' };
  if (v >= 40) return { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning-ink, var(--color-warning))' };
  return { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger-ink, var(--color-danger))' };
}

/* ── section label (divider + uppercase center text) ── */
export function SectionLabel({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '30px 0 18px' }}>
      <span style={{ flex: 1, height: 1, background: TK.borderSolid }} />
      <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.6, textTransform: 'uppercase', color: TK.textMute, textAlign: 'center' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: TK.borderSolid }} />
    </div>
  );
}

/* ── chart card chrome (title + subtitle + optional export + headline) ── */
export function ChartCard({ title, subtitle, big, bigColor, bigSub, children, onExport, exportLabel = 'Export', style = {} }) {
  return (
    <Card style={{ padding: '22px 24px 18px', display: 'flex', flexDirection: 'column', ...style }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FK.display, fontSize: 18, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{title}</div>
          {subtitle && <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 4 }}>{subtitle}</div>}
        </div>
        {onExport && (
          <button type="button" onClick={onExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textMute, cursor: 'pointer', background: 'transparent', border: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>
            <Ico ch={AICON.download} size={15} color={TK.textMute} stroke={2} />{exportLabel}
          </button>
        )}
      </div>
      {big != null && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, marginTop: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, color: bigColor || TK.accent }}>{big}</span>
          {bigSub && <span style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute }}>{bigSub}</span>}
        </div>
      )}
      <div style={{ marginTop: 14 }}>{children}</div>
    </Card>
  );
}

/* ── KPI objective card (Este mes) ── */
export function KpiCard({ icon, label, value, suggested, onSetTarget, targetLabel, suggestedPrefix = 'Suggested' }) {
  return (
    <Card style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}` }}>
          <Ico ch={icon} size={16} color={TK.accent} stroke={2} />
        </span>
        <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', color: TK.textSub }}>{label}</span>
      </div>
      <div style={{ fontFamily: FK.display, fontSize: 42, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1, color: TK.text, margin: '16px 0 14px' }}>{value}</div>
      <div style={{ height: 1, background: TK.divider }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={onSetTarget} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FK.body, fontSize: 13, fontWeight: 600, color: TK.textMute, cursor: 'pointer', background: 'transparent', border: 'none' }}>
          <Ico ch={AICON.plus} size={14} color={TK.textMute} stroke={2.2} />{targetLabel}
        </button>
        {suggested != null && (
          <button type="button" onClick={onSetTarget} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 12, fontWeight: 700, color: TK.accent, cursor: 'pointer' }}>
            <Ico ch={AICON.sparkle} size={12} color={TK.accent} stroke={2} />{suggestedPrefix}: {suggested}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ── small labelled value ── */
export function MiniStat({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textFaint, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: FK.display, fontSize: 22, fontWeight: 800, letterSpacing: -0.6, color: TK.text }}>{value}</div>
    </div>
  );
}

/* ── stat tile (icon chip + label + value + sub), toned ── */
export function StatTile({ icon, label, value, sub, tone = 'neutral' }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <div style={{ padding: '16px 18px', borderRadius: 14, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: c.bg, border: `1px solid ${c.line}`, flexShrink: 0 }}>
          <Ico ch={icon} size={15} color={c.ink} stroke={2} />
        </span>
        <span style={{ fontFamily: FK.body, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: TK.textMute }}>{label}</span>
      </div>
      <div style={{ fontFamily: FK.display, fontSize: 26, fontWeight: 800, letterSpacing: -0.8, color: TK.text }}>{value ?? '—'}</div>
      {sub && <div style={{ fontFamily: FK.body, fontSize: 12, color: TK.textFaint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ── empty state box ── */
export function EmptyBox({ icon, title, sub, h = 160 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: h, textAlign: 'center', padding: 20 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, marginBottom: 4 }}>
        <Ico ch={icon} size={20} color={TK.textFaint} stroke={1.8} />
      </span>
      <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 600, color: TK.textSub }}>{title}</span>
      {sub && <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint, maxWidth: 360 }}>{sub}</span>}
    </div>
  );
}

/* ── horizontal labelled progress row (used in effectiveness panel) ── */
export function HBarRow({ label, value, denominator, color = TK.accent, rightLabel }) {
  const pct = denominator > 0 ? Math.min(100, (value / denominator) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: FK.body, fontSize: 12.5, fontWeight: 600, color: TK.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontFamily: FK.mono, fontSize: 12, fontWeight: 700, color: TK.textMute, flexShrink: 0 }}>{rightLabel ?? value}</span>
      </div>
      <div style={{ height: 9, borderRadius: 99, background: TK.surface3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: color }} />
      </div>
    </div>
  );
}
