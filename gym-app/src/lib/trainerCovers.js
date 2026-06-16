// Curated cover "portadas" a trainer can pick instead of uploading their own
// photo. Stored in profiles.trainer_cover_url as a `preset:<id>` sentinel, so
// the SAME column powers both uploaded photos (a full URL) and presets — and
// every cover render path resolves through coverBackground() below, so a preset
// never leaks through as a broken `url(preset:teal)`.

export const DEFAULT_COVER_CSS =
  'linear-gradient(135deg, #FFB86B 0%, #FF7A3D 60%, #FF5A2E 100%)';

// Premium, brand-friendly gradients (warm → cool → neutral) so trainers get
// real variety without us hosting any image assets. The cover render adds a
// soft radial sheen on top, so these are kept as clean base gradients.
export const COVER_PRESETS = [
  { id: 'sunset',   css: 'linear-gradient(135deg, #FFB86B 0%, #FF7A3D 60%, #FF5A2E 100%)' },
  { id: 'teal',     css: 'linear-gradient(135deg, #2DD4BF 0%, #1E9C8E 55%, #134E4A 100%)' },
  { id: 'ocean',    css: 'linear-gradient(135deg, #60A5FA 0%, #2563EB 55%, #1E3A8A 100%)' },
  { id: 'indigo',   css: 'linear-gradient(135deg, #818CF8 0%, #4F46E5 55%, #312E81 100%)' },
  { id: 'violet',   css: 'linear-gradient(135deg, #C084FC 0%, #7C3AED 55%, #4C1D95 100%)' },
  { id: 'magenta',  css: 'linear-gradient(135deg, #F0ABFC 0%, #DB2777 55%, #9D174E 100%)' },
  { id: 'crimson',  css: 'linear-gradient(135deg, #FB7185 0%, #E11D48 55%, #9F1239 100%)' },
  { id: 'emerald',  css: 'linear-gradient(135deg, #6EE7B7 0%, #10B981 55%, #047857 100%)' },
  { id: 'amber',    css: 'linear-gradient(135deg, #FCD34D 0%, #F59E0B 55%, #B45309 100%)' },
  { id: 'graphite', css: 'linear-gradient(135deg, #64748B 0%, #334155 55%, #0F172A 100%)' },
  { id: 'midnight', css: 'linear-gradient(135deg, #334155 0%, #1E293B 55%, #020617 100%)' },
  { id: 'rose',     css: 'linear-gradient(135deg, #FDA4AF 0%, #FB7185 50%, #BE123C 100%)' },
];

const PRESET_BY_ID = Object.fromEntries(COVER_PRESETS.map((p) => [p.id, p]));

const PRESET_PREFIX = 'preset:';

export function isPresetCover(v) {
  return typeof v === 'string' && v.startsWith(PRESET_PREFIX);
}

// A real uploaded photo (a URL), as opposed to a preset sentinel or empty.
export function isPhotoCover(v) {
  return typeof v === 'string' && v.length > 0 && !isPresetCover(v);
}

export function presetId(v) {
  return isPresetCover(v) ? v.slice(PRESET_PREFIX.length) : null;
}

export function presetValue(id) {
  return `${PRESET_PREFIX}${id}`;
}

// The CSS `background` for any stored cover value. Photos get the default
// gradient layered underneath so a slow/broken image still shows brand color
// instead of a flash of nothing.
export function coverBackground(v) {
  if (isPresetCover(v)) {
    return PRESET_BY_ID[presetId(v)]?.css || DEFAULT_COVER_CSS;
  }
  if (isPhotoCover(v)) {
    return `url("${v}") center/cover no-repeat, ${DEFAULT_COVER_CSS}`;
  }
  return DEFAULT_COVER_CSS;
}
