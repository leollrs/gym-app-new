import { describe, it, expect } from 'vitest';
import {
  EMAIL_THEMES, buildTheme, detectTheme, themeById, tint, normalizeHex,
} from '../admin/emailThemes';

const ACCENT = '#D4AF37';

describe('normalizeHex', () => {
  it('expands 3-digit hex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
  });

  it('accepts hex without the hash', () => {
    expect(normalizeHex('D4AF37')).toBe('#d4af37');
  });

  // El caso que importa: branding.js escribe `--color-accent` y en algunos
  // momentos del arranque ese var todavía resuelve a otro `var(--…)`. Si eso
  // llegara a la plantilla se guardaría como si fuera un color.
  it('falls back rather than passing through a css var', () => {
    expect(normalizeHex('var(--color-accent)')).toBe('#D4AF37');
    expect(normalizeHex('')).toBe('#D4AF37');
    expect(normalizeHex(null)).toBe('#D4AF37');
    expect(normalizeHex(undefined, '#000000')).toBe('#000000');
  });
});

describe('tint', () => {
  it('returns white at full amount and the colour at zero', () => {
    expect(tint('#000000', 1)).toBe('#ffffff');
    expect(tint('#123456', 0)).toBe('#123456');
  });

  it('clamps out-of-range amounts instead of producing garbage', () => {
    expect(tint('#000000', 5)).toBe('#ffffff');
    expect(tint('#ffffff', -2)).toBe('#ffffff');
  });

  it('never emits a channel outside 00–ff', () => {
    for (const amt of [0, 0.25, 0.5, 0.88, 0.94, 1]) {
      expect(tint(ACCENT, amt)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('EMAIL_THEMES', () => {
  it('has unique ids and both languages on every label', () => {
    const ids = EMAIL_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const th of EMAIL_THEMES) {
      expect(th.label.es).toBeTruthy();
      expect(th.label.en).toBeTruthy();
      expect(th.hint.es).toBeTruthy();
      expect(th.hint.en).toBeTruthy();
    }
  });

  // El renderizador solo sabe pintar estos tres y cae a 'gradient' con
  // cualquier otro (emailTemplateRenderer.js:106). Un tema que pidiera otra
  // cosa se vería distinto de lo que promete su miniatura.
  it('only asks for header styles the renderer implements', () => {
    for (const th of EMAIL_THEMES) {
      expect(['gradient', 'solid', 'minimal']).toContain(th.build(ACCENT).typography.headerStyle);
    }
  });

  // El renderizador fija la TARJETA a #ffffff y el texto del cuerpo va encima.
  // Un tema con texto claro sería ilegible en el correo real. Este test es la
  // reja que impide que alguien añada el "dark premium" que parece buena idea.
  it('keeps body text dark enough to read on the white card', () => {
    const luminance = (hex) => {
      const n = parseInt(hex.replace('#', ''), 16);
      const ch = (c) => { const s = (c / 255); return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    };
    for (const th of EMAIL_THEMES) {
      const text = th.build(ACCENT).colors.text;
      const contrastOnWhite = 1.05 / (luminance(text) + 0.05);
      expect(contrastOnWhite).toBeGreaterThanOrEqual(4.5); // WCAG AA, texto normal
    }
  });

  it('injects the gym accent as the primary colour', () => {
    for (const th of EMAIL_THEMES) {
      expect(th.build('#1e90ff').colors.primary).toBe('#1e90ff');
    }
  });

  it('always returns a complete set, never a partial one', () => {
    for (const th of EMAIL_THEMES) {
      const built = th.build(ACCENT);
      expect(Object.keys(built.colors).sort()).toEqual(['background', 'primary', 'text']);
      expect(Object.keys(built.cta).sort()).toEqual(['color']);
      expect(Object.keys(built.typography).sort())
        .toEqual(['borderRadius', 'fontSize', 'headerStyle', 'padding']);
    }
  });

  // El botón tiene que ir en el color de marca. Un CTA cian sobre un correo
  // rojo era exactamente lo que hacía que el tema no pareciera un tema.
  it('paints the CTA in the gym accent', () => {
    for (const th of EMAIL_THEMES) {
      expect(th.build('#1e90ff').cta.color).toBe('#1e90ff');
    }
  });
});

describe('buildTheme / themeById', () => {
  it('returns null for an unknown id instead of throwing', () => {
    expect(themeById('nope')).toBeNull();
    expect(buildTheme('nope', ACCENT)).toBeNull();
  });
});

describe('detectTheme', () => {
  it('round-trips every theme', () => {
    for (const th of EMAIL_THEMES) {
      const built = th.build(ACCENT);
      expect(detectTheme(built, ACCENT)).toBe(th.id);
    }
  });

  it('ignores hex case — the native colour picker writes lowercase', () => {
    const built = buildTheme('brand', ACCENT);
    const lowered = {
      colors: Object.fromEntries(Object.entries(built.colors).map(([k, v]) => [k, v.toLowerCase()])),
      cta: { color: built.cta.color.toLowerCase() },
      typography: built.typography,
    };
    expect(detectTheme(lowered, ACCENT)).toBe('brand');
  });

  it('tolerates numeric typography values (the editor stores strings)', () => {
    const built = buildTheme('brand', ACCENT);
    const numeric = {
      colors: built.colors,
      cta: built.cta,
      typography: {
        ...built.typography,
        fontSize: Number(built.typography.fontSize),
        padding: Number(built.typography.padding),
        borderRadius: Number(built.typography.borderRadius),
      },
    };
    expect(detectTheme(numeric, ACCENT)).toBe('brand');
  });

  it('reports custom once any single knob is off', () => {
    const built = buildTheme('brand', ACCENT);
    expect(detectTheme({ ...built, typography: { ...built.typography, padding: '31' } }, ACCENT)).toBe('custom');
    expect(detectTheme({ ...built, colors: { ...built.colors, text: '#123456' } }, ACCENT)).toBe('custom');
  });

  // Un gimnasio con otro color de marca tiene que ver SU tema como activo, no
  // 'custom' — el tema es la forma, el acento es del gimnasio.
  it('follows the gym accent', () => {
    const blue = buildTheme('editorial', '#1e90ff');
    expect(detectTheme(blue, '#1e90ff')).toBe('editorial');
    expect(detectTheme(blue, ACCENT)).toBe('custom');
  });

  it('does not throw on an empty or partial template', () => {
    expect(detectTheme(null, ACCENT)).toBe('custom');
    expect(detectTheme({}, ACCENT)).toBe('custom');
    expect(detectTheme({ colors: {} }, ACCENT)).toBe('custom');
  });
});
