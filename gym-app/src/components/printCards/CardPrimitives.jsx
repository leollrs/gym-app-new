/**
 * Shared primitives for the v2 print card system.
 *
 *   Postcards     — 384 × 576 px  (4×6 in @ 96 dpi)
 *   Folded spread — 1056 × 408 px (5.5×4.25 closed, 11×4.25 open)
 *
 * Visual language: EB Garamond serif headlines, DM Sans body,
 * JetBrains Mono stamps, Caveat for the faux-handwritten note line.
 * The "QRBlock" uses qrcode.react so the printed QR is the real
 * earned-reward code, not a visual placeholder.
 */
import { QRCodeSVG } from 'qrcode.react';

export function SignatureMark({ color = '#111', opacity = 0.6, width = 110 }) {
  return (
    <svg viewBox="0 0 110 28" width={width} height={width * 0.25} style={{ display: 'block' }}>
      <path
        d="M2 22 C 10 4, 18 4, 22 18 S 32 26, 40 12 C 44 6, 50 8, 54 16 C 58 24, 64 22, 70 14 C 76 6, 84 8, 90 18 C 94 24, 102 20, 108 6"
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GymMark({ gymName, gymLogoUrl, size = 'md', color }) {
  const sizes = {
    sm: { fs: 9, tracking: '0.18em', logoH: 14 },
    md: { fs: 11, tracking: '0.16em', logoH: 18 },
    lg: { fs: 14, tracking: '0.14em', logoH: 24 },
  };
  const s = sizes[size];
  if (gymLogoUrl) {
    return <img src={gymLogoUrl} alt={gymName} style={{ height: s.logoH, width: 'auto', display: 'block' }} />;
  }
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: s.fs,
        lineHeight: 1,
        letterSpacing: s.tracking,
        textTransform: 'uppercase',
        fontWeight: 600,
        color: color || '#111',
      }}
    >
      {gymName}
    </div>
  );
}

/**
 * Renders a real QR code via qrcode.react when `value` is provided,
 * otherwise renders nothing. The original mockup had a seeded fake-QR
 * fallback for the showcase HTML; we drop it because production never
 * wants a fake QR on a printed card.
 */
export function QRBlock({ size = 72, value, label }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {label && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(17,17,17,0.6)',
            textAlign: 'center',
            maxWidth: size + 24,
            lineHeight: 1.2,
          }}
        >
          {label}
        </div>
      )}
      <QRCodeSVG value={value} size={size} level="M" includeMargin={false} bgColor="#FFFFFF" fgColor="#000000" />
    </div>
  );
}

export function SignBlock({ color, label = 'signed', note, noteLines = 2, width = '100%', compact = false }) {
  const lineColor = 'rgba(17,17,17,0.18)';
  const lineH = compact ? 14 : 18;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6, width }}>
      {Array.from({ length: noteLines }).map((_, i) => (
        <div key={i} style={{ borderBottom: `0.5px solid ${lineColor}`, height: lineH, position: 'relative' }}>
          {i === 0 && note ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                bottom: 2,
                fontFamily: "'Caveat', cursive",
                fontSize: 17,
                color: 'rgba(17,17,17,0.72)',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}
            >
              {note}
            </div>
          ) : null}
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 10,
          borderBottom: `0.5px solid ${lineColor}`,
          paddingBottom: 3,
          height: compact ? 22 : 26,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(17,17,17,0.5)',
            paddingBottom: 4,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
        <SignatureMark color={color} width={90} />
      </div>
    </div>
  );
}

export function PostcardShell({ children, style }) {
  return (
    <div
      data-card-shell="postcard"
      style={{
        width: 384,
        height: 576,
        background: '#fff',
        position: 'relative',
        color: '#111',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FoldedShell({ children, side, style }) {
  return (
    <div
      data-card-shell="folded"
      data-folded-side={side}
      style={{
        width: 1056,
        height: 408,
        background: '#fff',
        position: 'relative',
        color: '#111',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Fold guide — printed faintly so the owner can fold accurately */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          bottom: 0,
          width: 0,
          borderLeft: '0.5px dashed rgba(17,17,17,0.18)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      {children}
    </div>
  );
}

export function Stamp({ text, color, dot = true, align = 'left' }) {
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'rgba(17,17,17,0.7)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            background: color,
            display: 'inline-block',
            borderRadius: 0,
          }}
        />
      )}
      {text}
    </div>
  );
}
