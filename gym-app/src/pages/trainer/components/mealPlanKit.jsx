// mealPlanKit.jsx — "Warmth (B)" meal-plan design system (Claude Design handoff-12).
// Friendly warm-cream + teal. Surfaces/text ride the app's theme-aware TT tokens
// (warm cream in light, dark in dark — so these screens adapt to dark mode),
// while the design's vivid ACCENTS stay fixed and soft tints use color-mix so
// they read on BOTH themes. Archivo display · JetBrains Mono numerics.

import { TT, TFont } from './designTokens';

// ── Tokens ────────────────────────────────────────────────────
export const MK = {
  // chrome — theme-aware (already warm-cream in light)
  bg: TT.bg, bgElev: TT.bgElev, surface: TT.surface, surface2: TT.surface2, inset: TT.surface2,
  border: TT.border, line: TT.border, ink: TT.text, ink2: TT.textSub, ink3: TT.textMute,
  shadow: TT.shadow, shadowLg: TT.shadowLg,
  disp: TFont.display, mono: TFont.mono,
  // accents — fixed design hues (legible on light + dark)
  teal: '#17B6AD', tealDark: '#0F9E96',
  hot: '#FF5A2E', coach: '#7A6CF0', amber: '#E79B2E', good: '#2FA968', coral: '#F1604E',
  // macro coding: cal teal · protein blue · carbs green · fat pink
  cal: '#17B6AD', pro: '#5B84E6', carb: '#3AAE66', fat: '#EC6A9C',
};
// theme-adaptive soft tint (over the current surface) + readable ink on it
export const soft = (hex, pct = 15) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
export const inkOf = (hex) => `color-mix(in srgb, ${hex} 74%, ${TT.text})`;
const ringTrack = 'color-mix(in srgb, var(--tt-text) 12%, transparent)';

export const MK_MACROS = [
  { k: 'protein', l: 'Protein', ab: 'P', c: MK.pro },
  { k: 'carbs', l: 'Carbs', ab: 'C', c: MK.carb },
  { k: 'fat', l: 'Fat', ab: 'F', c: MK.fat },
];
export function kcalShare(m) {
  const p = (m.protein || 0) * 4, c = (m.carbs || 0) * 4, f = (m.fat || 0) * 9, tot = p + c + f || 1;
  return { protein: p / tot, carbs: c / tot, fat: f / tot };
}
export function mpShade(hex, pct) {
  const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = pct / 100; r = Math.round(r + (f < 0 ? r : 255 - r) * f); g = Math.round(g + (f < 0 ? g : 255 - g) * f); b = Math.round(b + (f < 0 ? b : 255 - b) * f);
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// ── Calorie ring ──────────────────────────────────────────────
export function MacroRing({ kcal, size = 96, stroke = 10, value = 1, color = MK.cal, label = 'kcal', children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ringTrack} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {children || <>
          <span style={{ fontFamily: MK.disp, fontSize: size * 0.26, fontWeight: 900, color: MK.ink, letterSpacing: -1, lineHeight: 1 }}>{kcal}</span>
          <span style={{ fontFamily: MK.disp, fontSize: size * 0.1, fontWeight: 800, color: MK.ink3, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2 }}>{label}</span>
        </>}
      </div>
    </div>
  );
}

// ── 3 macro cells (P/C/F grams — target readout, no completion %) ─
export function MacroCells({ macros, big }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9 }}>
      {MK_MACROS.map(m => (
        <div key={m.k} style={{ background: soft(m.c, 15), borderRadius: 15, padding: big ? '14px 10px' : '12px 9px', textAlign: 'center' }}>
          <div style={{ fontFamily: MK.disp, fontSize: big ? 24 : 20, fontWeight: 900, color: m.c, letterSpacing: -0.8, lineHeight: 1 }}>{macros[m.k] || 0}<span style={{ fontSize: 12 }}>g</span></div>
          <div style={{ fontFamily: MK.disp, fontSize: 10.5, fontWeight: 800, color: inkOf(m.c), textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{m.l}</div>
        </div>
      ))}
    </div>
  );
}

// ── Inline colored macro readout (cal + P/C/F) ────────────────
export function MacroReadout({ macros, kcal, size = 12, showKcal = true, gap = 9 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap, flexWrap: 'wrap' }}>
      {showKcal && <span style={{ fontFamily: MK.disp, fontSize: size + 0.5, fontWeight: 900, color: MK.cal }}>{kcal || 0}<span style={{ fontSize: size - 3, color: MK.ink3, fontWeight: 800, marginLeft: 1 }}>cal</span></span>}
      {MK_MACROS.map(m => <span key={m.k} style={{ fontFamily: MK.disp, fontSize: size, fontWeight: 800, color: m.c }}>{macros[m.k] || 0}<span style={{ fontSize: size - 3 }}>g</span> <span style={{ color: MK.ink3, fontWeight: 700 }}>{m.ab}</span></span>)}
    </div>
  );
}

