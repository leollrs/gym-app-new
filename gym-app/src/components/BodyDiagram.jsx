import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((r) => [r.id, r])
);

// Map muscle region IDs → image filenames in /public/muscles/
// Add a new entry here each time a new PNG is generated
const MUSCLE_IMAGES = {
  // ── Chest ──────────────────────────────
  upper_chest:  '/muscles/upper_chest.webp',
  mid_chest:    '/muscles/mid_chest.webp',
  lower_chest:  '/muscles/lower_chest.webp',

  // ── Shoulders ──────────────────────────
  front_delts:  '/muscles/front_delts.webp',
  // side_delts:   '/muscles/side_delts.webp',
  // rear_delts:   '/muscles/rear_delts.webp',

  // ── Arms ───────────────────────────────
  // biceps:       '/muscles/biceps.webp',
  triceps:      '/muscles/triceps.webp',
  // forearms:     '/muscles/forearms.webp',
  // brachialis:   '/muscles/brachialis.webp',

  // ── Core ───────────────────────────────
  // upper_abs:    '/muscles/upper_abs.webp',
  // mid_abs:      '/muscles/mid_abs.webp',
  // lower_abs:    '/muscles/lower_abs.webp',
  // obliques:     '/muscles/obliques.webp',
  // serratus:     '/muscles/serratus.webp',
  // abs:          '/muscles/abs.webp',

  // ── Back ───────────────────────────────
  // traps:        '/muscles/traps.webp',
  // upper_back:   '/muscles/upper_back.webp',
  // mid_back:     '/muscles/mid_back.webp',
  // lats:         '/muscles/lats.webp',
  // lower_back:   '/muscles/lower_back.webp',

  // ── Glutes ─────────────────────────────
  glutes:        '/muscles/glutes.webp',
  // glute_med:    '/muscles/glute_med.webp',

  // ── Upper Legs ─────────────────────────
  quads:         '/muscles/quads.webp',
  hamstrings:    '/muscles/hamstrings.webp',
  adductors:     '/muscles/adductors.webp',
  abductors:     '/muscles/abductors.webp',
  // hip_flexors:  '/muscles/hip_flexors.webp',

  // ── Lower Legs ─────────────────────────
  calves:        '/muscles/calves.webp',
  // soleus:       '/muscles/soleus.webp',
  // tibialis:     '/muscles/tibialis.webp',
};

// Pick any available image as the base body (they all share the same figure)
const BASE_IMAGE = MUSCLE_IMAGES.hamstrings || MUSCLE_IMAGES.quads || Object.values(MUSCLE_IMAGES)[0];

