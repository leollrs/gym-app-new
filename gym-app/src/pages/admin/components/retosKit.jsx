/* ============================================================
   TuGymPR · Retos Restyle — shared kit
   Ported from the Claude Design "Retos Restyle" handoff.
   The mock's hardcoded warm/orange T tokens map 1:1 onto the
   existing admin CSS variables (light + dark), and the mock's
   orange accent is the white-label var(--color-accent). So this
   reproduces the mock in light mode while staying theme- and
   white-label-correct.
   ============================================================ */

/* ── fonts ── */
export const FK = {
  display: 'var(--admin-font-display, "Archivo","Barlow",system-ui,sans-serif)',
  body: 'var(--admin-font-body, "Barlow",-apple-system,system-ui,sans-serif)',
  mono: 'var(--admin-font-mono, "JetBrains Mono","SF Mono",ui-monospace,monospace)',
};

/* ── tokens (mock T.* → admin vars) ── */
export const TK = {
  bg: 'var(--color-admin-shell)',
  bgElev: 'var(--color-admin-sidebar)',
  surface: 'var(--color-bg-card)',
  surface2: 'var(--color-admin-panel)',
  surface3: 'var(--color-admin-panel)',
  borderSolid: 'var(--color-admin-border)',
  divider: 'var(--color-admin-border)',
  text: 'var(--color-admin-text)',
  textSub: 'var(--color-admin-text-sub)',
  textMute: 'var(--color-admin-text-muted)',
  textFaint: 'var(--color-admin-text-faint)',
  accent: 'var(--color-accent)',
  accentDark: 'var(--color-accent-dark, var(--color-accent))',
  accentSoft: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
  accentWash: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
  accentInk: 'var(--color-accent-dark, var(--color-accent))',
  accentLine: 'color-mix(in srgb, var(--color-accent) 32%, transparent)',
  shadow: 'var(--shadow-card)',
  shadowLg: 'var(--shadow-card-hover)',
};

/* tone families: mock hot→danger, warn→warning, good→success */
export const TONE = {
  neutral: { bg: TK.surface2, fg: TK.textSub, ink: TK.textSub, line: TK.borderSolid },
  accent:  { bg: TK.accentSoft, fg: TK.accent, ink: TK.accentInk, line: TK.accentLine },
  hot:     { bg: 'var(--color-danger-soft)',  fg: 'var(--color-danger)',  ink: 'var(--color-danger-ink, var(--color-danger))',   line: 'color-mix(in srgb, var(--color-danger) 32%, transparent)' },
  warn:    { bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)', ink: 'var(--color-warning-ink, var(--color-warning))', line: 'color-mix(in srgb, var(--color-warning) 32%, transparent)' },
  coach:   { bg: 'var(--color-coach-soft)',   fg: 'var(--color-coach)',   ink: 'var(--color-coach-ink, var(--color-coach))',     line: 'color-mix(in srgb, var(--color-coach) 32%, transparent)' },
  good:    { bg: 'var(--color-success-soft)', fg: 'var(--color-success)', ink: 'var(--color-success-ink, var(--color-success))', line: 'color-mix(in srgb, var(--color-success) 32%, transparent)' },
  info:    { bg: 'var(--color-info-soft)',    fg: 'var(--color-info)',    ink: 'var(--color-info-ink, var(--color-info))',       line: 'color-mix(in srgb, var(--color-info) 32%, transparent)' },
};

/* ── inline icon system (exact paths from the mock) ── */
export function Ico({ ch, size = 18, stroke = 1.9, color = 'currentColor', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{ch}</svg>
  );
}