// ── Selectable pill ───────────────────────────────────────────
export function MkPill({ children, on, c = MK.teal, onClick, size = 'm', style }) {
  const pad = { s: '6px 12px', m: '9px 15px', l: '11px 18px' }[size];
  const fs = { s: 12, m: 13.5, l: 14.5 }[size];
  return (
    <button type="button" className="tt-press tt-tap" onClick={onClick} style={{
      padding: pad, borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: MK.disp, fontWeight: 800, fontSize: fs, letterSpacing: 0.1, whiteSpace: 'nowrap',
      background: on ? c : soft(c, 13), color: on ? '#fff' : inkOf(c),
      boxShadow: on ? `0 6px 14px -6px ${c}bb, inset 0 1px 0 rgba(255,255,255,.28)` : `inset 0 0 0 1.5px ${MK.border}`,
      ...style,
    }}>{children}</button>
  );
}

// ── Static tag ────────────────────────────────────────────────
export function MkTag({ children, c = MK.teal, dot, size = 'm', style }) {
  const pad = { s: '3px 8px', m: '5px 11px', l: '7px 14px' }[size];
  const fs = { s: 10.5, m: 11.5, l: 13 }[size];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 999, fontFamily: MK.disp, fontWeight: 800, fontSize: fs, letterSpacing: 0.5, textTransform: 'uppercase', background: soft(c, 16), color: inkOf(c), ...style }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: c }} />}{children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────
export function MkBtn({ children, icon, variant = 'primary', accent = MK.teal, block, size = 'm', disabled, onClick, style }) {
  const h = { s: 38, m: 48, l: 54 }[size], fs = { s: 13.5, m: 15.5, l: 16.5 }[size];
  const base = { height: h, borderRadius: 999, border: 'none', cursor: disabled ? 'default' : 'pointer', width: block ? '100%' : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '0 20px', fontFamily: MK.disp, fontWeight: 800, fontSize: fs, letterSpacing: 0.1, whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1 };
  const v = {
    primary: { background: `linear-gradient(180deg, ${mpShade(accent, 6)}, ${mpShade(accent, -12)})`, color: '#fff', boxShadow: `0 10px 22px -10px ${accent}, inset 0 1px 0 rgba(255,255,255,.35)` },
    soft: { background: soft(accent, 15), color: inkOf(accent), boxShadow: 'none' },
    secondary: { background: MK.surface, color: MK.ink, boxShadow: `inset 0 0 0 1.5px ${MK.border}` },
    ghost: { background: 'transparent', color: accent, boxShadow: `inset 0 0 0 1.5px ${accent}55` },
    danger: { background: soft(MK.coral, 15), color: inkOf(MK.coral), boxShadow: 'none' },
    dark: { background: MK.ink, color: 'var(--tt-on-inverse)', boxShadow: MK.shadowLg },
  }[variant];
  return <button type="button" className="tt-press tt-tap" disabled={disabled} onClick={onClick} style={{ ...base, ...v, ...style }}>{icon}{children}</button>;
}

export function MkIconBtn({ children, size = 42, soft: softBg, onClick, r, style }) {
  return <button type="button" className="tt-press tt-tap" onClick={onClick} style={{ width: size, height: size, borderRadius: r || (size >= 40 ? 13 : 10), flexShrink: 0, background: softBg || MK.surface, border: 'none', boxShadow: softBg ? 'none' : `inset 0 0 0 1.5px ${MK.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', ...style }}>{children}</button>;
}

// ── Horizontal chip strip (days) ──────────────────────────────
export function MkChipStrip({ options, value, onChange, accent = MK.teal, dark }) {
  return (
    <div className="scrollbar-hide" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 0' }}>
      {options.map((o, i) => { const v = o.v ?? o, on = v === value;
        return <button key={i} type="button" className="tt-press tt-tap" onClick={() => onChange && onChange(v)} style={{
          flexShrink: 0, padding: '9px 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: MK.disp, fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap',
          background: on ? (dark ? MK.ink : accent) : MK.surface, color: on ? (dark ? 'var(--tt-on-inverse)' : '#fff') : MK.ink2,
          boxShadow: on ? `0 6px 14px -7px ${dark ? 'rgba(0,0,0,.5)' : accent}` : `inset 0 0 0 1.5px ${MK.border}`,
        }}>{o.l ?? o}</button>;
      })}
    </div>
  );
}

// ── Centered week nav (‹ Week X of Y ›) ───────────────────────
export function WeekPicker({ idx, total, onPrev, onNext }) {
  const Arrow = ({ dir, on, act }) => (
    <button type="button" className="tt-press tt-tap" onClick={on ? act : undefined} style={{ width: 42, height: 42, borderRadius: 999, border: 'none', cursor: on ? 'pointer' : 'default', background: MK.surface, boxShadow: on ? MK.shadow : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: on ? 1 : 0.5 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={on ? MK.tealDark : MK.ink3} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{dir < 0 ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}</svg>
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: soft(MK.ink3, 8), borderRadius: 999, padding: 6, boxShadow: `inset 0 0 0 1.5px ${MK.border}` }}>
      <Arrow dir={-1} on={idx > 0} act={onPrev} />
      <div style={{ textAlign: 'center', lineHeight: 1 }}>
        <div style={{ fontFamily: MK.disp, fontSize: 17, fontWeight: 900, color: MK.ink, letterSpacing: -0.4 }}>Week {idx + 1}</div>
        <div style={{ fontFamily: MK.mono, fontSize: 10.5, fontWeight: 700, color: MK.ink3, marginTop: 4, letterSpacing: 0.5 }}>OF {total}</div>
      </div>
      <Arrow dir={1} on={idx < total - 1} act={onNext} />
    </div>
  );
}

// ── Sheet header (title + optional back/close/sub/right) ──────
export function SheetHead({ title, onClose, back, sub, right }) {
  const chev = (d) => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={MK.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '4px 0' }}>
      {back && <MkIconBtn size={38} onClick={back}>{chev()}</MkIconBtn>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MK.disp, fontSize: 24, fontWeight: 900, color: MK.ink, letterSpacing: -0.8, lineHeight: 1.05 }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: MK.ink2, marginTop: 5 }}>{sub}</div>}
      </div>
      {right}
      {onClose && <MkIconBtn size={38} onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MK.ink2} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg></MkIconBtn>}
    </div>
  );
}

// ── Section head (icon tile + title + optional action) ────────
export function SectionHead({ icon, tint = MK.teal, children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '0 0 14px' }}>
      <div style={{ width: 32, height: 32, borderRadius: 11, background: soft(tint, 16), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tint }}>{icon}</div>
      <div style={{ flex: 1, fontFamily: MK.disp, fontSize: 17, fontWeight: 900, color: MK.ink, letterSpacing: -0.5 }}>{children}</div>
      {action && <button type="button" className="tt-tap" onClick={onAction} style={{ border: 'none', background: soft(MK.teal, 14), borderRadius: 999, padding: '6px 13px', cursor: 'pointer', color: inkOf(MK.teal), fontFamily: MK.disp, fontWeight: 800, fontSize: 12.5 }}>{action}</button>}
    </div>
  );
}

export function Card({ children, pad = 18, style }) {
  return <div style={{ background: MK.surface, borderRadius: 22, boxShadow: MK.shadow, padding: pad, ...style }}>{children}</div>;
}

// ── Food image tile (real image, else tinted placeholder) ─────
export function FoodTile({ src, label, size = 60, r = 15, tint = MK.amber, style }) {
  if (src) return <img src={src} alt={label || ''} loading="lazy" style={{ width: size, height: size, borderRadius: r, flexShrink: 0, objectFit: 'cover', background: MK.surface2, boxShadow: `inset 0 0 0 1px ${MK.line}`, ...style }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: r, flexShrink: 0, position: 'relative', overflow: 'hidden', background: `repeating-linear-gradient(135deg, ${soft(tint, 16)} 0 8px, ${soft(tint, 8)} 8px 16px)`, boxShadow: `inset 0 0 0 1px ${MK.line}`, display: 'flex', alignItems: 'flex-end', ...style }}>
      {label && <span style={{ fontFamily: MK.mono, fontSize: 7.5, fontWeight: 700, color: inkOf(tint), padding: '3px 4px', lineHeight: 1.15, letterSpacing: -0.2 }}>{label}</span>}
    </div>
  );
}

export function Sec({ children, style }) { return <div style={{ marginTop: 26, ...style }}>{children}</div>; }
export function Note({ children }) { return <div style={{ fontSize: 12, color: MK.ink3, marginTop: 10, lineHeight: 1.45 }}>{children}</div>; }
