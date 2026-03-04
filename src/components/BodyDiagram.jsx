import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((r) => [r.id, r])
);

// Map muscle region IDs → image filenames in /public/muscles/
// Add a new entry here each time a new PNG is generated
const MUSCLE_IMAGES = {
  // ── Chest ──────────────────────────────
  // upper_chest:  '/muscles/upper_chest.png',
  // mid_chest:    '/muscles/mid_chest.png',
  // lower_chest:  '/muscles/lower_chest.png',

  // ── Shoulders ──────────────────────────
  // front_delts:  '/muscles/front_delts.png',
  // side_delts:   '/muscles/side_delts.png',
  // rear_delts:   '/muscles/rear_delts.png',

  // ── Arms ───────────────────────────────
  // biceps:       '/muscles/biceps.png',
  // triceps:      '/muscles/triceps.png',
  // forearms:     '/muscles/forearms.png',
  // brachialis:   '/muscles/brachialis.png',

  // ── Core ───────────────────────────────
  // upper_abs:    '/muscles/upper_abs.png',
  // mid_abs:      '/muscles/mid_abs.png',
  // lower_abs:    '/muscles/lower_abs.png',
  // obliques:     '/muscles/obliques.png',
  // serratus:     '/muscles/serratus.png',
  // abs:          '/muscles/abs.png',

  // ── Back ───────────────────────────────
  // traps:        '/muscles/traps.png',
  // upper_back:   '/muscles/upper_back.png',
  // mid_back:     '/muscles/mid_back.png',
  // lats:         '/muscles/lats.png',
  // lower_back:   '/muscles/lower_back.png',

  // ── Glutes ─────────────────────────────
  glutes:        '/muscles/glutes.png',
  // glute_med:    '/muscles/glute_med.png',

  // ── Upper Legs ─────────────────────────
  quads:         '/muscles/quads.png',
  hamstrings:    '/muscles/hamstrings.png',
  adductors:     '/muscles/adductors.png',
  abductors:     '/muscles/abductors.png',
  // hip_flexors:  '/muscles/hip_flexors.png',

  // ── Lower Legs ─────────────────────────
  calves:        '/muscles/calves.png',
  // soleus:       '/muscles/soleus.png',
  // tibialis:     '/muscles/tibialis.png',
};

// Pick any available image as the base body (they all share the same figure)
const BASE_IMAGE = MUSCLE_IMAGES.hamstrings || MUSCLE_IMAGES.quads || Object.values(MUSCLE_IMAGES)[0];

export default function BodyDiagram({
  primaryRegions   = [],
  secondaryRegions = [],
  title   = 'Muscles worked',
  compact = false,
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

  return (
    <div
      className="rounded-[12px] overflow-hidden"
      style={{ padding: compact ? '0.875rem' : '1.25rem', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)' }}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-[0.12em]">{title}</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Primary',   bg: 'rgba(212,175,55,0.12)', border: 'rgba(212,175,55,0.30)', swatch: '#D4AF37' },
            { label: 'Secondary', bg: 'rgba(212,175,55,0.06)', border: 'rgba(212,175,55,0.16)', swatch: 'rgba(212,175,55,0.45)' },
          ].map(({ label, bg, border, swatch }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#6B7280]"
                  style={{ background: bg, border: `1px solid ${border}` }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Layered image composite */}
      <div className="relative w-full overflow-hidden rounded-lg bg-white" style={{ height }}>
        {/* Base body — always shown */}
        {BASE_IMAGE && (
          <img
            src={BASE_IMAGE}
            alt="Body diagram"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ opacity: 0.35 }}
          />
        )}

        {/* Primary muscle layers — full opacity gold */}
        {primaryLayers.map(id => (
          <img
            key={`primary-${id}`}
            src={MUSCLE_IMAGES[id]}
            alt={regionMeta[id]?.label ?? id}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ mixBlendMode: 'darken' }}
          />
        ))}

        {/* Secondary muscle layers — faded gold */}
        {secondaryLayers.map(id => (
          <img
            key={`secondary-${id}`}
            src={MUSCLE_IMAGES[id]}
            alt={regionMeta[id]?.label ?? id}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ mixBlendMode: 'darken', opacity: 0.5 }}
          />
        ))}
      </div>

      {/* Muscle tags */}
      {visibleRegions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {visibleRegions.map((regionId) => {
            const isPrimary = primarySet.has(regionId);
            const hasImage  = !!MUSCLE_IMAGES[regionId];
            return (
              <span key={regionId} className="text-[11px] px-2.5 py-1 rounded-full"
                    style={{
                      background: isPrimary ? 'rgba(212,175,55,0.12)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.30)' : 'rgba(0,0,0,0.10)'}`,
                      color: isPrimary ? '#9A7010' : '#6B7280',
                      opacity: hasImage ? 1 : 0.5,
                    }}>
                {regionMeta[regionId]?.label ?? regionId}
                {!hasImage && ' *'}
              </span>
            );
          })}
        </div>
      )}

      {/* Warning if some muscles don't have images yet */}
      {(missingPrimary.length > 0 || missingSecondary.length > 0) && (
        <p className="text-[10px] text-[#9CA3AF] mt-2">* image not yet generated</p>
      )}
    </div>
  );
}
