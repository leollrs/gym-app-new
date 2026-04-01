/**
 * White-label theme generator.
 *
 * Converts a gym's brand hex color into a full design-token palette using HSL
 * manipulation, then injects CSS custom properties on :root so every component
 * that references var(--color-accent*) picks up the gym's colors.
 *
 * Key capabilities:
 *  - Surface tinting: extracts the brand hue and applies it at low saturation
 *    to dark-mode backgrounds (red brand → warm charcoal, blue → cool navy)
 *    and light-mode backgrounds (subtle warm/cool tinting at 96-98% lightness).
 *  - Auto contrast detection: WCAG-based relative luminance check to determine
 *    whether text on the primary color should be white or dark.
 *  - Expanded palette: accent shades, surface/background shades, and an
 *    auto-derived secondary (complementary) color.
 */

// ── Default Obsidian & Amber palette ────────────────────────────────────────
const DEFAULT_PRIMARY   = '#F0A500';   // vivid amber
const DEFAULT_SOFT      = '#FFB833';   // --color-accent-soft
const DEFAULT_DARK      = '#C88400';   // --color-accent-dark
const DEFAULT_GLOW      = 'rgba(240, 165, 0, 0.15)';
const DEFAULT_SECONDARY = '#22D3A7';   // bright mint

// ── Hex ↔ RGB ↔ HSL helpers ────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

// ── WCAG relative luminance & contrast helpers ──────────────────────────────

/**
 * Calculate WCAG 2.1 relative luminance for a hex color.
 * Returns a value between 0 (black) and 1 (white).
 *
 * @param {string} hex  – e.g. "#3B82F6"
 * @returns {number}
 */
export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  // Convert sRGB channels to linear light
  const linearize = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Return the appropriate text color (white or near-black) for a given
 * background color, based on WCAG contrast thresholds.
 *
 * @param {string} bgHex  – background color, e.g. "#F0A500"
 * @returns {string}  '#FFFFFF' or '#1D1D1F'
 */
export function textOnColor(bgHex) {
  return relativeLuminance(bgHex) > 0.179 ? '#1D1D1F' : '#FFFFFF';
}

// ── Color harmony & validation ───────────────────────────────────────────────

/**
 * Calculate WCAG 2.1 contrast ratio between two hex colors.
 * Returns a value between 1 (no contrast) and 21 (max contrast).
 */
