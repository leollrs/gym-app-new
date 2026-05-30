/* eslint-disable react-refresh/only-export-components */
/**
 * Native React port of the 14 designer email layouts from the Email System
 * handoff bundle. Renders the full editorial design exactly as in the proto —
 * no HTML injection, no iframe — so the in-app preview matches what gets
 * delivered. Bilingual (es/en), accepts gym branding (logo, name, coach), and
 * uses an adaptive palette derived from the gym's brand colors.
 *
 * Each design accepts: { lang, name, gymName, logoUrl, coachName, vars, E }.
 * Render any of them through the registry at the bottom or use the dispatcher
 * <DesignerEmail id="welcome-editorial" {...ctx} />.
 *
 * NOTE: this is the in-app preview. The sendable HTML still comes from
 * `emailDesignerTemplates.js` (string-based renderer) — same layout, two
 * surfaces.
 */

// ── Default editorial palette + fonts ──────────────────────────────
const BASE_E = {
  cream: '#f0eee9', creamElev: '#faf8f3', paper: '#ffffff',
  ink: '#0B0F12', ink2: '#1f2630', sub: '#5A6570', mute: '#96A0AA',
  faint: '#cdd3da', line: '#e8e4db',
  lineSoft: 'rgba(15,20,25,0.07)', lineStrong: 'rgba(15,20,25,0.16)',
  teal: '#19B8B8', tealDk: '#0F9E9E', tealSoft: '#D9F1F1', tealInk: '#08585A',
  hot: '#FF5A2E', hotDk: '#E64614', hotSoft: '#FFE3D6', hotInk: '#7A2A0F',
  gold: '#E8C547', goldSoft: '#F9F0CC', goldInk: '#5C4710',
  coach: '#6D5FDB', good: '#2FA66B', dark: '#0E1316', dark2: '#161C20',
};

const F = {
  display: '"Archivo", system-ui, sans-serif',
  serif: '"Newsreader", "Times New Roman", serif',
  body: '"Archivo", -apple-system, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

// ── Color util — adapts the accent families from a gym brand pair ─
const _clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const t = (v) => _clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + t(r) + t(g) + t(b);
}
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t }); }
const darken = (h, a) => mix(h, '#000000', a);
function hexToHsl(hex) { let { r, g, b } = hexToRgb(hex); r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2; if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; } h /= 6; } return { h: h * 360, s, l }; }
function hslToHex({ h, s, l }) { h = (h % 360) / 360; let r, g, b; if (s === 0) { r = g = b = l; } else { const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }; const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); } return rgbToHex({ r: r * 255, g: g * 255, b: b * 255 }); }
function bgVariant(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.5); c.s = Math.max(c.s, 0.55); return hslToHex(c); }
function softVariant(hex) { return mix(hex, '#fbfaf6', 0.84); }
function inkVariant(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.26); c.s = _clamp(c.s, 0.3, 0.85); return hslToHex(c); }
function visibleAccent(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.66); return hslToHex(c); }

export function buildPalette(primary, secondary) {
  if (!primary) return BASE_E;
  const s = secondary || BASE_E.hot;
  const teal = visibleAccent(primary);
  const hot = bgVariant(s);
  return {
    ...BASE_E,
    teal, tealDk: darken(teal, 0.16), tealSoft: softVariant(primary), tealInk: inkVariant(primary),
    hot, hotDk: darken(hot, 0.14), hotSoft: softVariant(s), hotInk: inkVariant(s),
  };
}

// ── Translation helper ────────────────────────────────────────────
const tx = (lang, es, en) => (lang === 'es' ? es : en);

// ── Icon SVG paths ────────────────────────────────────────────────
const EI = {
  flame: <path d="M8.5 14.5A4.5 4.5 0 0 0 12 22a5 5 0 0 0 5-5c0-1.14-.76-2.35-1.76-3.32M12 13a2 2 0 1 1-4 0c0-1 1-2 2-4 1-2 4-3 5-6 0 3 2 4 2 7 0 2-1 3-2 4" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  arrow: <><path d="M5 12h14" /><path d="m13 5 7 7-7 7" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  trophy: <><path d="M6 9H4a2 2 0 0 1-2-2V5h4M18 9h2a2 2 0 0 0 2-2V5h-4M6 3h12v6a6 6 0 0 1-12 0V3z" /><path d="M8 21h8M12 17v4" /></>,
  cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>,
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
};

function EIco({ children, size = 16, stroke = 1.8, color = 'currentColor', fill = 'none', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}

// ── Shared brand pieces ───────────────────────────────────────────
function ELogo({ size = 36, dark = true, gymName = 'Gym', logoUrl = '', E = BASE_E }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={gymName} style={{ height: size, width: 'auto', maxWidth: size * 3, display: 'block', borderRadius: size * 0.18 }} />;
  }
  const initial = (gymName || 'G').trim().charAt(0).toUpperCase() || 'G';
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.22,
      background: dark ? 'radial-gradient(circle at 35% 30%, #2a2d32 0%, #0a0c0f 100%)' : E.paper,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
      border: dark ? '1px solid #1a1d22' : `1px solid ${E.line}`,
      flexShrink: 0,
    }}>
      <div style={{
        width: size * 0.6, height: size * 0.6, borderRadius: '50%',
        border: `${Math.max(1.5, size * 0.07)}px solid ${E.gold}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: E.gold, fontFamily: F.display, fontWeight: 900,
        fontSize: size * 0.34, letterSpacing: -0.5, lineHeight: 1,
      }}>{initial}</div>
    </div>
  );
}

function EWordmark({ size = 14, color, weight = 800, gymName = 'Gym', E = BASE_E }) {
  return <span style={{ fontFamily: F.display, fontSize: size, fontWeight: weight, letterSpacing: -0.4, color: color || E.ink, lineHeight: 1 }}>{gymName}</span>;
}

function EBtn({ children, tone = 'teal', size = 'lg', wide, icon, E = BASE_E }) {
  const tones = {
    teal: { bg: E.teal, fg: E.ink, bd: E.teal },
    tealDk: { bg: E.tealInk, fg: '#fff', bd: E.tealInk },
    dark: { bg: E.ink, fg: E.cream, bd: E.ink },
    hot: { bg: E.hot, fg: '#fff', bd: E.hot },
    cream: { bg: E.cream, fg: E.ink, bd: E.line },
    paper: { bg: E.paper, fg: E.ink, bd: E.line },
    gold: { bg: E.gold, fg: E.goldInk, bd: E.gold },
    ghost: { bg: 'transparent', fg: E.ink, bd: E.lineStrong },
    ghostInv: { bg: 'transparent', fg: '#fff', bd: 'rgba(255,255,255,0.3)' },
  };
  const c = tones[tone] || tones.teal;
  const sizes = { sm: { padding: '10px 18px', fontSize: 13 }, md: { padding: '13px 22px', fontSize: 14 }, lg: { padding: '16px 28px', fontSize: 15 } };
  return (
    <a style={{
      display: wide ? 'flex' : 'inline-flex', alignItems: 'center', justifyContent: 'center',
      gap: 10, cursor: 'pointer', borderRadius: 999, background: c.bg, color: c.fg, border: `1.5px solid ${c.bd}`,
      fontFamily: F.display, fontWeight: 700, letterSpacing: -0.2, textDecoration: 'none',
      width: wide ? '100%' : undefined, ...sizes[size],
    }}>
      <span>{children}</span>
      {icon && <EIco size={16} stroke={2.4}>{icon}</EIco>}
    </a>
  );
}

function EPill({ children, tone = 'neutral', style = {}, E = BASE_E }) {
  const tones = {
    neutral: { bg: 'rgba(15,20,25,0.06)', fg: E.sub },
    teal: { bg: E.tealSoft, fg: E.tealInk },
    hot: { bg: E.hotSoft, fg: E.hot },
    gold: { bg: E.goldSoft, fg: E.goldInk },
    dark: { bg: E.ink, fg: '#fff' },
    invert: { bg: 'rgba(255,255,255,0.12)', fg: '#fff' },
    outline: { bg: 'transparent', fg: E.sub },
  };
  const c = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
      background: c.bg, color: c.fg, fontFamily: F.display, fontWeight: 700, fontSize: 10.5,
      letterSpacing: 0.8, textTransform: 'uppercase',
      ...(c.bg === 'transparent' ? { border: `1px solid ${E.line}` } : {}),
      ...style,
    }}>{children}</span>
  );
}

function EPhoto({ w = '100%', h = 220, label, tone = 'warm', radius = 0 }) {
  const tones = { warm: ['#e8d9c2', '#d3bda1'], cool: ['#cfd9d6', '#a8b8b3'], night: ['#262d34', '#0f1418'], teal: ['#bde6e2', '#8acac4'] };
  const [a, b] = tones[tone] || tones.warm;
  const dark = tone === 'night';
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: `repeating-linear-gradient(135deg, ${a} 0 14px, ${b} 14px 28px)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden',
      color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(15,20,25,0.55)',
    }}>
      <div style={{
        fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
        padding: '5px 10px', borderRadius: 4, background: dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)',
      }}>{label || 'photo placeholder'}</div>
    </div>
  );
}

