import { useTranslation } from 'react-i18next';
import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((r) => [r.id, r])
);

// Map muscle region IDs → front/back image filenames in /public/muscles/
// All images are 440×800 WebP with transparent backgrounds for layering
const MUSCLE_IMAGES_FRONT = {
  upper_chest:  '/muscles/upper_chest.webp',
  mid_chest:    '/muscles/mid_chest.webp',
  lower_chest:  '/muscles/lower_chest.webp',
  front_delts:  '/muscles/front_delts.webp',
  biceps:       '/muscles/biceps.webp',
  forearms:     '/muscles/forearms_front.webp',
  upper_abs:    '/muscles/upper_abs.webp',
  mid_abs:      '/muscles/mid_abs.webp',
  lower_abs:    '/muscles/lower_abs.webp',
  obliques:     '/muscles/obliques.webp',
  traps:        '/muscles/traps_front.webp',
  quads:        '/muscles/quads.webp',
  calves:       '/muscles/calves_front.webp',
  abductors:    '/muscles/abductors_front.webp',
  adductors:    '/muscles/adductors.webp',
};

const MUSCLE_IMAGES_BACK = {
  rear_delts:   '/muscles/rear_delts.webp',
  triceps:      '/muscles/triceps.webp',
  forearms:     '/muscles/forearms_back.webp',
  traps:        '/muscles/traps_back.webp',
  upper_back:   '/muscles/upper_back.webp',
  lats:         '/muscles/lats.webp',
  lower_back:   '/muscles/lower_back.webp',
  glutes:       '/muscles/glutes.webp',
  hamstrings:   '/muscles/hamstrings.webp',
  calves:       '/muscles/calves_back.webp',
  abductors:    '/muscles/abductors_back.webp',
  adductors:    '/muscles/adductors_back.webp',
};

// Fallback aliases for region IDs that lack a dedicated image
const MUSCLE_ALIASES = {
  side_delts:      'front_delts',
  rear_delts_front:'front_delts',
  brachialis:      'biceps',
  serratus:        'obliques',
  abs:             'mid_abs',
  mid_back:        'upper_back',
  glute_med:       'glutes',
  hip_flexors:     'quads',
  soleus:          'calves',
  tibialis:        'calves',
};

// Combined lookup (front takes priority for regions that exist in both)
const _MUSCLE_IMAGES_RAW = { ...MUSCLE_IMAGES_BACK, ...MUSCLE_IMAGES_FRONT };

// Resolve an image path: direct hit first, then alias fallback
function resolveMuscleImage(id) {
  return _MUSCLE_IMAGES_RAW[id] || _MUSCLE_IMAGES_RAW[MUSCLE_ALIASES[id]] || null;
}

// Build complete lookup including aliases so every region ID maps to an image
const MUSCLE_IMAGES = { ..._MUSCLE_IMAGES_RAW };
for (const [alias, target] of Object.entries(MUSCLE_ALIASES)) {
  if (!MUSCLE_IMAGES[alias] && _MUSCLE_IMAGES_RAW[target]) {
    MUSCLE_IMAGES[alias] = _MUSCLE_IMAGES_RAW[target];
  }
}

// Also populate the front/back maps with aliases so filtering works
for (const [alias, target] of Object.entries(MUSCLE_ALIASES)) {
  if (!MUSCLE_IMAGES_FRONT[alias] && MUSCLE_IMAGES_FRONT[target]) {
    MUSCLE_IMAGES_FRONT[alias] = MUSCLE_IMAGES_FRONT[target];
  }
  if (!MUSCLE_IMAGES_BACK[alias] && MUSCLE_IMAGES_BACK[target]) {
    MUSCLE_IMAGES_BACK[alias] = MUSCLE_IMAGES_BACK[target];
  }
}

const BASE_FRONT = '/muscles/base_front.webp';
const BASE_BACK  = '/muscles/base_back.webp';