export const ICON = {
  plus: <><path d="M12 5v14M5 12h14" /></>,
  chevD: <path d="m6 9 6 6 6-6" />,
  chevU: <path d="m6 15 6-6 6 6" />,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  flame: <path d="M12 2c1 3.5 4 5.2 4 9a4 4 0 0 1-8 0c0-1.4.5-2.4 1-3 .2 1 .8 1.7 1.6 1.9C10 8 11 5 12 2Z" />,
  bolt: <path d="M13 2 4 14h7l-2 8 9-12h-7l2-8Z" />,
  sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" />,
  bar: <><path d="M3 21h18" /><rect x="5" y="11" width="3.5" height="7" rx="1" /><rect x="10.5" y="6" width="3.5" height="12" rx="1" /><rect x="16" y="13" width="3.5" height="5" rx="1" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" /><path d="M9.5 14.5 9 18h6l-.5-3.5M8 21h8M12 18v3" /></>,
  bulb: <><path d="M9 18h6M10 21.5h4" /><path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.8.7 1 1.2 1 2.4h6c0-1.2.2-1.7 1-2.4A6.5 6.5 0 0 0 12 2.5Z" /></>,
  gift: <><rect x="3.5" y="9" width="17" height="12" rx="1.6" /><path d="M3.5 13h17M12 9v12" /><path d="M12 9S10.7 4.5 8 5.2 12 9 12 9ZM12 9s1.3-4.5 4-3.8S12 9 12 9Z" /></>,
  medal: <><path d="m8 4-3 .6 2 4.4M16 4l3 .6-2 4.4" /><circle cx="12" cy="14.5" r="5.5" /><path d="M12 12v2l1.4 1" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>,
  award: <><circle cx="12" cy="8" r="6" /><path d="M8.5 13.5 7 22l5-3 5 3-1.5-8.5" /></>,
  crown: <path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7Z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 20h16" /></>,
  dumbbell: <><path d="M6.5 6.5 17.5 17.5M3 7v10M21 7v10M6 4v16M18 4v16M2 12h2M20 12h2" /></>,
  checkin: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  trend: <><path d="M3 17l6-6 4 4 7-7" /><path d="M17 8h4v4" /></>,
  steady: <><path d="M3 12h4l3 7 4-14 3 7h4" /></>,
  refresh: <><path d="M3 2v6h6" /><path d="M3.5 8a9 9 0 1 1-1 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  cake: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="M5 15c1.2 0 1.2 1 2.3 1s1.2-1 2.3-1 1.2 1 2.4 1 1.2-1 2.3-1 1.2 1 2.4 1" /><path d="M9 8.5V6M12 8.5V6M15 8.5V6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>,
  tag: <><path d="M3 7v5.5a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.5-5.5a2 2 0 0 0 0-2.8l-7-7A2 2 0 0 0 12.5 3H7a4 4 0 0 0-4 4Z" /><circle cx="8" cy="8" r="1.4" /></>,
  star: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6-4.5-4.2 6.1-.7L12 3Z" />,
  ticket: <><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" /><path d="M15 6v12" strokeDasharray="2 2" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  bag: <><path d="M6 7V6a3 3 0 0 1 6 0v1m-9 0h12l1 13H4L5 7Z" /></>,
  dollar: <><path d="M12 2v20M16.5 6.5C16.5 4.6 14.5 3.5 12 3.5S7.5 4.7 7.5 6.8 9.5 9.8 12 10.2s4.5 1.4 4.5 3.5-2 3.3-4.5 3.3-4.5-1.1-4.5-3" /></>,
  qr: <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><rect x="9" y="9" width="6" height="6" rx="1" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  minus: <path d="M5 12h14" />,
  sliders: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></>,
  signpost: <path d="M12 3v3M12 21v-7M5 6h11l3 2.5L16 11H5V6Z" />,
  arrowR: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4L16 9.5" /></>,
};

/* type → icon for challenge type pills */
export const TYPE_ICON = {
  consistency: ICON.flame,
  volume: ICON.bolt,
  pr_count: ICON.trophy,
  specific_lift: ICON.target,
  team: ICON.users,
  milestone: ICON.target,
};

/* ── primitives ── */
export function Card({ children, style = {}, hover = false, ...p }) {
  return (
    <div {...p} className={`retos-card${hover ? ' retos-card--hover' : ''}`}
      style={{ background: TK.surface, borderRadius: 16, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow, ...style }}>
      {children}
    </div>
  );
}

export function IconChip({ ch, tone = 'neutral', size = 40, r = 12, strokeW = 2 }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <div style={{ width: size, height: size, borderRadius: r, background: c.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Ico ch={ch} size={Math.round(size * 0.5)} color={c.fg} stroke={strokeW} />
    </div>
  );
}

export function Pill({ children, tone = 'neutral', icon, solid = false }) {
  const c = TONE[tone] || TONE.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FK.body, fontSize: 10.5, fontWeight: 800,
      color: solid ? '#fff' : c.ink, background: solid ? c.fg : c.bg, padding: '3px 9px', borderRadius: 999,
      letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {icon && <Ico ch={icon} size={11} color={solid ? '#fff' : c.ink} stroke={2.4} />}{children}
    </span>
  );
}