function EFooter({ tone = 'cream', lang = 'es', gymName = 'Gym', logoUrl = '', E = BASE_E }) {
  const isDark = tone === 'dark';
  const bg = isDark ? E.dark : tone === 'cream' ? E.cream : E.paper;
  const txt = isDark ? 'rgba(245,242,236,0.5)' : E.mute;
  const link = isDark ? 'rgba(245,242,236,0.75)' : E.sub;
  const links = lang === 'es' ? ['Cancelar suscripción', 'Preferencias', 'Política'] : ['Unsubscribe', 'Preferences', 'Policy'];
  return (
    <div style={{
      background: bg, padding: '24px 36px 32px',
      borderTop: isDark ? '1px solid rgba(255,255,255,0.06)' : `1px solid ${E.line}`,
      fontFamily: F.body, fontSize: 11.5, color: txt, lineHeight: 1.6, textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
        <ELogo size={18} gymName={gymName} logoUrl={logoUrl} E={E} />
        <EWordmark size={12} color={isDark ? 'rgba(245,242,236,0.7)' : E.sub} weight={700} gymName={gymName} E={E} />
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
        {links.map((l, i) => <a key={i} style={{ color: link, textDecoration: 'underline', textUnderlineOffset: 2 }}>{l}</a>)}
      </div>
      <div style={{ marginTop: 14, fontSize: 10, letterSpacing: 0.5, opacity: 0.7 }}>
        © {new Date().getFullYear()} {gymName}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  WELCOME
// ═══════════════════════════════════════════════════════════════════

function EmailWelcomeEditorial({ lang = 'es', name, gymName, logoUrl, coachName, E = BASE_E }) {
  const rows = lang === 'es'
    ? [
        { n: '01', t: 'Tu plan de la semana', d: '4 sesiones armadas alrededor de tu disponibilidad.' },
        { n: '02', t: 'Tu entrenador asignado', d: `${coachName} te escribe mañana a las 9am.` },
        { n: '03', t: 'Acceso al gym', d: 'Tu QR ya está activo. Camina y entra.' },
      ]
    : [
        { n: '01', t: 'Your plan for the week', d: '4 sessions built around your availability.' },
        { n: '02', t: 'Your assigned coach', d: `${coachName} will message you tomorrow at 9am.` },
        { n: '03', t: 'Gym access', d: 'Your QR is already active. Just walk in.' },
      ];
  return (
    <div style={{ width: '100%', background: E.cream, fontFamily: F.body, color: E.ink }}>
      <div style={{ padding: '28px 36px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${E.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ELogo size={32} gymName={gymName} logoUrl={logoUrl} E={E} />
          <EWordmark size={15} gymName={gymName} E={E} />
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {tx(lang, 'Vol. 01 · Núm. 01', 'Vol. 01 · No. 01')}
        </div>
      </div>
      <div style={{ padding: '40px 36px 24px' }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 18 }}>
          {tx(lang, '— Bienvenida', '— Welcome')}
        </div>
        <h1 style={{ fontFamily: F.serif, fontSize: 56, fontWeight: 400, color: E.ink, lineHeight: 0.98, letterSpacing: -1.5, margin: 0 }}>
          {tx(lang, <>Empezamos.<br /><em style={{ fontStyle: 'italic', color: E.tealInk }}>Esto es tuyo.</em></>,
                     <>We start now.<br /><em style={{ fontStyle: 'italic', color: E.tealInk }}>This is yours.</em></>)}
        </h1>
        <p style={{ marginTop: 22, fontSize: 16, lineHeight: 1.55, color: E.ink2, maxWidth: 480 }}>
          {tx(lang,
            `${name}, gracias por unirte. En ${gymName} no hay programas genéricos. Cada semana se ajusta a cómo te sentiste la anterior — eso ya lo tienes activado.`,
            `${name}, thanks for joining. At ${gymName} there are no generic programs. Every week adapts to how the last one felt — that's already turned on for you.`)}
        </p>
      </div>
      <div style={{ padding: '0 36px' }}>
        <EPhoto h={240} label={tx(lang, 'gym · hora dorada', 'gym · golden hour')} tone="warm" radius={4} />
      </div>
      <div style={{ padding: '32px 36px 12px' }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, paddingBottom: 12, borderBottom: `1px solid ${E.line}` }}>
          {tx(lang, 'Lo que ya está listo', 'What’s already set up')}
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 18, padding: '18px 0', borderBottom: i < 2 ? `1px solid ${E.line}` : 'none' }}>
            <div style={{ fontFamily: F.serif, fontSize: 22, color: E.hot, fontWeight: 400, fontStyle: 'italic', minWidth: 32 }}>{r.n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 700, color: E.ink, marginBottom: 4 }}>{r.t}</div>
              <div style={{ fontSize: 13.5, color: E.sub, lineHeight: 1.5 }}>{r.d}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '32px 36px 44px', textAlign: 'center' }}>
        <EBtn tone="dark" size="lg" wide icon={EI.arrow} E={E}>{tx(lang, 'Abrir mi plan', 'Open my plan')}</EBtn>
        <div style={{ marginTop: 14, fontSize: 12, color: E.mute }}>
          {tx(lang, `o responde este correo — ${coachName} lo lee todo`, `or reply to this email — ${coachName} reads them all`)}
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailWelcomePoster({ lang = 'es', name, gymName, logoUrl, coachName, E = BASE_E }) {
  const days = lang === 'es'
    ? [['LUN', 'Empuje + Core', '45 min'], ['MIÉ', 'Tracción + Cardio Z2', '50 min'], ['VIE', 'Piernas (suave)', '40 min'], ['SÁB', 'Movilidad + Clase', '60 min']]
    : [['MON', 'Push + Core', '45 min'], ['WED', 'Pull + Cardio Z2', '50 min'], ['FRI', 'Legs (easy)', '40 min'], ['SAT', 'Mobility + Class', '60 min']];
  const stats = lang === 'es' ? [['47,284', 'Miembros'], ['12', 'Sedes'], ['24/7', 'Acceso']] : [['47,284', 'Members'], ['12', 'Locations'], ['24/7', 'Access']];
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ background: E.hot, padding: '40px 32px 44px', color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <ELogo size={36} gymName={gymName} logoUrl={logoUrl} E={E} />
          <EPill tone="invert" E={E}>{tx(lang, 'Miembro #47,284', 'Member #47,284')}</EPill>
        </div>
        <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.85, marginBottom: 14 }}>
          {tx(lang, `BIENVENIDO, ${(name || '').toUpperCase()}`, `WELCOME, ${(name || '').toUpperCase()}`)}
        </div>
        <h1 style={{ fontFamily: F.display, fontSize: 76, fontWeight: 900, color: '#fff', lineHeight: 0.9, letterSpacing: -3.5, margin: 0, textTransform: 'uppercase' }}>
          {tx(lang, <>Fuerza<br />local.</>, <>Stronger<br />together.</>)}
        </h1>
        <div style={{ marginTop: 28, paddingTop: 22, borderTop: '1px solid rgba(255,255,255,0.25)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {stats.map((s, i) => (
            <div key={i}>
              <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 900, letterSpacing: -1, lineHeight: 1 }}>{s[0]}</div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.85, marginTop: 4 }}>{s[1]}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '32px 32px 28px' }}>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: E.ink, margin: 0 }}>
          {tx(lang, <>No te enviamos planes copiados de internet. Tu entrenador <strong>{coachName}</strong> revisó tu cuestionario anoche y armó esto:</>,
                     <>We don’t send plans copied off the internet. Your coach <strong>{coachName}</strong> reviewed your intake last night and built this:</>)}
        </p>
        <div style={{ marginTop: 22, border: `2px solid ${E.ink}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ background: E.ink, color: E.gold, padding: '10px 16px', fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 }}>
            {tx(lang, 'Plan de arranque · 14 días', 'Starter plan · 14 days')}
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {days.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 10, borderBottom: i < 3 ? `1px dashed ${E.line}` : 'none' }}>
                <div style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 700, color: E.hot, width: 32, letterSpacing: 0.5 }}>{r[0]}</div>
                <div style={{ flex: 1, fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink }}>{r[1]}</div>
                <div style={{ fontFamily: F.mono, fontSize: 11, color: E.sub }}>{r[2]}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <EBtn tone="dark" wide icon={EI.arrow} E={E}>{tx(lang, 'Ver mi plan completo', 'See my full plan')}</EBtn>
          <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, `Saludar a ${coachName}`, `Say hi to ${coachName}`)}</EBtn>
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  WEEKLY RECAP
// ═══════════════════════════════════════════════════════════════════

function EmailRecapMagazine({ lang = 'es', name, gymName, logoUrl, coachName, v, E = BASE_E }) {
  const days = [3, 4, 2, 5, 0, 3, 4];
  const labels = lang === 'es' ? ['L', 'M', 'M', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const stats = lang === 'es'
    ? [{ k: '4', l: 'Sesiones', d: '+1 vs semana pasada' }, { k: v.streak_count, l: 'Días de racha', d: 'mejor del mes' }, { k: '12,4k', l: 'Pasos / día', d: 'promedio' }, { k: '+5kg', l: 'En sentadilla', d: 'PR nuevo' }]
    : [{ k: '4', l: 'Sessions', d: '+1 vs last week' }, { k: v.streak_count, l: 'Streak days', d: 'best this month' }, { k: '12.4k', l: 'Steps / day', d: 'average' }, { k: '+5kg', l: 'On squat', d: 'new PR' }];
  return (
    <div style={{ width: '100%', background: E.cream, fontFamily: F.body, color: E.ink }}>
      <div style={{ background: E.ink, color: E.cream, padding: '10px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>
        <span>{tx(lang, 'Tu Semana', 'Your Week')}</span>
        <span style={{ color: E.gold }}>{tx(lang, 'Edición 47', 'Issue 47')}</span>
        <span>{tx(lang, 'Mayo 19–25, 2026', 'May 19–25, 2026')}</span>
      </div>
      <div style={{ padding: '32px 32px 24px', borderBottom: `1px solid ${E.line}` }}>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 16 }}>
          {tx(lang, `— Resumen semanal · ${name}`, `— Weekly recap · ${name}`)}
        </div>
        <h1 style={{ fontFamily: F.serif, fontSize: 96, fontWeight: 400, color: E.ink, lineHeight: 0.88, letterSpacing: -4, margin: 0 }}>
          <span style={{ color: E.hot }}>6</span>
          <span style={{ fontFamily: F.serif, fontStyle: 'italic', fontWeight: 300, color: E.sub }}>/7</span>
        </h1>
        <div style={{ marginTop: 8, fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink2, fontWeight: 300, letterSpacing: -0.5 }}>
          {tx(lang, 'días que apareciste.', 'days you showed up.')}
        </div>
      </div>
      <div style={{ padding: '28px 32px 28px', borderBottom: `1px solid ${E.line}` }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 }}>
          {tx(lang, 'Tu semana en columnas', 'Your week in columns')}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
          {days.map((d, i) => {
            const isRest = d === 0;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', height: isRest ? 6 : 16 + d * 14, background: isRest ? E.line : (i === 3 ? E.hot : E.teal), borderRadius: 3 }} />
                <div style={{ fontFamily: F.mono, fontSize: 11, color: E.sub, fontWeight: 600 }}>{labels[i]}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {stats.map((s, i) => (
          <div key={i} style={{ padding: '24px 32px', borderRight: i % 2 === 0 ? `1px solid ${E.line}` : 'none', borderBottom: i < 2 ? `1px solid ${E.line}` : 'none' }}>
            <div style={{ fontFamily: F.display, fontSize: 42, fontWeight: 900, color: E.ink, letterSpacing: -2, lineHeight: 1 }}>{s.k}</div>
            <div style={{ marginTop: 6, fontFamily: F.display, fontSize: 12, fontWeight: 700, color: E.ink, textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.l}</div>
            <div style={{ marginTop: 2, fontSize: 11.5, color: E.sub }}>{s.d}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '36px 32px 32px', borderTop: `1px solid ${E.line}` }}>
        <div style={{ fontFamily: F.serif, fontSize: 60, color: E.hot, lineHeight: 0, marginBottom: -6, fontStyle: 'italic' }}>"</div>
        <div style={{ fontFamily: F.serif, fontSize: 24, fontWeight: 300, color: E.ink, lineHeight: 1.3, letterSpacing: -0.5, fontStyle: 'italic' }}>
          {tx(lang, 'La consistencia se compone. Cada sesión que registras está construyendo algo.', 'Consistency compounds. Every session you log is building something.')}
        </div>
        <div style={{ marginTop: 16, fontFamily: F.mono, fontSize: 10.5, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {tx(lang, `— ${coachName}, tu entrenador`, `— ${coachName}, your coach`)}
        </div>
      </div>
      <div style={{ padding: '8px 32px 40px' }}>
        <EBtn tone="dark" wide icon={EI.arrow} E={E}>{tx(lang, 'Ver semana completa', 'See full week')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailRecapReceipt({ lang = 'es', name, gymName, logoUrl, coachName, v, E = BASE_E }) {
  const rows = lang === 'es'
    ? [['LUN 19', 'Empuje superior', '47 min', '4 ejer.', '+'], ['MAR 20', '— descanso —', '', '', ''], ['MIÉ 21', 'Tracción + core', '52 min', '5 ejer.', '+'], ['JUE 22', 'Piernas · PR', '63 min', '6 ejer.', '★'], ['VIE 23', '— descanso —', '', '', ''], ['SÁB 24', 'Movilidad', '28 min', '8 ejer.', '+'], ['DOM 25', 'Cardio Z2', '42 min', '1 ejer.', '+']]
    : [['MON 19', 'Upper push', '47 min', '4 exc.', '+'], ['TUE 20', '— rest —', '', '', ''], ['WED 21', 'Pull + core', '52 min', '5 exc.', '+'], ['THU 22', 'Legs · PR', '63 min', '6 exc.', '★'], ['FRI 23', '— rest —', '', '', ''], ['SAT 24', 'Mobility', '28 min', '8 exc.', '+'], ['SUN 25', 'Cardio Z2', '42 min', '1 exc.', '+']];
  const totals = lang === 'es'
    ? [['Sesiones', '4'], ['Tiempo total', '3h 12m'], ['Volumen total', '24 ejercicios'], ['PR nuevos', '1 · sentadilla +5kg'], ['Racha', `${v.streak_count} días ✓`]]
    : [['Sessions', '4'], ['Total time', '3h 12m'], ['Total volume', '24 exercises'], ['New PRs', '1 · squat +5kg'], ['Streak', `${v.streak_count} days ✓`]];
  const restWord = lang === 'es' ? 'descanso' : 'rest';
  return (
    <div style={{ width: '100%', background: E.paper, padding: '40px 36px 36px', fontFamily: F.mono, color: E.ink }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 11, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase' }}>{gymName} · Log</div>
          <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 900, letterSpacing: -1, marginTop: 6 }}>{tx(lang, 'Semana 21', 'Week 21')}</div>
          <div style={{ fontSize: 11, color: E.sub, marginTop: 4 }}>{tx(lang, '19 mayo — 25 mayo · 2026', 'May 19 — May 25 · 2026')}</div>
        </div>
        <ELogo size={36} gymName={gymName} logoUrl={logoUrl} E={E} />
      </div>
      <div style={{ borderTop: `1px dashed ${E.lineStrong}`, marginBottom: 4 }} />
      <div style={{ borderTop: `1px dashed ${E.lineStrong}`, marginBottom: 16, paddingTop: 4 }} />
      <div style={{ fontSize: 12, color: E.ink, marginBottom: 16 }}>
        <span style={{ color: E.sub }}>{tx(lang, 'Cliente: ', 'Client: ')}</span>{(name || '').toUpperCase()}<br />
        <span style={{ color: E.sub }}>ID: </span>TGP-047284<br />
        <span style={{ color: E.sub }}>Coach: </span>{(coachName || '').toUpperCase()}
      </div>
      <div style={{ borderTop: `1px solid ${E.ink}`, borderBottom: `1px solid ${E.ink}`, padding: '12px 0', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px 60px 20px', fontSize: 10, color: E.sub, letterSpacing: 1, textTransform: 'uppercase', paddingBottom: 8, fontWeight: 700 }}>
          <div>{tx(lang, 'Día', 'Day')}</div><div>{tx(lang, 'Sesión', 'Session')}</div><div style={{ textAlign: 'right' }}>{tx(lang, 'Tiempo', 'Time')}</div><div style={{ textAlign: 'right' }}>Vol</div><div />
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px 60px 20px', padding: '8px 0', fontSize: 12, color: r[1].includes(restWord) ? E.mute : E.ink, borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }}>
            <div style={{ fontWeight: 700 }}>{r[0]}</div>
            <div>{r[1]}</div>
            <div style={{ textAlign: 'right' }}>{r[2]}</div>
            <div style={{ textAlign: 'right' }}>{r[3]}</div>
            <div style={{ textAlign: 'center', color: r[4] === '★' ? E.hot : E.teal, fontWeight: 700 }}>{r[4]}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12 }}>
        {totals.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < 4 ? `1px dotted ${E.line}` : 'none' }}>
            <span style={{ color: E.sub }}>{r[0]}</span>
            <span style={{ fontWeight: 700 }}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 28, padding: '24px 0', borderTop: `1px solid ${E.ink}`, borderBottom: `1px solid ${E.ink}`, textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: E.sub, letterSpacing: 2, textTransform: 'uppercase' }}>{tx(lang, 'Sesiones · YTD', 'Sessions · YTD')}</div>
        <div style={{ fontFamily: F.display, fontSize: 72, fontWeight: 900, color: E.ink, letterSpacing: -3, lineHeight: 1, marginTop: 4 }}>{v.workout_count}</div>
        <div style={{ fontSize: 11, color: E.hot, marginTop: 6, fontWeight: 700 }}>↑ 23% vs 2025</div>
      </div>
      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center' }}>
        <div style={{ transform: 'rotate(-6deg)', border: `2.5px solid ${E.hot}`, color: E.hot, padding: '8px 18px', borderRadius: 4, fontFamily: F.display, fontWeight: 900, fontSize: 18, letterSpacing: 1, textTransform: 'uppercase' }}>
          {tx(lang, 'Buena semana ✓', 'Good week ✓')}
        </div>
      </div>
      <div style={{ marginTop: 32 }}>
        <EBtn tone="ghost" wide size="md" icon={EI.arrow} E={E}>{tx(lang, 'Ver log completo', 'See full log')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailRecapDark({ lang = 'es', name, gymName, logoUrl, coachName, v, E = BASE_E }) {
  const metrics = lang === 'es'
    ? [{ k: '6/7', l: 'días activos', c: E.teal }, { k: '+5kg', l: 'PR sentadilla', c: E.gold }, { k: v.streak_count, l: 'días racha', c: E.hot }]
    : [{ k: '6/7', l: 'active days', c: E.teal }, { k: '+5kg', l: 'squat PR', c: E.gold }, { k: v.streak_count, l: 'streak days', c: E.hot }];
  const highlights = lang === 'es'
    ? [{ ico: EI.trophy, c: E.hot, t: 'Nuevo PR — Sentadilla', d: 'Jueves · 95kg × 5 reps · +5kg desde abril' }, { ico: EI.flame, c: E.gold, t: `${v.streak_count} días seguidos`, d: 'Tu mejor racha de 2026.' }, { ico: EI.heart, c: E.teal, t: 'Frecuencia cardíaca', d: 'Promedio en reposo: 58 bpm (↓3)' }]
    : [{ ico: EI.trophy, c: E.hot, t: 'New PR — Squat', d: 'Thursday · 95kg × 5 reps · +5kg since April' }, { ico: EI.flame, c: E.gold, t: `${v.streak_count} days in a row`, d: 'Your best streak of 2026.' }, { ico: EI.heart, c: E.teal, t: 'Heart rate', d: 'Resting average: 58 bpm (↓3)' }];
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ background: E.dark, color: E.cream, padding: '36px 32px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <ELogo size={32} gymName={gymName} logoUrl={logoUrl} E={E} />
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: 'rgba(245,242,236,0.5)' }}>
            {tx(lang, '19—25 MAY · 2026', 'MAY 19—25 · 2026')}
          </div>
        </div>
        <div style={{ fontFamily: F.display, fontSize: 11, color: E.teal, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>{tx(lang, 'Tu semana', 'Your week')}</div>
        <h1 style={{ fontFamily: F.display, fontSize: 64, fontWeight: 900, color: E.cream, lineHeight: 0.95, letterSpacing: -2.5, margin: 0 }}>
          {tx(lang, <>Buena<br /><span style={{ color: E.teal }}>semana,</span> {name}.</>, <>Good<br /><span style={{ color: E.teal }}>week,</span> {name}.</>)}
        </h1>
        <div style={{ marginTop: 32, padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {metrics.map((s, i) => (
            <div key={i} style={{ borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingLeft: i > 0 ? 12 : 0 }}>
              <div style={{ fontFamily: F.display, fontSize: 28, fontWeight: 900, color: s.c, letterSpacing: -1, lineHeight: 1 }}>{s.k}</div>
              <div style={{ fontSize: 10.5, color: 'rgba(245,242,236,0.65)', marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '32px 32px 36px' }}>
        <div style={{ fontFamily: F.display, fontSize: 11, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 16 }}>{tx(lang, 'Lo destacado', 'Highlights')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: E.creamElev, borderRadius: 12, border: `1px solid ${E.line}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: h.c, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                <EIco size={18} color="#fff" stroke={2.2}>{h.ico}</EIco>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink }}>{h.t}</div>
                <div style={{ fontSize: 12, color: E.sub, marginTop: 2 }}>{h.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 20, borderRadius: 12, background: E.tealSoft, marginBottom: 24 }}>
          <div style={{ fontFamily: F.display, fontSize: 11, color: E.tealInk, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>{tx(lang, 'Esta semana', 'This week')}</div>
          <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 800, color: E.ink, letterSpacing: -0.5 }}>
            {tx(lang, 'Bajamos volumen en piernas. Subimos empuje.', 'Lower leg volume. More push.')}
          </div>
          <div style={{ fontSize: 13, color: E.tealInk, marginTop: 4, lineHeight: 1.5 }}>
            {tx(lang, `${coachName} ajustó el plan basado en cómo te recuperaste.`, `${coachName} adjusted the plan based on how you recovered.`)}
          </div>
        </div>
        <EBtn tone="dark" wide icon={EI.arrow} E={E}>{tx(lang, 'Ver dashboard', 'Open dashboard')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  WINBACK
// ═══════════════════════════════════════════════════════════════════

function EmailWinbackQuiet({ lang = 'es', gymName, logoUrl, coachName, v, E = BASE_E }) {
  return (
    <div style={{ width: '100%', background: E.cream, padding: '60px 36px 32px', fontFamily: F.body, color: E.ink }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 48 }}>
        <ELogo size={36} gymName={gymName} logoUrl={logoUrl} E={E} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.serif, fontSize: 140, fontWeight: 300, color: E.hot, lineHeight: 0.85, letterSpacing: -7, fontStyle: 'italic' }}>{v.days_inactive}</div>
        <div style={{ marginTop: 4, fontFamily: F.mono, fontSize: 11, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700 }}>
          {tx(lang, 'Días sin vernos', 'Days since we saw you')}
        </div>
      </div>
      <div style={{ height: 1, background: E.line, margin: '40px auto', width: 60 }} />
      <h1 style={{ fontFamily: F.serif, fontSize: 38, fontWeight: 400, color: E.ink, lineHeight: 1.05, letterSpacing: -1, margin: 0, textAlign: 'center' }}>
        {tx(lang, '¿Todo bien?', 'Everything okay?')}
      </h1>
      <p style={{ marginTop: 24, fontSize: 15.5, lineHeight: 1.65, color: E.ink2, textAlign: 'center', maxWidth: 380, margin: '24px auto 0' }}>
        {tx(lang, 'No es para meterte presión. A veces la vida se mete, y lo entendemos. Solo queríamos saber si quieres que ajustemos algo — el horario, el plan, la entrenadora.',
                  'No pressure at all. Life gets in the way sometimes, and we get it. We just wanted to know if you’d like us to adjust something — the schedule, the plan, the coach.')}
      </p>
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EBtn tone="dark" wide icon={EI.arrow} E={E}>{tx(lang, 'Volver despacio', 'Ease back in')}</EBtn>
        <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, 'Pausar mi membresía', 'Pause my membership')}</EBtn>
      </div>
      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <div style={{ fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink, fontWeight: 400 }}>— {coachName}</div>
        <div style={{ marginTop: 4, fontSize: 11.5, color: E.sub, letterSpacing: 0.4 }}>
          {tx(lang, 'Tu entrenador · responde este correo cuando puedas', 'Your coach · reply when you can')}
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailWinbackData({ lang = 'es', gymName, logoUrl, coachName, v, E = BASE_E }) {
  const rows = lang === 'es'
    ? [{ n: '08', m: 'sesiones', d: 'perdidas según tu plan personalizado', tone: E.hot }, { n: '12', m: 'días', d: `rompió tu racha de ${v.streak_count} (la más larga del año)`, tone: E.ink }, { n: '6', m: 'PR nuevos', d: 'reportados por tus compañeros del gym', tone: E.teal }, { n: '1', m: 'plan', d: `reajustado por ${coachName} — más suave`, tone: E.gold }]
    : [{ n: '08', m: 'sessions', d: 'missed against your personalized plan', tone: E.hot }, { n: '12', m: 'days', d: `broke your ${v.streak_count}-day streak (your longest this year)`, tone: E.ink }, { n: '6', m: 'new PRs', d: 'logged by your gym crew', tone: E.teal }, { n: '1', m: 'plan', d: `reworked by ${coachName} — gentler`, tone: E.gold }];
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ padding: '32px 32px 12px', borderBottom: `1px solid ${E.line}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <ELogo size={32} gymName={gymName} logoUrl={logoUrl} E={E} />
          <EPill tone="hot" E={E}>{tx(lang, `— ${v.days_inactive} días`, `— ${v.days_inactive} days`)}</EPill>
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>
          {tx(lang, 'Reporte de ausencia', 'Absence report')}
        </div>
        <h1 style={{ fontFamily: F.display, fontSize: 38, fontWeight: 900, color: E.ink, letterSpacing: -1.5, lineHeight: 1.05, margin: 0 }}>
          {tx(lang, 'Mientras no estabas:', 'While you were away:')}
        </h1>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px 32px', borderBottom: `1px solid ${E.line}` }}>
          <div style={{ fontFamily: F.display, fontSize: 56, fontWeight: 900, color: r.tone, letterSpacing: -2.5, lineHeight: 1, width: 90 }}>{r.n}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 }}>{r.m}</div>
            <div style={{ fontSize: 13, color: E.sub, marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
          </div>
        </div>
      ))}
      <div style={{ padding: '28px 32px', background: E.creamElev }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.tealInk, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>{tx(lang, 'Lo bueno', 'The good news')}</div>
        <p style={{ fontSize: 15, color: E.ink, lineHeight: 1.55, margin: 0 }}>
          {tx(lang, <>{coachName} revisó tu historial y armó un <strong>plan de regreso de 14 días</strong> — volumen bajo, sin culpa. El primer entreno son 22 minutos.</>,
                     <>{coachName} reviewed your history and built a <strong>14-day comeback plan</strong> — low volume, no guilt. The first workout is 22 minutes.</>)}
        </p>
      </div>
      <div style={{ padding: '24px 32px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <EBtn tone="hot" wide icon={EI.arrow} E={E}>{tx(lang, 'Empezar el regreso · 22 min', 'Start the comeback · 22 min')}</EBtn>
        <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, 'Cambiar de entrenador', 'Switch coach')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailWinbackText({ lang = 'es', name, gymName, logoUrl, coachName, E = BASE_E }) {
  const initial = (coachName || 'C').trim().charAt(0).toUpperCase();
  const msgs = lang === 'es'
    ? [`oye ${name} 👋 vi que no has venido en un tiempo`, 'no es regaño — solo chequeando si todo está bien', 'te dejé un plan suavecito de 22 min por si quieres arrancar mañana 👇']
    : [`hey ${name} 👋 noticed you haven't been in for a bit`, 'not a lecture — just checking in on you', 'left you an easy 22-min plan in case you want to start tomorrow 👇'];
  const bubble = (text, key) => (
    <div key={key} style={{ maxWidth: '78%', alignSelf: 'flex-start' }}>
      <div style={{ background: E.creamElev, padding: '12px 16px', borderRadius: '18px 18px 18px 4px', fontSize: 14.5, color: E.ink, lineHeight: 1.45, border: `1px solid ${E.line}` }}>{text}</div>
    </div>
  );
  return (
    <div style={{ width: '100%', background: E.paper, padding: '28px 24px 8px', fontFamily: F.body, color: E.ink }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${E.line}` }}>
        <div style={{ width: 52, height: 52, borderRadius: 999, background: 'linear-gradient(135deg, #7FE3C4, #19B8B8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: F.display, fontWeight: 900, fontSize: 22 }}>{initial}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 }}>{coachName}</div>
          <div style={{ fontSize: 12, color: E.sub }}>{tx(lang, 'Tu entrenador · activo ahora', 'Your coach · active now')}</div>
        </div>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: E.good, boxShadow: `0 0 0 4px ${E.good}25` }} />
      </div>
      <div style={{ padding: '24px 0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 10.5, color: E.mute, textAlign: 'center', letterSpacing: 0.4, marginBottom: 6 }}>{tx(lang, 'Hoy · 9:42 am', 'Today · 9:42 am')}</div>
        {msgs.map((m, i) => bubble(m, i))}
        <div style={{ maxWidth: '88%', alignSelf: 'flex-start' }}>
          <div style={{ background: E.ink, color: E.cream, padding: 16, borderRadius: '18px 18px 18px 4px' }}>
            <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: E.gold, fontWeight: 700, marginBottom: 8 }}>{tx(lang, 'Plan suave · regreso', 'Easy plan · comeback')}</div>
            <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1 }}>{tx(lang, 'Movimiento general', 'General movement')}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(245,242,236,0.75)', lineHeight: 1.5 }}>
              {tx(lang, <>22 min · 4 ejercicios · sin pesa máxima<br />Mañana 6:30am · Sede Hato Rey</>,
                         <>22 min · 4 exercises · no max lifts<br />Tomorrow 6:30am · Hato Rey</>)}
            </div>
            <div style={{ marginTop: 14 }}>
              <EBtn tone="gold" size="sm" E={E}>{tx(lang, 'Confirmar y verlo →', 'Confirm & view →')}</EBtn>
            </div>
          </div>
        </div>
        {bubble(tx(lang, 'cualquier cosa me escribes ✌🏽', 'message me anytime ✌🏽'), 'tail')}
      </div>
      <div style={{ marginTop: 16, marginBottom: 8, background: E.creamElev, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${E.line}` }}>
        <EIco size={16} color={E.mute} stroke={2}>{EI.mail}</EIco>
        <div style={{ fontSize: 13, color: E.sub, flex: 1 }}>
          {tx(lang, `Responde aquí — ${coachName} ve tus mensajes`, `Reply here — ${coachName} sees your messages`)}
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  STREAK AT RISK
// ═══════════════════════════════════════════════════════════════════

function EmailStreakPoster({ lang = 'es', gymName, logoUrl, v, E = BASE_E /* eslint-disable-line no-unused-vars */ }) {
  const opts = lang === 'es'
    ? [{ t: '18 min · Movilidad rápida', s: 'En casa · sin equipo', tag: 'Más rápido', tone: E.hot }, { t: '25 min · Empuje superior', s: 'Sede Hato Rey · check-in 5min', tag: 'Recomendado', tone: E.teal }, { t: '32 min · Cardio Z2', s: 'En casa · solo trotar', tag: null }]
    : [{ t: '18 min · Quick mobility', s: 'At home · no equipment', tag: 'Fastest', tone: E.hot }, { t: '25 min · Upper push', s: 'Hato Rey · 5-min check-in', tag: 'Recommended', tone: E.teal }, { t: '32 min · Cardio Z2', s: 'At home · just jog', tag: null }];
  return (
    <div style={{ width: '100%', fontFamily: F.body, color: E.ink }}>
      <div style={{ background: E.hot, color: '#fff', padding: '32px 28px 32px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 }}>
          <ELogo size={32} gymName={gymName} logoUrl={logoUrl} E={E} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.2)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            <div style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />
            {tx(lang, 'En vivo · 4h restantes', 'Live · 4h left')}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 10 }}>{tx(lang, 'Tu racha actual', 'Your current streak')}</div>
          <div style={{ fontFamily: F.display, fontSize: 220, fontWeight: 900, color: '#fff', lineHeight: 0.82, letterSpacing: -12, margin: 0 }}>{v.streak_count}</div>
          <div style={{ marginTop: -4, fontFamily: F.display, fontSize: 38, fontWeight: 900, letterSpacing: -1, lineHeight: 1 }}>{tx(lang, 'días seguidos.', 'days in a row.')}</div>
        </div>
        <div style={{ marginTop: 36 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
            <span>{tx(lang, 'medianoche', 'midnight')}</span>
            <span>03:58:42</span>
          </div>
          <div style={{ height: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: '17%', height: '100%', background: '#fff' }} />
          </div>
        </div>
      </div>
      <div style={{ background: E.cream, padding: '32px 28px 36px' }}>
        <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 900, color: E.ink, letterSpacing: -1, lineHeight: 1.15, marginBottom: 14 }}>
          {tx(lang, 'Una sesión más y la salvas.', 'One more session and you save it.')}
        </div>
        <p style={{ fontSize: 14.5, color: E.ink2, lineHeight: 1.55, margin: 0 }}>
          {tx(lang, 'Te armamos 3 opciones cortas. La más rápida son 18 minutos. Camina al gym o hazla en casa.',
                    'We lined up 3 short options. The fastest is 18 minutes. Walk to the gym or do it at home.')}
        </p>
        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {opts.map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: E.paper, borderRadius: 12, border: `1px solid ${E.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: F.display, fontSize: 14, fontWeight: 800, color: E.ink, letterSpacing: -0.3 }}>{o.t}</span>
                  {o.tag && <EPill tone={o.tone === E.hot ? 'hot' : 'teal'} style={{ fontSize: 9 }} E={E}>{o.tag}</EPill>}
                </div>
                <div style={{ fontSize: 12, color: E.sub, marginTop: 2 }}>{o.s}</div>
              </div>
              <EIco size={18} color={E.ink} stroke={2.4}>{EI.arrow}</EIco>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 22 }}>
          <EBtn tone="dark" wide icon={EI.bolt} E={E}>{tx(lang, 'Salvar mi racha', 'Save my streak')}</EBtn>
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: E.mute, textAlign: 'center' }}>
          {tx(lang, <>¿Hoy no puedes? <a style={{ color: E.ink, textDecoration: 'underline' }}>Congelar racha por enfermedad</a></>,
                     <>Can't today? <a style={{ color: E.ink, textDecoration: 'underline' }}>Freeze streak for illness</a></>)}
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailStreakCalm({ lang = 'es', gymName, logoUrl, v, E = BASE_E }) {
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ padding: '40px 36px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
          <ELogo size={36} gymName={gymName} logoUrl={logoUrl} E={E} />
        </div>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 32, background: E.teal, borderRadius: 3, opacity: 0.3 + (i / 14) * 0.7 }} />
            ))}
            <div style={{ flex: 1, height: 32, border: `2px dashed ${E.hot}`, borderRadius: 3, background: 'transparent' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.mono, fontSize: 9.5, color: E.mute, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            <span>{tx(lang, '12 may', 'May 12')}</span>
            <span style={{ color: E.hot, fontWeight: 700 }}>{tx(lang, 'hoy', 'today')}</span>
          </div>
        </div>
        <h1 style={{ fontFamily: F.serif, fontSize: 40, fontWeight: 400, color: E.ink, lineHeight: 1.05, letterSpacing: -1.2, margin: 0 }}>
          {tx(lang, <>{v.streak_count} días.<br /><em style={{ fontStyle: 'italic', color: E.hot }}>Hoy se decide.</em></>,
                     <>{v.streak_count} days.<br /><em style={{ fontStyle: 'italic', color: E.hot }}>Today decides it.</em></>)}
        </h1>
        <p style={{ marginTop: 22, fontSize: 15, color: E.ink2, lineHeight: 1.6 }}>
          {tx(lang, 'La data dice algo claro: las rachas que rompen el día 14 caen al 8% de tasa de regreso en 30 días. Las que pasan de 14 suben al 73%. No te lo digo para presionar — te lo digo porque vale.',
                    'The data is clear: streaks that break on day 14 drop to an 8% return rate within 30 days. Those that pass 14 jump to 73%. Not to pressure you — just because it matters.')}
        </p>
        <div style={{ marginTop: 24, padding: 20, borderRadius: 14, background: E.tealSoft, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontFamily: F.display, fontSize: 52, fontWeight: 900, color: E.tealInk, letterSpacing: -2, lineHeight: 1 }}>20<span style={{ fontSize: 22 }}>min</span></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 800, color: E.tealInk }}>{tx(lang, 'Mínimo para contar', 'Minimum that counts')}</div>
            <div style={{ fontSize: 12.5, color: E.tealInk, opacity: 0.8, marginTop: 2 }}>{tx(lang, 'Cualquier sesión registrada de 20+ min mantiene la racha viva.', 'Any logged session of 20+ min keeps the streak alive.')}</div>
          </div>
        </div>
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <EBtn tone="dark" wide icon={EI.arrow} E={E}>{tx(lang, 'Abrir mi plan de hoy', 'Open today’s plan')}</EBtn>
          <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, 'Usar día de gracia (1 disponible)', 'Use grace day (1 available)')}</EBtn>
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PR
// ═══════════════════════════════════════════════════════════════════

function EmailPRCertificate({ lang = 'es', name, gymName, logoUrl, coachName, E = BASE_E }) {
  const corner = (c) => (
    <div key={c} style={{
      position: 'absolute', width: 24, height: 24,
      ...(c.includes('t') ? { top: -3 } : { bottom: -3 }),
      ...(c.includes('l') ? { left: -3 } : { right: -3 }),
      borderTop: c.includes('t') ? `3px solid ${E.hot}` : 'none',
      borderBottom: c.includes('b') ? `3px solid ${E.hot}` : 'none',
      borderLeft: c.includes('l') ? `3px solid ${E.hot}` : 'none',
      borderRight: c.includes('r') ? `3px solid ${E.hot}` : 'none',
      background: E.cream,
    }} />
  );
  return (
    <div style={{ width: '100%', background: E.cream, padding: '40px 28px 36px', fontFamily: F.body, color: E.ink }}>
      <div style={{ border: `3px double ${E.ink}`, padding: '32px 24px 28px', position: 'relative' }}>
        {['tl', 'tr', 'bl', 'br'].map(corner)}
        <div style={{ textAlign: 'center' }}>
          <ELogo size={42} gymName={gymName} logoUrl={logoUrl} E={E} />
        </div>
        <div style={{ marginTop: 16, textAlign: 'center', fontFamily: F.mono, fontSize: 11, color: E.goldInk, letterSpacing: 4, textTransform: 'uppercase', fontWeight: 700 }}>
          {tx(lang, '— Récord personal —', '— Personal record —')}
        </div>
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <div style={{ fontFamily: F.serif, fontSize: 19, fontWeight: 300, color: E.sub, fontStyle: 'italic', letterSpacing: -0.3 }}>{tx(lang, 'otorgado a', 'awarded to')}</div>
          <h1 style={{ fontFamily: F.serif, fontSize: 44, fontWeight: 400, color: E.ink, letterSpacing: -1.5, lineHeight: 1, margin: '8px 0 0' }}>{name}</h1>
        </div>
        <div style={{ height: 1, background: E.lineStrong, margin: '24px 36px' }} />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>{tx(lang, 'Por levantar', 'For lifting')}</div>
          <div style={{ fontFamily: F.display, fontSize: 88, fontWeight: 900, color: E.hot, letterSpacing: -4, lineHeight: 0.9, marginTop: 8 }}>
            95<span style={{ fontSize: 32, fontWeight: 700, color: E.ink, letterSpacing: 0 }}>kg</span>
          </div>
          <div style={{ marginTop: 8, fontFamily: F.display, fontSize: 18, fontWeight: 700, color: E.ink, letterSpacing: -0.3 }}>{tx(lang, 'en sentadilla trasera × 5 reps', 'in back squat × 5 reps')}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: E.sub }}>{tx(lang, '+5kg desde tu récord anterior (90kg, 12 abril)', '+5kg from your previous record (90kg, Apr 12)')}</div>
        </div>
        <div style={{ height: 1, background: E.lineStrong, margin: '24px 36px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px' }}>
          <div>
            <div style={{ fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink }}>{coachName}</div>
            <div style={{ fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{tx(lang, 'Entrenador', 'Coach')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: F.mono, fontSize: 11, color: E.ink, fontWeight: 700 }}>24 · 05 · 2026</div>
            <div style={{ fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{tx(lang, 'Sede Hato Rey', 'Hato Rey')}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '28px 12px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: E.ink2, lineHeight: 1.6, margin: 0 }}>{tx(lang, 'Compártelo. Ponlo de fondo. Imprímelo y pégalo en la pared. Lo levantaste tú.', 'Share it. Set it as your wallpaper. Print it and stick it on the wall. You lifted it.')}</p>
        <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center' }}>
          <EBtn tone="dark" icon={EI.send} E={E}>{tx(lang, 'Compartir', 'Share')}</EBtn>
          <EBtn tone="ghost" E={E}>{tx(lang, 'Descargar', 'Download')}</EBtn>
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailPRBigNumber({ lang = 'es', name /* eslint-disable-line no-unused-vars */, gymName, logoUrl, coachName, E = BASE_E }) {
  const months = lang === 'es'
    ? [['Ene', 70, 0.74], ['Feb', 75, 0.79], ['Mar', 82, 0.86], ['Abr', 90, 0.95], ['May', 95, 1.0, true]]
    : [['Jan', 70, 0.74], ['Feb', 75, 0.79], ['Mar', 82, 0.86], ['Apr', 90, 0.95], ['May', 95, 1.0, true]];
  const deltas = lang === 'es' ? [{ k: '+5kg', l: 'vs abril' }, { k: '+25kg', l: 'vs enero' }, { k: '5', l: 'reps' }] : [{ k: '+5kg', l: 'vs April' }, { k: '+25kg', l: 'vs January' }, { k: '5', l: 'reps' }];
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ background: E.ink, color: E.cream, padding: '36px 28px 40px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 }}>
          <ELogo size={32} gymName={gymName} logoUrl={logoUrl} E={E} />
          <EPill tone="invert" E={E}>{tx(lang, 'PR · 24 may', 'PR · May 24')}</EPill>
        </div>
        <div style={{ fontFamily: F.display, fontSize: 11, color: E.gold, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 800, marginBottom: 14 }}>{tx(lang, 'Nuevo récord personal', 'New personal record')}</div>
        <h1 style={{ fontFamily: F.display, fontSize: 56, fontWeight: 900, color: E.cream, lineHeight: 0.95, letterSpacing: -2, margin: 0 }}>
          {tx(lang, <>Levantaste<br /><span style={{ color: E.gold }}>noventa y cinco</span></>, <>You lifted<br /><span style={{ color: E.gold }}>ninety-five</span></>)}
        </h1>
        <div style={{ fontFamily: F.display, fontSize: 200, fontWeight: 900, color: E.gold, lineHeight: 0.85, letterSpacing: -10, marginTop: 12 }}>
          95<span style={{ fontSize: 56, color: E.cream }}>kg</span>
        </div>
        <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: 'rgba(245,242,236,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>{tx(lang, 'Tu progresión · Sentadilla', 'Your progression · Squat')}</div>
          {months.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
              <div style={{ width: 30, fontFamily: F.mono, fontSize: 11, color: 'rgba(245,242,236,0.55)' }}>{r[0]}</div>
              <div style={{ flex: 1, height: 18, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${r[2] * 100}%`, height: '100%', background: r[3] ? E.gold : 'rgba(255,255,255,0.4)', borderRadius: 3 }} />
              </div>
              <div style={{ width: 50, textAlign: 'right', fontFamily: F.display, fontSize: 14, fontWeight: 800, color: r[3] ? E.gold : E.cream }}>{r[1]}kg</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '32px 28px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 28 }}>
          {deltas.map((s, i) => (
            <div key={i} style={{ padding: 14, background: E.creamElev, borderRadius: 12, border: `1px solid ${E.line}` }}>
              <div style={{ fontFamily: F.display, fontSize: 24, fontWeight: 900, color: E.ink, letterSpacing: -1, lineHeight: 1 }}>{s.k}</div>
              <div style={{ fontSize: 10.5, color: E.sub, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: 18, borderLeft: `3px solid ${E.hot}`, background: E.creamElev, borderRadius: '0 8px 8px 0' }}>
          <div style={{ fontFamily: F.serif, fontSize: 17, fontStyle: 'italic', color: E.ink, lineHeight: 1.45 }}>
            {tx(lang, '"Lo vi venir desde la sesión del lunes. Te aguantaste las ganas de saltar y eso valió. Vamos por 100 antes de julio."',
                      '"I saw it coming since Monday\'s session. You held back from rushing and it paid off. Let\'s go for 100 before July."')}
          </div>
          <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700 }}>— {coachName}, coach</div>
        </div>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <EBtn tone="dark" wide icon={EI.send} E={E}>{tx(lang, 'Compartir con el feed', 'Share to the feed')}</EBtn>
          <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, 'Ver historial completo', 'See full history')}</EBtn>
        </div>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CLASS REMINDER
