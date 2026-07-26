// Spectrum client-page primitives — the theme-aware TT version of the Claude
// Design "Client Page - Spectrum Desktop" mockup. Layout/structure taken from the
// mockup (numbered section headers, a responsive 2-column content grid, tinted
// cards, empty states); surfaces come from the existing --tt-* trainer theme
// (works in light + dark). The one thing carried over verbatim from the mockup is
// the PER-TAB ACCENT HUE — each tab paints the page a different color so the coach
// always knows which section they're in.

import { createContext, useContext } from 'react';
import { TT, TFont } from './designTokens';

// Context carrying the active tab's hue down to every Spectrum primitive, so the
// page's section ticks / tinted cards / empty icons all recolor together without
// threading a `hue` prop through 20+ call sites. `null` = no Spectrum context
// (primitives fall back to the neutral TT accent tokens). A `hue` prop still wins
// when passed explicitly.
export const SpectrumHueContext = createContext(null);

// Per-tab accent hues (from the mockup's HUES map). Each tab gets a distinct
// color that recolors the identity card, active tab, section ticks, tinted hero
// cards, empty-state icons and CTAs. `c` (the solid text/icon/underline color) is
// deepened vs the mockup's neon so it stays legible on the LIGHT theme too; the
// `g1`/`soft`/`line` washes stay vivid (they sit at low alpha over the surface, so
// they read on both themes). `ink` = dark ink for text sitting ON a solid-hue CTA.
export const SPECTRUM_HUES = {
  today:     { c: '#12A594', ink: '#05302C', soft: 'rgba(46,211,192,.15)',  line: 'rgba(46,211,192,.34)',  g1: '#2ED3C0', g2: '#12A79A' },
  training:  { c: '#7B6AEF', ink: '#1A1147', soft: 'rgba(154,140,247,.17)', line: 'rgba(154,140,247,.38)', g1: '#A99BFF', g2: '#7A67E8' },
  nutrition: { c: '#7C9A1C', ink: '#26340A', soft: 'rgba(150,200,60,.18)',  line: 'rgba(150,200,60,.40)',  g1: '#B6E24A', g2: '#8FB528' },
  progress:  { c: '#2E9BE0', ink: '#082B44', soft: 'rgba(79,182,240,.16)',  line: 'rgba(79,182,240,.34)',  g1: '#5FC0F5', g2: '#2E93D6' },
  payments:  { c: '#12B06E', ink: '#053021', soft: 'rgba(56,208,126,.16)',  line: 'rgba(56,208,126,.34)',  g1: '#46DC8B', g2: '#22B267' },
};

// Resolve a tab id to its hue (falls back to the Info/teal hue). Accepts the
// canonical MEMBER_TAB_ORDER ids: today | training | nutrition | progress | payments.
export function spectrumHue(tab) {
  return SPECTRUM_HUES[tab] || SPECTRUM_HUES.today;
}

// Responsive 2-col grid: 1 col until 900px, then two equal columns. `.s-span`
// makes a block full-width. Injected once.
if (typeof document !== 'undefined' && !document.getElementById('s-grid-css')) {
  const s = document.createElement('style');
  s.id = 's-grid-css';
  s.textContent = '.s-grid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}@media(min-width:900px){.s-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.s-span{grid-column:1/-1}';
  document.head.appendChild(s);
}

export function SGrid({ children, style }) {
  return <div className="s-grid" style={style}>{children}</div>;
}

// A numbered section (mockup SH + Block): tick + title + hairline rule + optional
// action, then the block's content. `span` makes it fill both grid columns.
// `hue` (a SPECTRUM_HUES entry) colors the tick + action to the active tab's hue.
export function SBlock({ n, title, action, onAction, span, children, style, hue: hueProp }) {
  // Hook must run unconditionally — `hueProp || useContext(...)` short-circuits,
  // so passing a truthy `hue` would render one fewer hook than the previous
  // render and crash with "Rendered more hooks than during the previous render".
  const ctxHue = useContext(SpectrumHueContext);
  const hue = hueProp || ctxHue;
  const tickBg = hue ? hue.soft : TT.accentSoft;
  const tickFg = hue ? hue.c : TT.accentInk;
  const actionFg = hue ? hue.c : TT.accentInk;
  return (
    <div className={span ? 's-span' : undefined} style={{ minWidth: 0, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        {n != null && (
          <span style={{ width: 24, height: 24, borderRadius: 8, background: tickBg, color: tickFg, display: 'grid', placeItems: 'center', fontFamily: TFont.mono, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{n}</span>
        )}
        <span style={{ fontFamily: TFont.display, fontSize: 16, fontWeight: 800, color: TT.text, letterSpacing: -0.3 }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: TT.border }} />
        {action && (
          <button type="button" className="tt-tap" onClick={onAction} style={{ border: 'none', background: 'none', cursor: onAction ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 5, color: actionFg, fontFamily: TFont.display, fontWeight: 800, fontSize: 12.5, flexShrink: 0, padding: 0 }}>{action}</button>
        )}
      </div>
      {children}
    </div>
  );
}

// Card — surface + hairline border, radius 18; `tint` adds a faint accent wash
// (the mockup's hero-card treatment). With `hue`, the wash + border take the
// active tab's color; g1 is a hex hue so the alpha-concat is safe.
export function SCard({ children, pad = 16, tint, span, style, hue: hueProp }) {
  // Unconditional hook — see the note in SBlock.
  const ctxHue = useContext(SpectrumHueContext);
  const hue = hueProp || ctxHue;
  const tintBg = hue ? `${hue.g1}22` : TT.accentSoft;
  const tintLine = hue ? hue.line : `${TT.accent}33`;
  return (
    <div className={span ? 's-span' : undefined} style={{
      background: tint ? `linear-gradient(150deg, ${tintBg}, ${TT.surface} 60%)` : TT.surface,
      borderRadius: 18, border: `1px solid ${tint ? tintLine : TT.border}`,
      boxShadow: TT.shadow, padding: pad, minWidth: 0, ...style,
    }}>{children}</div>
  );
}

// Empty state (mockup Empty) — tinted well + optional lucide icon (pass the
// component, e.g. `icon={Trophy}`). `hue` colors the icon chip to the tab's hue.
export function SEmpty({ icon: Icon, children, h = 92, hue: hueProp }) {
  // Unconditional hook — see the note in SBlock.
  const ctxHue = useContext(SpectrumHueContext);
  const hue = hueProp || ctxHue;
  const wellBg = hue ? hue.soft : TT.accentSoft;
  const iconFg = hue ? hue.c : TT.accent;
  return (
    <div style={{ minHeight: h, background: TT.surface2, borderRadius: 16, border: `1px solid ${TT.border}`, padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center' }}>
      {Icon && <div style={{ width: 42, height: 42, borderRadius: 12, background: wellBg, display: 'grid', placeItems: 'center' }}><Icon size={20} color={iconFg} /></div>}
      <div style={{ fontSize: 13, color: TT.textSub, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}