export function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Analyze a primary + secondary color pair and return diagnostics + fixes.
 *
 * Checks:
 *  - Primary too dark for dark-mode UI (won't stand out against dark backgrounds)
 *  - Primary too desaturated (will look muddy/gray)
 *  - Primary and secondary too similar (hue within 30°)
 *  - Primary and secondary have poor contrast between each other
 *  - Colors that won't pass WCAG AA on dark (#0B0F1A) or light (#FAFAF8) surfaces
 *
 * Returns { ok, warnings[], suggestions: { primary?, secondary? } }
 */
export function analyzeColorPair(primaryHex, secondaryHex) {
  const warnings = [];
  const suggestions = {};

  const pHsl = hexToHsl(primaryHex);
  const sHsl = secondaryHex ? hexToHsl(secondaryHex) : null;

  // Dark-mode surface for contrast check
  const darkSurface = '#0B0F1A';
  const lightSurface = '#FAFAF8';

  // ── Primary checks ────────────────────────────────────────────────────

  // Too dark — won't show on dark backgrounds
  if (pHsl.l < 30) {
    warnings.push({
      type: 'primary_too_dark',
      message: 'Primary color is too dark — it won\'t stand out on dark backgrounds',
    });
    // Suggest brightened version
    suggestions.primary = hslToHex(pHsl.h, Math.min(100, pHsl.s * 1.2), 50);
  }

  // Too desaturated — will look gray/muddy
  if (pHsl.s < 20 && pHsl.l > 10 && pHsl.l < 90) {
    warnings.push({
      type: 'primary_low_saturation',
      message: 'Primary color has very low saturation — it may look washed out',
    });
    suggestions.primary = suggestions.primary || hslToHex(pHsl.h, 60, pHsl.l);
  }

  // Poor contrast on dark surface (WCAG AA needs 4.5:1 for text, 3:1 for large text)
  const darkContrast = contrastRatio(primaryHex, darkSurface);
  if (darkContrast < 3) {
    warnings.push({
      type: 'primary_low_dark_contrast',
      message: `Low contrast on dark mode (${darkContrast.toFixed(1)}:1) — needs at least 3:1`,
    });
    // Lighten until we hit 3:1
    let fixL = pHsl.l;
    while (fixL < 95) {
      fixL += 3;
      const candidate = hslToHex(pHsl.h, pHsl.s, fixL);
      if (contrastRatio(candidate, darkSurface) >= 3.5) {
        suggestions.primary = candidate;
        break;
      }
    }
  }

  // ── Secondary checks (if provided) ────────────────────────────────────

  if (sHsl) {
    // Too similar hue (within 30°)
    const hueDiff = Math.min(
      Math.abs(pHsl.h - sHsl.h),
      360 - Math.abs(pHsl.h - sHsl.h),
    );
    if (hueDiff < 30) {
      warnings.push({
        type: 'colors_too_similar',
        message: 'Primary and secondary are too similar — they won\'t be distinguishable',
      });
      // Suggest a complementary-ish offset
      suggestions.secondary = hslToHex((pHsl.h + 150) % 360, 60, 55);
    }

    // Secondary too dark for dark mode
    if (sHsl.l < 30) {
      warnings.push({
        type: 'secondary_too_dark',
        message: 'Secondary color is too dark for dark-mode backgrounds',
      });
      suggestions.secondary = suggestions.secondary || hslToHex(sHsl.h, Math.min(100, sHsl.s * 1.2), 50);
    }

    // Low contrast between primary and secondary themselves
    const pairContrast = contrastRatio(primaryHex, secondaryHex);
    if (pairContrast < 1.5) {
      warnings.push({
        type: 'pair_low_contrast',
        message: 'Primary and secondary look almost identical together',
      });
      if (!suggestions.secondary) {
        suggestions.secondary = hslToHex((pHsl.h + 150) % 360, 60, 55);
      }
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    suggestions,
    contrast: {
      primaryOnDark: contrastRatio(primaryHex, darkSurface),
      primaryOnLight: contrastRatio(primaryHex, lightSurface),
      ...(secondaryHex ? {
        secondaryOnDark: contrastRatio(secondaryHex, darkSurface),
        secondaryOnLight: contrastRatio(secondaryHex, lightSurface),
      } : {}),
    },
  };
}

/**
 * Auto-fix a color pair by applying all suggestions from analyzeColorPair.
 * Returns { primary, secondary } with corrected values (or originals if no issues).
 */
export function autoHarmonize(primaryHex, secondaryHex = null) {
  const effectivePrimary = primaryHex;
  const effectiveSecondary = secondaryHex || hslToHex((hexToHsl(primaryHex).h + 150) % 360, 60, 55);

  const analysis = analyzeColorPair(effectivePrimary, effectiveSecondary);

  return {
    primary: analysis.suggestions.primary || effectivePrimary,
    secondary: analysis.suggestions.secondary || effectiveSecondary,
    wasAdjusted: !analysis.ok,
    warnings: analysis.warnings,
  };
}

// ── Palette generation ──────────────────────────────────────────────────────

/**
 * Generate a full theme palette from a primary hex color and an optional
 * secondary hex color. If no secondary is provided, one is auto-derived
 * from the complementary region of the color wheel.
 *
 * @param {string}      hex           – primary brand color, e.g. "#F0A500"
 * @param {string|null} secondaryHex  – optional secondary, e.g. "#22D3A7"
 * @returns {Object}  Full palette object with accent, surface, and text tokens
 */
export function generatePalette(hex, secondaryHex = null) {
  const { h, s, l } = hexToHsl(hex);
  const { r, g, b }  = hexToRgb(hex);

  // ── Accent shades ──────────────────────────────────────────────────────
  const primary       = hex;
  const primaryLight  = hslToHex(h, s, Math.min(100, l + l * 0.20));
  const primaryDark   = hslToHex(h, s, Math.max(0,   l - l * 0.20));
  const primaryMuted  = `rgba(${r}, ${g}, ${b}, 0.50)`;
  const primarySubtle = `rgba(${r}, ${g}, ${b}, 0.15)`;

  // ── Text on primary (WCAG auto contrast) ───────────────────────────────
  const txtOnPrimary = textOnColor(hex);

  // ── Surface tints — dark mode ──────────────────────────────────────────
  // Use the brand hue at 8% saturation so dark backgrounds get a subtle
  // warm or cool cast that feels cohesive with the brand.
  const surfaceBase     = hslToHex(h, 8, 6);   // page background
  const surfaceDeep     = hslToHex(h, 8, 4);   // deepest background
  const surfaceCard     = hslToHex(h, 8, 10);  // card background
  const surfaceElevated = hslToHex(h, 8, 14);  // elevated surfaces / popovers
  const surfaceInput    = hslToHex(h, 8, 18);  // input fields / wells
  // Nav bar: semi-transparent for backdrop-blur layering
  const { r: nr, g: ng, b: nb } = hexToRgb(hslToHex(h, 8, 6));
  const surfaceNav = `rgba(${nr}, ${ng}, ${nb}, 0.92)`;

  // ── Surface tints — light mode ─────────────────────────────────────────
  // Same hue at very low saturation and very high lightness (3-5% sat,
  // 96-98% lightness) so light-mode pages aren't pure white.
  const lightSurfaceBase      = hslToHex(h, 5, 98);
  const lightSurfaceCard      = hslToHex(h, 4, 100); // near-white with tiny tint
  const lightSurfaceSecondary = hslToHex(h, 5, 96);

  // ── Secondary color ────────────────────────────────────────────────────
  // If no secondary is provided, derive one from the complementary region
  // (150 degrees offset for an analogous-complementary split).
  const secondary = secondaryHex || hslToHex((h + 150) % 360, 60, 55);
  const secHsl = hexToHsl(secondary);
  const secondaryLight = hslToHex(secHsl.h, secHsl.s, Math.min(100, secHsl.l + secHsl.l * 0.20));
  const secondaryDark  = hslToHex(secHsl.h, secHsl.s, Math.max(0,   secHsl.l - secHsl.l * 0.20));

  return {
    // Accent
    primary,
    primaryLight,
    primaryDark,
    primaryMuted,
    primarySubtle,

    // Text on primary
    textOnPrimary: txtOnPrimary,

    // Dark-mode surfaces
    surfaceBase,
    surfaceDeep,
    surfaceCard,
    surfaceElevated,
    surfaceInput,
    surfaceNav,

    // Light-mode surfaces
    lightSurfaceBase,
    lightSurfaceCard,
    lightSurfaceSecondary,

    // Secondary
    secondary,
    secondaryLight,
    secondaryDark,
  };
}

// ── CSS variable injection ──────────────────────────────────────────────────

/**
 * Apply dark-mode surface tokens as CSS custom properties.
 */
function applySurfacesDark(root, palette) {
  root.style.setProperty('--color-surface-base',     palette.surfaceBase);
  root.style.setProperty('--color-surface-deep',     palette.surfaceDeep);
  root.style.setProperty('--color-surface-card',     palette.surfaceCard);
  root.style.setProperty('--color-surface-elevated', palette.surfaceElevated);
  root.style.setProperty('--color-surface-input',    palette.surfaceInput);
  root.style.setProperty('--color-surface-nav',      palette.surfaceNav);

  // Mirror to --color-bg-* aliases used by components after light-mode refactor
  root.style.setProperty('--color-bg-primary',       palette.surfaceBase);
  root.style.setProperty('--color-bg-deep',          palette.surfaceDeep);
  root.style.setProperty('--color-bg-card',          palette.surfaceCard);
  root.style.setProperty('--color-bg-secondary',     palette.surfaceCard);
  root.style.setProperty('--color-bg-elevated',      palette.surfaceElevated);
  root.style.setProperty('--color-bg-input',         palette.surfaceInput);
  root.style.setProperty('--color-bg-nav',           palette.surfaceNav);
}

/**
 * Apply light-mode surface tokens as CSS custom properties.
 */
function applySurfacesLight(root, palette) {
  root.style.setProperty('--color-surface-base',     palette.lightSurfaceBase);
  root.style.setProperty('--color-surface-deep',     palette.lightSurfaceBase);
  root.style.setProperty('--color-surface-card',     palette.lightSurfaceCard);
  root.style.setProperty('--color-surface-elevated', palette.lightSurfaceCard);
  root.style.setProperty('--color-surface-input',    palette.lightSurfaceSecondary);
  root.style.setProperty('--color-surface-nav',      palette.lightSurfaceBase);

  // Mirror to --color-bg-* aliases used by components after light-mode refactor
  root.style.setProperty('--color-bg-primary',       palette.lightSurfaceBase);
  root.style.setProperty('--color-bg-deep',          palette.lightSurfaceBase);
  root.style.setProperty('--color-bg-card',          palette.lightSurfaceCard);
  root.style.setProperty('--color-bg-secondary',     palette.lightSurfaceSecondary);
  root.style.setProperty('--color-bg-elevated',      palette.lightSurfaceCard);
  root.style.setProperty('--color-bg-input',         palette.lightSurfaceSecondary);
  root.style.setProperty('--color-bg-nav',           palette.lightSurfaceBase);
}

/**
 * Read a gym's brand config and apply the full palette as CSS custom
 * properties on :root.
 *
 * @param {{ primaryColor?: string, secondaryColor?: string, accentColor?: string, surfaceColor?: string }} brandConfig
 */
export function applyGymTheme(brandConfig) {
  if (!brandConfig) return;

  const base = brandConfig.primaryColor || brandConfig.accentColor;
  if (!base) return;

  const palette = generatePalette(base, brandConfig.secondaryColor || null);
  const root = document.documentElement;

  // ── Accent tokens ────────────────────────────────────────────────────
  root.style.setProperty('--color-accent',           palette.primary);
  root.style.setProperty('--color-accent-soft',      palette.primaryLight);
  root.style.setProperty('--color-accent-dark',      palette.primaryDark);
  root.style.setProperty('--color-accent-glow',      palette.primarySubtle);
  root.style.setProperty('--shadow-glow',            `0 0 20px ${palette.primarySubtle}`);
  root.style.setProperty('--color-text-on-accent',   palette.textOnPrimary);

  // ── Surface tokens (mode-aware) ──────────────────────────────────────
  // If the <html> element has a "dark" class we apply dark surfaces;
  // otherwise we apply light surfaces.
  if (root.classList.contains('dark')) {
    applySurfacesDark(root, palette);
  } else {
    applySurfacesLight(root, palette);
  }

  // ── Secondary / success ──────────────────────────────────────────────
  root.style.setProperty('--color-success',          palette.secondary);
  root.style.setProperty('--color-secondary',        palette.secondary);
  root.style.setProperty('--color-secondary-light',  palette.secondaryLight);
  root.style.setProperty('--color-secondary-dark',   palette.secondaryDark);
}

/**
 * Restore the default Obsidian & Amber palette.
 *
 * Primary:   #F0A500 (vivid amber)
 * Secondary: #22D3A7 (bright mint)
 */
export function resetToDefault() {
  const root = document.documentElement;

  // Accent
  root.style.setProperty('--color-accent',           DEFAULT_PRIMARY);
  root.style.setProperty('--color-accent-soft',      DEFAULT_SOFT);
  root.style.setProperty('--color-accent-dark',      DEFAULT_DARK);
  root.style.setProperty('--color-accent-glow',      DEFAULT_GLOW);
  root.style.setProperty('--shadow-glow',            `0 0 20px ${DEFAULT_GLOW}`);
  root.style.setProperty('--color-text-on-accent',   textOnColor(DEFAULT_PRIMARY));

  // Surfaces — mode-aware (same logic as applyGymTheme)
  const palette = generatePalette(DEFAULT_PRIMARY, DEFAULT_SECONDARY);
  if (root.classList.contains('dark')) {
    applySurfacesDark(root, palette);
  } else {
    applySurfacesLight(root, palette);
  }

  // Secondary
  root.style.setProperty('--color-success',          DEFAULT_SECONDARY);
  root.style.setProperty('--color-secondary',        DEFAULT_SECONDARY);
  root.style.setProperty('--color-secondary-light',  palette.secondaryLight);
  root.style.setProperty('--color-secondary-dark',   palette.secondaryDark);
}