// ═══════════════════════════════════════════════════════════════════

function EmailClassTicket({ lang = 'es', gymName, logoUrl, coachName, E = BASE_E }) {
  const meta = lang === 'es'
    ? [{ l: 'Hora', v: '6:30', s: 'am' }, { l: 'Duración', v: '45', s: 'min' }, { l: 'Cupos', v: '4/12', s: 'libres' }]
    : [{ l: 'Time', v: '6:30', s: 'am' }, { l: 'Duration', v: '45', s: 'min' }, { l: 'Spots', v: '4/12', s: 'open' }];
  return (
    <div style={{ width: '100%', background: E.cream, padding: '36px 28px 28px', fontFamily: F.body, color: E.ink }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700 }}>{tx(lang, 'Confirmación · Clase', 'Confirmation · Class')}</div>
      </div>
      <div style={{ background: E.paper, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)', border: `1px solid ${E.line}` }}>
        <div style={{ padding: '22px 22px 24px', borderBottom: `2px dashed ${E.lineStrong}`, position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }}>{tx(lang, 'Mañana · martes', 'Tomorrow · Tuesday')}</div>
              <div style={{ fontFamily: F.display, fontSize: 32, fontWeight: 900, color: E.ink, letterSpacing: -1.2, marginTop: 8, lineHeight: 1 }}>
                {tx(lang, <>Funcional<br />de mañana</>, <>Morning<br />functional</>)}
              </div>
            </div>
            <ELogo size={36} gymName={gymName} logoUrl={logoUrl} E={E} />
          </div>
          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {meta.map((m, i) => (
              <div key={i}>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{m.l}</div>
                <div style={{ fontFamily: F.display, fontSize: 22, fontWeight: 900, color: E.ink, letterSpacing: -0.8, lineHeight: 1 }}>
                  {m.v}<span style={{ fontSize: 11, color: E.sub, fontWeight: 600, marginLeft: 3 }}>{m.s}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ position: 'absolute', bottom: -10, left: -10, width: 20, height: 20, borderRadius: 999, background: E.cream }} />
          <div style={{ position: 'absolute', bottom: -10, right: -10, width: 20, height: 20, borderRadius: 999, background: E.cream }} />
        </div>
        <div style={{ padding: '22px 22px 24px', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>{tx(lang, 'Sede', 'Location')}</div>
            <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 }}>{tx(lang, 'Hato Rey · Salón 2', 'Hato Rey · Studio 2')}</div>
            <div style={{ fontSize: 12, color: E.sub, marginTop: 3 }}>
              {tx(lang, <>Av. Ponce de León 1234<br />San Juan, PR 00907</>, <>1234 Ponce de León Ave<br />San Juan, PR 00907</>)}
            </div>
            <div style={{ marginTop: 12 }}>
              <EPill tone="teal" E={E}>Coach: {coachName}</EPill>
            </div>
          </div>
          <div style={{ width: 90, height: 90, padding: 6, background: E.paper, border: `1.5px solid ${E.ink}`, borderRadius: 4, display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 1 }}>
            {Array.from({ length: 81 }).map((_, i) => {
              const isFinder = [0, 1, 7, 8, 9, 16, 17, 72, 73, 80].includes(i);
              const on = isFinder || (i * 17 + 3) % 7 < 3;
              return <div key={i} style={{ background: on ? E.ink : 'transparent', aspectRatio: '1' }} />;
            })}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 24, padding: '16px 18px', background: E.paper, borderRadius: 10, border: `1px solid ${E.line}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <EIco size={16} color={E.hot} stroke={2.2} style={{ marginTop: 1 }}>{EI.bolt}</EIco>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.display, fontSize: 13, fontWeight: 800, color: E.ink, marginBottom: 2 }}>{tx(lang, 'Llega 5 min antes', 'Arrive 5 min early')}</div>
            <div style={{ fontSize: 12.5, color: E.sub, lineHeight: 1.5 }}>{tx(lang, 'Trae botella de agua. Calentamos juntos.', 'Bring a water bottle. We warm up together.')}</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><EBtn tone="dark" wide size="md" E={E}>{tx(lang, 'Añadir a calendario', 'Add to calendar')}</EBtn></div>
        <EBtn tone="ghost" size="md" E={E}>{tx(lang, 'Cancelar', 'Cancel')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

function EmailClassClean({ lang = 'es', gymName, logoUrl, coachName, E = BASE_E }) {
  return (
    <div style={{ width: '100%', background: E.paper, fontFamily: F.body, color: E.ink }}>
      <div style={{ padding: '28px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <ELogo size={28} gymName={gymName} logoUrl={logoUrl} E={E} />
          <EWordmark size={13} gymName={gymName} E={E} />
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: E.tealInk, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>{tx(lang, 'Recordatorio', 'Reminder')}</div>
        <h1 style={{ fontFamily: F.display, fontSize: 36, fontWeight: 900, color: E.ink, lineHeight: 1.05, letterSpacing: -1.5, margin: 0 }}>
          {tx(lang, 'Mañana a las 6:30am.', 'Tomorrow at 6:30am.')}
        </h1>
      </div>
      <div style={{ padding: '24px 32px 0' }}>
        <div style={{ background: E.creamElev, border: `1px solid ${E.line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, borderBottom: `1px solid ${E.line}` }}>
            <div style={{ width: 64, padding: '10px 0', textAlign: 'center', background: E.ink, color: E.cream, borderRadius: 10 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5, opacity: 0.7, textTransform: 'uppercase' }}>{tx(lang, 'MAR', 'TUE')}</div>
              <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 900, letterSpacing: -1, lineHeight: 1, marginTop: 2 }}>26</div>
              <div style={{ fontFamily: F.mono, fontSize: 9, color: E.gold, letterSpacing: 1, marginTop: 2 }}>MAY</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 800, color: E.ink, letterSpacing: -0.5 }}>{tx(lang, 'Funcional de mañana', 'Morning functional')}</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12, color: E.sub }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <EIco size={13} color={E.sub} stroke={2}>{EI.clock}</EIco> 6:30 — 7:15am
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <EIco size={13} color={E.sub} stroke={2}>{EI.user}</EIco> {coachName}
                </span>
              </div>
            </div>
          </div>
          <div style={{ padding: 18, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <EIco size={16} color={E.sub} stroke={2} style={{ marginTop: 2 }}>{EI.pin}</EIco>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink }}>{tx(lang, 'Sede Hato Rey · Salón 2', 'Hato Rey · Studio 2')}</div>
              <div style={{ fontSize: 12, color: E.sub, marginTop: 2 }}>{tx(lang, 'Av. Ponce de León 1234, San Juan', '1234 Ponce de León Ave, San Juan')}</div>
            </div>
            <a style={{ fontFamily: F.display, fontSize: 12, color: E.tealInk, fontWeight: 700, textDecoration: 'underline' }}>{tx(lang, 'Cómo llegar', 'Directions')}</a>
          </div>
        </div>
      </div>
      <div style={{ padding: '20px 32px 0' }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>{tx(lang, 'Lo de hoy', 'Today’s focus')}</div>
        <p style={{ fontSize: 14, color: E.ink2, lineHeight: 1.55, margin: 0 }}>
          {tx(lang, 'Trabajamos cadera y core. Trae botella de agua y zapatos de gimnasio (no de correr — necesitamos suela plana).',
                    'We work hips and core. Bring a water bottle and gym shoes (not running shoes — we need flat soles).')}
        </p>
      </div>
      <div style={{ padding: '28px 32px 36px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <EBtn tone="teal" size="md" wide icon={EI.cal} E={E}>{tx(lang, 'Calendario', 'Calendar')}</EBtn>
        <EBtn tone="ghost" size="md" wide E={E}>{tx(lang, 'Cancelar', 'Cancel')}</EBtn>
      </div>
      <EFooter lang={lang} gymName={gymName} logoUrl={logoUrl} E={E} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Registry + dispatcher
// ═══════════════════════════════════════════════════════════════════

const REGISTRY = {
  'welcome-editorial': EmailWelcomeEditorial,
  'welcome-poster': EmailWelcomePoster,
  'recap-magazine': EmailRecapMagazine,
  'recap-receipt': EmailRecapReceipt,
  'recap-dark': EmailRecapDark,
  'winback-quiet': EmailWinbackQuiet,
  'winback-data': EmailWinbackData,
  'winback-text': EmailWinbackText,
  'streak-poster': EmailStreakPoster,
  'streak-calm': EmailStreakCalm,
  'pr-certificate': EmailPRCertificate,
  'pr-bignumber': EmailPRBigNumber,
  'class-ticket': EmailClassTicket,
  'class-clean': EmailClassClean,
};

const VAR_DEFAULTS = { streak_count: '14', workout_count: '187', days_inactive: '23' };

/**
 * Renders the designer email for a given id with the gym's branding and copy
 * merged in. The wrapping div is always 640px wide (the editorial canvas) —
 * the caller wraps in transform/scale for thumbnails.
 */
export default function DesignerEmail({
  id,
  lang = 'es',
  name,
  gymName = 'Gym',
  gymLogoUrl = '',
  coachName,
  primaryColor,
  secondaryColor,
  vars,
}) {
  const Comp = REGISTRY[id];
  if (!Comp) return <div style={{ padding: 24, color: '#5A6570' }}>Preview unavailable</div>;
  const E = buildPalette(primaryColor, secondaryColor);
  const resolvedName = name || (lang === 'es' ? 'José' : 'Alex');
  const resolvedCoach = coachName || gymName;
  const v = { ...VAR_DEFAULTS, ...(vars || {}) };
  return (
    <div style={{ width: 640, margin: '0 auto', background: E.cream }}>
      <Comp
        lang={lang}
        name={resolvedName}
        gymName={gymName}
        logoUrl={gymLogoUrl}
        coachName={resolvedCoach}
        v={v}
        E={E}
      />
    </div>
  );
}

export const DESIGNER_IDS = Object.keys(REGISTRY);