export default function BodyDiagram({
  primaryRegions   = [],
  secondaryRegions = [],
  title,
  compact = false,
  inline  = false,
}) {
  const { t } = useTranslation('pages');
  const resolvedTitle = title ?? t('bodyDiagram.musclesWorked');
  const primarySet   = new Set(primaryRegions);
  const secondarySet = new Set(secondaryRegions);
  const visibleRegions = [...primarySet, ...secondarySet];

  // Split layers into front and back views
  const primaryFront   = primaryRegions.filter(id => MUSCLE_IMAGES_FRONT[id]);
  const secondaryFront = secondaryRegions.filter(id => MUSCLE_IMAGES_FRONT[id]);
  const primaryBack    = primaryRegions.filter(id => MUSCLE_IMAGES_BACK[id]);
  const secondaryBack  = secondaryRegions.filter(id => MUSCLE_IMAGES_BACK[id]);

  const hasFrontLayers = primaryFront.length > 0 || secondaryFront.length > 0;
  const hasBackLayers  = primaryBack.length > 0 || secondaryBack.length > 0;

  // Backwards compat
  const primaryLayers   = primaryRegions.filter(id => MUSCLE_IMAGES[id]);
  const secondaryLayers = secondaryRegions.filter(id => MUSCLE_IMAGES[id]);

  const height = compact ? 180 : 280;

  /* ── Inline mode: seamless integration inside exercise cards ─────────────── */
  if (inline) {
    return (
      <div>
        {/* Header + legend row */}
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5B6276]">{resolvedTitle}</p>
          <div className="flex gap-3">
            {[
              { label: t('exerciseLibrary.primary'),   color: '#D4AF37' },
              { label: t('exerciseLibrary.secondary'), color: 'rgba(212,175,55,0.4)' },
            ].map(({ label, color }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[10px] text-[#5B6276]">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Diagram — front and back side by side, natural colors on dark bg */}
        <div
          className="flex gap-1 w-full overflow-hidden rounded-[12px] select-none"
          style={{ height, background: 'var(--color-bg-primary)' }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Front view */}
          <div className="relative flex-1">
            <img src={BASE_FRONT} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.6, WebkitUserDrag: 'none' }} />
            {primaryFront.map(id => (
              <img key={`pf-${id}`} src={MUSCLE_IMAGES_FRONT[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.9, WebkitUserDrag: 'none' }} />
            ))}
            {secondaryFront.map(id => (
              <img key={`sf-${id}`} src={MUSCLE_IMAGES_FRONT[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.45, WebkitUserDrag: 'none' }} />
            ))}
          </div>
          {/* Back view */}
          <div className="relative flex-1">
            <img src={BASE_BACK} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.6, WebkitUserDrag: 'none' }} />
            {primaryBack.map(id => (
              <img key={`pb-${id}`} src={MUSCLE_IMAGES_BACK[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.9, WebkitUserDrag: 'none' }} />
            ))}
            {secondaryBack.map(id => (
              <img key={`sb-${id}`} src={MUSCLE_IMAGES_BACK[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.45, WebkitUserDrag: 'none' }} />
            ))}
          </div>
          <div className="absolute inset-0 pointer-events-none" onContextMenu={(e) => e.preventDefault()} />
        </div>

        {/* Muscle tags — refined pills */}
        {visibleRegions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {visibleRegions.map((regionId) => {
              const isPrimary = primarySet.has(regionId);
              return (
                <span
                  key={regionId}
                  className="text-[10.5px] font-medium px-2.5 py-[3px] rounded-md"
                  style={{
                    background: isPrimary ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.04)',
                    color: isPrimary ? '#C9A84C' : '#5B6276',
                    border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {t(`exerciseLibrary.regionNames.${regionId}`, regionMeta[regionId]?.label ?? regionId)}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ── Default mode: standalone card (used outside exercise cards) ──────────── */
  return (
    <div
      className="rounded-[12px] overflow-hidden bg-[var(--color-bg-card)] border border-white/10"
      style={{ padding: compact ? '0.875rem' : '1.25rem' }}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.12em]">{resolvedTitle}</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: t('exerciseLibrary.primary'),   bg: 'rgba(212,175,55,0.12)', border: 'rgba(212,175,55,0.30)', swatch: '#D4AF37' },
            { label: t('exerciseLibrary.secondary'), bg: 'rgba(212,175,55,0.06)', border: 'rgba(212,175,55,0.16)', swatch: 'rgba(212,175,55,0.45)' },
          ].map(({ label, bg, border, swatch }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[var(--color-text-muted)]"
                  style={{ background: bg, border: `1px solid ${border}` }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Layered image composite — front and back side by side, natural colors */}
      <div
        className="flex gap-1 w-full overflow-hidden rounded-lg select-none"
        style={{ height, background: 'var(--color-bg-primary)' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative flex-1">
          <img src={BASE_FRONT} alt="" draggable={false}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ opacity: 0.6, WebkitUserDrag: 'none' }} />
          {primaryFront.map(id => (
            <img key={`pf-${id}`} src={MUSCLE_IMAGES_FRONT[id]} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.9, WebkitUserDrag: 'none' }} />
          ))}
          {secondaryFront.map(id => (
            <img key={`sf-${id}`} src={MUSCLE_IMAGES_FRONT[id]} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.45, WebkitUserDrag: 'none' }} />
          ))}
        </div>
        <div className="relative flex-1">
          <img src={BASE_BACK} alt="" draggable={false}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{ opacity: 0.6, WebkitUserDrag: 'none' }} />
          {primaryBack.map(id => (
            <img key={`pb-${id}`} src={MUSCLE_IMAGES_BACK[id]} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.9, WebkitUserDrag: 'none' }} />
          ))}
          {secondaryBack.map(id => (
            <img key={`sb-${id}`} src={MUSCLE_IMAGES_BACK[id]} alt="" draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.45, WebkitUserDrag: 'none' }} />
          ))}
        </div>
        <div className="absolute inset-0 pointer-events-none" onContextMenu={(e) => e.preventDefault()} />
      </div>

      {/* Muscle tags */}
      {visibleRegions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {visibleRegions.map((regionId) => {
            const isPrimary = primarySet.has(regionId);
            return (
              <span
                key={regionId}
                className={`text-[11px] px-2.5 py-1 rounded-full ${
                  isPrimary
                    ? 'bg-amber-900/40 border border-amber-700 text-amber-300'
                    : 'bg-white/10 border border-white/10 text-[var(--color-text-muted)]'
                }`}
              >
                {t(`exerciseLibrary.regionNames.${regionId}`, regionMeta[regionId]?.label ?? regionId)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
