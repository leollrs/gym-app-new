import { TT, TFont, AVATAR_PALETTES } from './designTokens';

// ────────────────────────────────────────────────────────────────────
// TCard — base elevated card
// ────────────────────────────────────────────────────────────────────
export function TCard({ children, dark = false, padded = 16, style = {}, className = '', ...rest }) {
  return (
    <div
      className={className}
      style={{
        background: dark ? TT.surfaceDk : TT.surface,
        borderRadius: 18,
        border: dark ? '1px solid rgba(255,255,255,0.06)' : `1px solid ${TT.border}`,
        boxShadow: dark ? 'none' : TT.shadow,
        padding: padded,
        color: dark ? TT.textInv : TT.text,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TPill — uppercase tone-mapped status pill
// ────────────────────────────────────────────────────────────────────
const PILL_TONES = {
  neutral: { bg: TT.surface2, fg: TT.textSub, bd: TT.borderSolid },
  teal:    { bg: TT.accentSoft, fg: TT.accentInk, bd: 'transparent' },
  hot:     { bg: TT.hotSoft, fg: TT.hot, bd: 'transparent' },
  warn:    { bg: TT.warnSoft, fg: TT.warnInk, bd: 'transparent' },
  good:    { bg: TT.goodSoft, fg: TT.goodInk, bd: 'transparent' },
  coach:   { bg: TT.coachSoft, fg: TT.coach, bd: 'transparent' },
  dark:    { bg: TT.text, fg: '#fff', bd: 'transparent' },
  outline: { bg: 'transparent', fg: TT.textSub, bd: TT.borderSolid },
  invert:  { bg: '#fff', fg: TT.text, bd: 'transparent' },
};
const PILL_SIZES = {
  s: { padding: '2px 7px', fontSize: 9.5 },
  m: { padding: '3px 9px', fontSize: 10.5 },
  l: { padding: '5px 12px', fontSize: 12 },
};

export function TPill({ children, tone = 'neutral', size = 'm', style = {} }) {
  const c = PILL_TONES[tone] || PILL_TONES.neutral;
  const s = PILL_SIZES[size] || PILL_SIZES.m;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      borderRadius: 999,
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
      fontWeight: 700, letterSpacing: 0.3,
      textTransform: 'uppercase', whiteSpace: 'nowrap',
      ...s, ...style,
    }}>{children}</span>
  );
}

// ────────────────────────────────────────────────────────────────────
// TAvatar — gradient initials (or photo via src)
// ────────────────────────────────────────────────────────────────────
export function TAvatar({ name = '?', size = 36, idx = 0, src, style = {} }) {
  const [a, b] = AVATAR_PALETTES[idx % AVATAR_PALETTES.length];
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  if (src) {
    return (
      <img src={src} alt={name} style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0,
        objectFit: 'cover', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
        ...style,
      }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: TFont.display, fontWeight: 800,
      fontSize: size * 0.42, letterSpacing: -0.5,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
      ...style,
    }}>{initial}</div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TSparkBars — tiny activity bar chart
// ────────────────────────────────────────────────────────────────────
export function TSparkBars({ data, w = 80, h = 28, color = TT.accent, track = '#E8E4DB' }) {
  const safe = Array.isArray(data) && data.length ? data : [0];
  const max = Math.max(...safe, 1);
  const bw = w / safe.length;
  return (
    <svg width={w} height={h} aria-hidden="true">
      {safe.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        return (
          <rect key={i}
            x={i * bw + 1} y={h - bh}
            width={bw - 2} height={bh}
            rx={1.5}
            fill={v === 0 ? track : color}
            opacity={v === 0 ? 0.4 : 1}
          />
        );
      })}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// TRing — adherence ring with optional label
// ────────────────────────────────────────────────────────────────────
export function TRing({ value = 0.75, size = 44, stroke = 5, color = TT.accent, track = '#E8E4DB', label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}/>
      </svg>
      {label != null && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: TFont.display, fontWeight: 800, fontSize: size * 0.32,
          color: TT.text, letterSpacing: -0.5,
        }}>{label}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// THeroDark — cinematic dark hero block (Home, Live Session)
// ────────────────────────────────────────────────────────────────────
export function THeroDark({ children, style = {} }) {
  return (
    <div style={{
      background: TT.surfaceDk, color: '#fff',
      padding: '0 0 22px',
      borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TEyebrow — uppercase tracked tiny label above page title
// ────────────────────────────────────────────────────────────────────
export function TEyebrow({ children, color = TT.textSub }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color,
      letterSpacing: 1.4, textTransform: 'uppercase',
    }}>{children}</div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TPageTitle — Archivo display title
// ────────────────────────────────────────────────────────────────────
export function TPageTitle({ children, color = TT.text, style = {} }) {
  return (
    <div style={{
      fontFamily: TFont.display, fontSize: 28, fontWeight: 800,
      color, letterSpacing: -1, lineHeight: 1, marginTop: 4,
      ...style,
    }}>{children}</div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TSectionHeader — section title row with optional right action
// ────────────────────────────────────────────────────────────────────
export function TSectionHeader({ title, accent, action, color = TT.text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
      <div style={{
        fontFamily: TFont.display, fontSize: 16, fontWeight: 800,
        color: accent ? TT.hot : color, letterSpacing: -0.3,
      }}>{title}</div>
      {action ? (
        <div style={{ fontSize: 12, color: TT.textSub, fontWeight: 700 }}>{action}</div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// TPrimaryButton — solid teal CTA
// ────────────────────────────────────────────────────────────────────
export function TPrimaryButton({ children, onClick, style = {}, type = 'button', disabled = false, ...rest }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 14px', borderRadius: 12, border: 'none',
        background: TT.accent, color: '#06363B',
        fontFamily: TFont.display, fontWeight: 800, fontSize: 13,
        display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
        ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

// ────────────────────────────────────────────────────────────────────
// TDarkButton — solid dark CTA
// ────────────────────────────────────────────────────────────────────
export function TDarkButton({ children, onClick, style = {}, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        padding: '10px 14px', borderRadius: 12, border: 'none',
        background: TT.text, color: '#fff', fontSize: 13, fontWeight: 800,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

// ────────────────────────────────────────────────────────────────────
// TIconButton — square icon button with optional badge
// ────────────────────────────────────────────────────────────────────
export function TIconButton({ children, onClick, badge, style = {}, dark = false, size = 38, ariaLabel, ...rest }) {
  const surf = dark ? 'rgba(255,255,255,0.07)' : TT.surface2;
  const bd = dark ? 'rgba(255,255,255,0.08)' : TT.borderSolid;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: 12,
        background: surf, border: `1px solid ${bd}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', flexShrink: 0,
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >
      {children}
      {badge ? (
        <div style={{
          position: 'absolute', top: -3, right: -3,
          minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
          background: TT.hot, color: '#fff', fontSize: 10, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${dark ? '#0A0E11' : TT.bg}`,
        }}>{badge}</div>
      ) : null}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// TTabPill — pill-row tab item
// ────────────────────────────────────────────────────────────────────
export function TTabPill({ children, active, onClick, count, accent = false, style = {} }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
        background: active ? (accent ? TT.accent : TT.text) : 'transparent',
        color: active ? (accent ? '#06363B' : '#fff') : TT.textSub,
        border: active ? 'none' : `1px solid ${TT.borderSolid}`,
        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
      {count != null ? <span style={{ fontSize: 10, opacity: 0.7 }}>{count}</span> : null}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// TSegmented — Day / Week / Month style segmented control
// ────────────────────────────────────────────────────────────────────
export function TSegmented({ options, value, onChange, style = {} }) {
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 3, background: TT.surface,
      borderRadius: 12, border: `1px solid ${TT.border}`,
      ...style,
    }}>
      {options.map(opt => {
        const v = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: 8, textAlign: 'center',
              background: active ? TT.text : 'transparent',
              color: active ? '#fff' : TT.textSub,
              border: 'none', fontSize: 12, fontWeight: 700,
              textTransform: 'capitalize', cursor: 'pointer',
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}