/* outline status pill (FINALIZADO / EN VIVO / SIN PREMIOS) */
export function OutPill({ children, tone = 'neutral', dot = false }) {
  const map = {
    neutral: { fg: TK.textSub, line: TK.borderSolid, bg: TK.surface, dot: TK.textFaint },
    good: { fg: 'var(--color-success-ink, var(--color-success))', line: 'color-mix(in srgb, var(--color-success) 35%, transparent)', bg: 'var(--color-success-soft)', dot: 'var(--color-success)' },
    accent: { fg: TK.accentInk, line: TK.accentLine, bg: TK.accentWash, dot: TK.accent },
    warn: { fg: 'var(--color-warning-ink, var(--color-warning))', line: 'color-mix(in srgb, var(--color-warning) 35%, transparent)', bg: 'var(--color-warning-soft)', dot: 'var(--color-warning)' },
  };
  const c = map[tone] || map.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FK.body, fontSize: 10.5, fontWeight: 800,
      letterSpacing: 0.7, textTransform: 'uppercase', color: c.fg, background: c.bg,
      border: `1px solid ${c.line}`, padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: c.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${c.dot} 18%, transparent)` }} />}
      {children}
    </span>
  );
}

export function Label({ children, style = {} }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute, ...style }}>
      {children}
    </div>
  );
}

/* confidence meter */
export function Confidence({ pct = 85, label = 'Confidence' }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ fontFamily: FK.body, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textMute, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: TK.surface3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, width: `${p}%`, borderRadius: 99, background: `linear-gradient(90deg, color-mix(in srgb, ${TK.accent} 45%, transparent), ${TK.accent})` }} />
      </div>
      <span style={{ fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.accent, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>{p}%</span>
    </div>
  );
}

/* gradient avatar (uses accent-tinted gradients so it adapts to brand) */
export function Avatar({ initials, size = 30, hue = 0 }) {
  const grads = [
    `linear-gradient(135deg, color-mix(in srgb, ${TK.accent} 45%, white), ${TK.accent})`,
    'linear-gradient(135deg,#C8BEF6,#6D5FDB)',
    'linear-gradient(135deg,#BFE6CE,#2FA66B)',
    'linear-gradient(135deg,#F6C9DC,#D14B86)',
  ];
  return (
    <span style={{
      width: size, height: size, borderRadius: 99, flexShrink: 0, background: grads[hue % grads.length],
      display: 'grid', placeItems: 'center', fontFamily: FK.display, fontSize: size * 0.38, fontWeight: 800, color: '#fff',
      boxShadow: '0 1px 3px rgba(15,20,25,0.18)',
    }}>{initials}</span>
  );
}

/* prize 1/2/3 grid (medal colors are semantic → color-mix so they survive dark mode) */
const MEDALS = [
  { col: '#E0A82E', bg: 'color-mix(in srgb, #E0A82E 18%, transparent)' },
  { col: '#9AA4AE', bg: 'color-mix(in srgb, #9AA4AE 20%, transparent)' },
  { col: '#C77B3E', bg: 'color-mix(in srgb, #C77B3E 18%, transparent)' },
];
export function PremiosBox({ rewards = [], title = 'Prizes', placeWord = 'place', ordinal = (n) => `${n}` }) {
  const list = rewards.slice(0, 3);
  if (!list.length) return null;
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${TK.borderSolid}`, background: TK.surface2, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px 11px' }}>
        <Ico ch={ICON.gift} size={16} color={TK.accent} stroke={2.1} />
        <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.accent }}>{title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${list.length}, 1fr)` }}>
        {list.map((p, i) => {
          const m = MEDALS[i] || MEDALS[2];
          const pts = Number(p?.points) || 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderTop: `1px solid ${TK.divider}`, borderLeft: i > 0 ? `1px solid ${TK.divider}` : 'none', minWidth: 0 }}>
              <span style={{ width: 30, height: 30, borderRadius: 99, background: m.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Ico ch={ICON.medal} size={17} color={m.col} stroke={2} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FK.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: TK.textFaint, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{ordinal(i + 1)} {placeWord}</div>
                <div style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, letterSpacing: -0.3, marginTop: 1, whiteSpace: 'nowrap' }}>{pts} pts</div>
                {p?.prize ? <div style={{ fontFamily: FK.body, fontSize: 11.5, color: TK.textMute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.prize}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* small action button (Editar / Eliminar) */
export function MiniAction({ icon, children, danger = false, onClick, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, cursor: disabled ? 'default' : 'pointer',
      fontFamily: FK.body, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', opacity: disabled ? 0.55 : 1,
      background: danger ? 'transparent' : TK.surface2, color: danger ? 'var(--color-danger)' : TK.textSub,
      border: `1px solid ${danger ? 'color-mix(in srgb, var(--color-danger) 26%, transparent)' : TK.borderSolid}`,
    }}>
      <Ico ch={icon} size={15} color={danger ? 'var(--color-danger)' : TK.textSub} stroke={2} />{children}
    </button>
  );
}

/* pill buttons for the header */
export function PrimaryBtn({ children, icon = ICON.plus, onClick, size = 'md', disabled = false, type = 'button' }) {
  const pad = size === 'sm' ? '8px 14px' : '11px 18px';
  const fs = size === 'sm' ? 12.5 : 13.5;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      flexShrink: 0, padding: pad, borderRadius: 999, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FK.body, fontSize: fs, fontWeight: 700, color: '#fff',
      border: 'none', background: TK.accent, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)', opacity: disabled ? 0.6 : 1,
    }}>
      {icon && <Ico ch={icon} size={16} color="#fff" stroke={2.6} />} {children}
    </button>
  );
}

export function GhostBtn({ children, icon, onClick, accentIcon = false }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 17px', borderRadius: 999, cursor: 'pointer',
      background: TK.surface, border: `1px solid ${TK.borderSolid}`, boxShadow: TK.shadow,
      fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.textSub, whiteSpace: 'nowrap',
    }}>
      {icon && <Ico ch={icon} size={16} color={accentIcon ? TK.accent : TK.textSub} stroke={2} />} {children}
    </button>
  );
}