export default function BodyDiagram({
  primaryRegions   = [],
  secondaryRegions = [],
  title   = 'Muscles worked',
  compact = false,
  inline  = false,
}) {
  const primarySet   = new Set(primaryRegions);
  const secondarySet = new Set(secondaryRegions);
  const visibleRegions = [...primarySet, ...secondarySet];

  // Regions that have an image available
  const primaryLayers   = primaryRegions.filter(id => MUSCLE_IMAGES[id]);
  const secondaryLayers = secondaryRegions.filter(id => MUSCLE_IMAGES[id]);

  // Regions that don't have an image yet (show as text tags only)
  const missingPrimary   = primaryRegions.filter(id => !MUSCLE_IMAGES[id]);
  const missingSecondary = secondaryRegions.filter(id => !MUSCLE_IMAGES[id]);

  const height = compact ? 180 : 280;

  /* ── Inline mode: seamless integration inside exercise cards ─────────────── */
  if (inline) {
    return (
      <div>
        {/* Header + legend row */}
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5B6276]">{title}</p>
          <div className="flex gap-3">
            {[
              { label: 'Primary',   color: '#D4AF37' },
              { label: 'Secondary', color: 'rgba(212,175,55,0.4)' },
            ].map(({ label, color }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[10px] text-[#5B6276]">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Diagram — clean, no extra borders */}
        <div
          className="relative w-full overflow-hidden rounded-[12px] select-none"
          style={{ height, background: '#080B12' }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute inset-0 invert">
            {BASE_IMAGE && (
              <img src={BASE_IMAGE} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.35, WebkitUserDrag: 'none' }} />
            )}
            {primaryLayers.map(id => (
              <img key={`primary-${id}`} src={MUSCLE_IMAGES[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ mixBlendMode: 'darken', WebkitUserDrag: 'none' }} />
            ))}
            {secondaryLayers.map(id => (
              <img key={`secondary-${id}`} src={MUSCLE_IMAGES[id]} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ mixBlendMode: 'darken', opacity: 0.5, WebkitUserDrag: 'none' }} />
            ))}
          </div>
          <div className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
        </div>

        {/* Muscle tags — refined pills */}
        {visibleRegions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {visibleRegions.map((regionId) => {
              const isPrimary = primarySet.has(regionId);
              const hasImage  = !!MUSCLE_IMAGES[regionId];
              return (
                <span
                  key={regionId}
                  className="text-[10.5px] font-medium px-2.5 py-[3px] rounded-md"
                  style={{
                    background: isPrimary ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.04)',
                    color: isPrimary ? '#C9A84C' : '#5B6276',
                    border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.06)'}`,
                    opacity: hasImage ? 1 : 0.55,
                  }}
                >
                  {regionMeta[regionId]?.label ?? regionId}
                  {!hasImage && ' *'}
                </span>
              );
            })}
          </div>
        )}

        {(missingPrimary.length > 0 || missingSecondary.length > 0) && (
          <p className="text-[10px] text-[#4B5563] mt-1.5">* image not yet generated</p>
        )}
      </div>
    );
  }

  /* ── Default mode: standalone card (used outside exercise cards) ──────────── */
  return (
    <div
      className="rounded-[12px] overflow-hidden bg-slate-800 border border-white/10"
      style={{ padding: compact ? '0.875rem' : '1.25rem' }}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.12em]">{title}</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Primary',   bg: 'rgba(212,175,55,0.12)', border: 'rgba(212,175,55,0.30)', swatch: '#D4AF37' },
            { label: 'Secondary', bg: 'rgba(212,175,55,0.06)', border: 'rgba(212,175,55,0.16)', swatch: 'rgba(212,175,55,0.45)' },
          ].map(({ label, bg, border, swatch }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-slate-400"
                  style={{ background: bg, border: `1px solid ${border}` }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Layered image composite */}
      <div
        className="relative w-full overflow-hidden rounded-lg bg-black select-none"
        style={{ height }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="absolute inset-0 invert">
          {BASE_IMAGE && (
            <img
              src={BASE_IMAGE}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ opacity: 0.35, WebkitUserDrag: 'none' }}
            />
          )}

          {primaryLayers.map(id => (
            <img
              key={`primary-${id}`}
              src={MUSCLE_IMAGES[id]}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ mixBlendMode: 'darken', WebkitUserDrag: 'none' }}
            />
          ))}

          {secondaryLayers.map(id => (
            <img
              key={`secondary-${id}`}
              src={MUSCLE_IMAGES[id]}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ mixBlendMode: 'darken', opacity: 0.5, WebkitUserDrag: 'none' }}
            />
          ))}
        </div>

        <div className="absolute inset-0" onContextMenu={(e) => e.preventDefault()} />
      </div>

      {/* Muscle tags */}
      {visibleRegions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {visibleRegions.map((regionId) => {
            const isPrimary = primarySet.has(regionId);
            const hasImage  = !!MUSCLE_IMAGES[regionId];
            return (
              <span
                key={regionId}
                className={`text-[11px] px-2.5 py-1 rounded-full ${
                  isPrimary
                    ? 'bg-amber-900/40 border border-amber-700 text-amber-300'
                    : 'bg-white/10 border border-white/10 text-slate-400'
                }`}
                style={{ opacity: hasImage ? 1 : 0.5 }}
              >
                {regionMeta[regionId]?.label ?? regionId}
                {!hasImage && ' *'}
              </span>
            );
          })}
        </div>
      )}

      {(missingPrimary.length > 0 || missingSecondary.length > 0) && (
        <p className="text-[10px] text-slate-500 mt-2">* image not yet generated</p>
      )}
    </div>
  );
}
