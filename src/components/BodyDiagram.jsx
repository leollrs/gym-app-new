import { useId } from 'react';
import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((r) => [r.id, r])
);

// ── Silhouette (same shape front & back — regions differentiate the view) ────
// Canvas per figure: 160 × 326, center x=80
// Proportions: shoulders ~100px wide, waist ~56px, hips ~66px, arms ~14px, legs ~26px

const ANATOMY = [
  { id: 'head',        parts: [{ type: 'circle', cx: 80, cy: 22, r: 18 }] },
  { id: 'neck',        parts: [{ type: 'path', d: 'M 73 40 L 87 40 L 91 50 L 69 50 Z' }] },
  { id: 'torso',       parts: [{ type: 'path', d: 'M 69 50 L 91 50 L 128 58 C 134 62 136 70 136 80 C 135 98 130 112 124 122 C 118 128 110 132 108 134 C 110 148 112 162 112 178 L 93 178 C 90 174 85 172 80 172 C 75 172 70 174 67 178 L 48 178 C 48 162 50 148 52 134 C 50 132 42 128 36 122 C 30 112 25 98 24 80 C 24 70 26 62 32 58 Z' }] },
  { id: 'arm-upper-L', parts: [{ type: 'path', d: 'M 32 60 C 24 70 18 88 18 108 C 18 118 20 125 22 132 L 32 128 C 30 120 28 112 28 100 C 28 82 30 68 34 60 Z' }] },
  { id: 'arm-fore-L',  parts: [{ type: 'path', d: 'M 22 132 L 32 128 L 30 185 L 20 185 Z' }] },
  { id: 'arm-upper-R', parts: [{ type: 'path', d: 'M 128 60 C 136 70 142 88 142 108 C 142 118 140 125 138 132 L 128 128 C 130 120 132 112 132 100 C 132 82 130 68 126 60 Z' }] },
  { id: 'arm-fore-R',  parts: [{ type: 'path', d: 'M 138 132 L 128 128 L 130 185 L 140 185 Z' }] },
  { id: 'leg-thigh-L', parts: [{ type: 'path', d: 'M 48 178 C 46 198 44 228 44 250 C 44 254 45 257 46 260 L 72 260 C 73 257 74 254 74 250 C 74 228 72 198 70 178 Z' }] },
  { id: 'leg-calf-L',  parts: [{ type: 'path', d: 'M 46 260 L 70 260 L 68 320 L 44 320 Z' }] },
  { id: 'leg-thigh-R', parts: [{ type: 'path', d: 'M 112 178 C 114 198 116 228 116 250 C 116 254 115 257 114 260 L 88 260 C 87 257 86 254 86 250 C 86 228 88 198 90 178 Z' }] },
  { id: 'leg-calf-R',  parts: [{ type: 'path', d: 'M 114 260 L 90 260 L 92 320 L 116 320 Z' }] },
];

// ── Muscle regions ────────────────────────────────────────────────────────────

const FRONT_REGIONS = [
  { id: 'upper_chest', type: 'path',    d: 'M 62 60 C 70 55 90 55 98 60 L 120 68 C 116 80 106 90 94 94 L 66 94 C 54 90 44 80 40 68 Z' },
  { id: 'mid_chest',   type: 'path',    d: 'M 66 94 L 94 94 L 94 120 C 88 124 84 126 80 126 C 76 126 72 124 66 120 Z' },
  { id: 'front_delts', type: 'ellipse', cx: 34, cy: 72, rx: 13, ry: 14 },
  { id: 'front_delts', type: 'ellipse', cx: 126, cy: 72, rx: 13, ry: 14 },
  { id: 'side_delts',  type: 'ellipse', cx: 22, cy: 88, rx: 10, ry: 12 },
  { id: 'side_delts',  type: 'ellipse', cx: 138, cy: 88, rx: 10, ry: 12 },
  { id: 'biceps',      type: 'path',    d: 'M 28 68 C 22 84 20 100 20 116 C 20 122 21 128 22 132 L 30 129 C 28 122 27 115 27 107 C 27 91 30 77 34 68 Z' },
  { id: 'biceps',      type: 'path',    d: 'M 132 68 C 138 84 140 100 140 116 C 140 122 139 128 138 132 L 130 129 C 132 122 133 115 133 107 C 133 91 130 77 126 68 Z' },
  { id: 'forearms',    type: 'path',    d: 'M 20 134 L 30 130 L 28 184 L 18 184 Z' },
  { id: 'forearms',    type: 'path',    d: 'M 140 134 L 130 130 L 132 184 L 142 184 Z' },
  { id: 'serratus',    type: 'path',    d: 'M 36 92 L 48 94 L 52 132 L 38 126 Z' },
  { id: 'serratus',    type: 'path',    d: 'M 124 92 L 112 94 L 108 132 L 122 126 Z' },
  { id: 'abs',         type: 'path',    d: 'M 66 96 L 94 96 L 94 170 L 66 170 Z' },
  { id: 'obliques',    type: 'path',    d: 'M 38 122 L 64 120 L 64 170 L 50 178 C 44 163 40 143 38 122 Z' },
  { id: 'obliques',    type: 'path',    d: 'M 122 122 L 96 120 L 96 170 L 110 178 C 116 163 120 143 122 122 Z' },
  { id: 'hip_flexors', type: 'path',    d: 'M 50 164 L 66 158 L 68 178 L 50 178 Z' },
  { id: 'hip_flexors', type: 'path',    d: 'M 110 164 L 94 158 L 92 178 L 110 178 Z' },
  { id: 'quads',       type: 'path',    d: 'M 48 180 C 46 204 44 232 44 258 L 72 258 C 72 232 74 204 72 180 Z' },
  { id: 'quads',       type: 'path',    d: 'M 112 180 C 114 204 116 232 116 258 L 88 258 C 88 232 86 204 88 180 Z' },
  { id: 'adductors',   type: 'path',    d: 'M 68 180 L 80 182 L 80 256 L 70 256 C 68 232 66 206 68 180 Z' },
  { id: 'adductors',   type: 'path',    d: 'M 92 180 L 80 182 L 80 256 L 90 256 C 92 232 94 206 92 180 Z' },
  { id: 'tibialis',    type: 'path',    d: 'M 48 264 L 60 262 L 58 312 L 46 314 Z' },
  { id: 'tibialis',    type: 'path',    d: 'M 112 264 L 100 262 L 102 312 L 114 314 Z' },
  { id: 'calves',      type: 'path',    d: 'M 44 260 L 70 260 L 68 320 L 44 320 Z' },
  { id: 'calves',      type: 'path',    d: 'M 116 260 L 90 260 L 92 320 L 116 320 Z' },
];

const BACK_REGIONS = [
  { id: 'traps',      type: 'path',    d: 'M 74 42 L 86 42 L 124 62 L 96 94 L 64 94 L 36 62 Z' },
  { id: 'rear_delts', type: 'ellipse', cx: 34, cy: 72, rx: 13, ry: 14 },
  { id: 'rear_delts', type: 'ellipse', cx: 126, cy: 72, rx: 13, ry: 14 },
  { id: 'upper_back', type: 'path',    d: 'M 64 94 L 96 94 L 100 128 L 60 128 Z' },
  { id: 'lats',       type: 'path',    d: 'M 38 82 C 28 106 26 128 32 144 L 54 136 L 62 92 Z' },
  { id: 'lats',       type: 'path',    d: 'M 122 82 C 132 106 134 128 128 144 L 106 136 L 98 92 Z' },
  { id: 'triceps',    type: 'path',    d: 'M 30 66 C 22 82 18 100 20 126 L 30 122 C 28 108 27 90 28 74 Z' },
  { id: 'triceps',    type: 'path',    d: 'M 130 66 C 138 82 142 100 140 126 L 130 122 C 132 108 133 90 132 74 Z' },
  { id: 'lower_back', type: 'path',    d: 'M 62 128 L 98 128 L 102 172 L 58 172 Z' },
  { id: 'glutes',     type: 'path',    d: 'M 50 172 L 78 172 L 80 179 C 72 195 56 202 48 196 C 42 190 42 180 50 172 Z' },
  { id: 'glutes',     type: 'path',    d: 'M 110 172 L 82 172 L 80 179 C 88 195 104 202 112 196 C 118 190 118 180 110 172 Z' },
  { id: 'hamstrings', type: 'path',    d: 'M 48 184 C 46 206 44 232 44 258 L 72 258 C 72 232 74 206 72 184 Z' },
  { id: 'hamstrings', type: 'path',    d: 'M 112 184 C 114 206 116 232 116 258 L 88 258 C 88 232 86 206 88 184 Z' },
  { id: 'calves',     type: 'path',    d: 'M 44 260 L 70 260 L 68 320 L 44 320 Z' },
  { id: 'calves',     type: 'path',    d: 'M 116 260 L 90 260 L 92 320 L 116 320 Z' },
  { id: 'forearms',   type: 'path',    d: 'M 20 134 L 30 130 L 28 184 L 18 184 Z' },
  { id: 'forearms',   type: 'path',    d: 'M 140 134 L 130 130 L 132 184 L 142 184 Z' },
];

const FIGURES = {
  front: { label: 'FRONT', offsetX: 14,  regions: FRONT_REGIONS },
  back:  { label: 'BACK',  offsetX: 196, regions: BACK_REGIONS  },
};

// ── Render helpers ────────────────────────────────────────────────────────────

const renderShape = (shape, key, props = {}) => {
  const base = { key, ...props };
  if (shape.type === 'circle')  return <circle  {...base} cx={shape.cx} cy={shape.cy} r={shape.r} />;
  if (shape.type === 'ellipse') return <ellipse {...base} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />;
  return <path {...base} d={shape.d} strokeLinejoin="round" strokeLinecap="round" />;
};

const renderFigure = (fig, primarySet, secondarySet, ids) => (
  <g key={fig.label} transform={`translate(${fig.offsetX}, 28)`}>
    {/* Silhouette */}
    {ANATOMY.map((group) =>
      group.parts.map((shape, i) =>
        renderShape(shape, `${fig.label}-a-${group.id}-${i}`, {
          fill: '#F2C9AC',
          stroke: 'rgba(160,100,55,0.22)',
          strokeWidth: 1,
        })
      )
    )}

    {/* Muscle regions */}
    {fig.regions.map((shape, i) => {
      const isPrimary   = primarySet.has(shape.id);
      const isSecondary = secondarySet.has(shape.id);
      const fill   = isPrimary ? `url(#${ids.primaryFill})`   : isSecondary ? `url(#${ids.secondaryFill})` : 'rgba(140,80,40,0.07)';
      const stroke = isPrimary ? 'rgba(212,175,55,0.65)' : isSecondary ? 'rgba(212,175,55,0.32)' : 'rgba(140,80,40,0.13)';
      return (
        <g key={`${fig.label}-r-${i}`} filter={isPrimary ? `url(#${ids.regionGlow})` : undefined}>
          {renderShape(shape, `${fig.label}-rs-${i}`, { fill, stroke, strokeWidth: 0.8 })}
        </g>
      );
    })}

    <text x="80" y="-7" textAnchor="middle" fill="#94A3B8" fontSize="10" letterSpacing="3" fontWeight="600">
      {fig.label}
    </text>
  </g>
);

// ── Component ─────────────────────────────────────────────────────────────────

export default function BodyDiagram({
  primaryRegions   = [],
  secondaryRegions = [],
  title   = 'Muscles worked',
  compact = false,
}) {
  const uid           = useId().replace(/:/g, '');
  const primarySet    = new Set(primaryRegions);
  const secondarySet  = new Set(secondaryRegions);
  const visibleRegions = [...primarySet, ...secondarySet];

  const ids = {
    primaryFill:   `pf-${uid}`,
    secondaryFill: `sf-${uid}`,
    regionGlow:    `rg-${uid}`,
  };

  return (
    <div
      className="rounded-[12px] overflow-hidden"
      style={{
        padding: compact ? '0.875rem' : '1.25rem',
        background: '#FFFFFF',
        border: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-[0.12em]">{title}</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Primary',   bg: 'rgba(212,175,55,0.12)', border: 'rgba(212,175,55,0.30)', swatch: '#D4AF37' },
            { label: 'Secondary', bg: 'rgba(212,175,55,0.06)', border: 'rgba(212,175,55,0.16)', swatch: 'rgba(212,175,55,0.42)' },
          ].map(({ label, bg, border, swatch }) => (
            <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#6B7280]"
                  style={{ background: bg, border: `1px solid ${border}` }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Diagram */}
      <svg viewBox="0 0 376 352" role="img"
           aria-label="Front and back body diagram with highlighted muscle regions."
           style={{ width: '100%', height: compact ? '220px' : '320px' }}>
        <defs>
          <linearGradient id={ids.primaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgba(232,200,80,0.94)" />
            <stop offset="100%" stopColor="rgba(185,138,16,0.94)" />
          </linearGradient>
          <linearGradient id={ids.secondaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgba(232,200,80,0.42)" />
            <stop offset="100%" stopColor="rgba(185,138,16,0.42)" />
          </linearGradient>
          <filter id={ids.regionGlow} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="376" height="352" rx="10" fill="#F8FAFC" stroke="rgba(0,0,0,0.06)" />
        <path d="M188 16V336" stroke="rgba(148,163,184,0.25)" strokeDasharray="4 8" />

        {renderFigure(FIGURES.front, primarySet, secondarySet, ids)}
        {renderFigure(FIGURES.back,  primarySet, secondarySet, ids)}
      </svg>

      {/* Muscle tags */}
      {visibleRegions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {visibleRegions.map((regionId) => {
            const isPrimary = primarySet.has(regionId);
            return (
              <span key={regionId} className="text-[11px] px-2.5 py-1 rounded-full"
                    style={{
                      background: isPrimary ? 'rgba(212,175,55,0.12)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${isPrimary ? 'rgba(212,175,55,0.30)' : 'rgba(0,0,0,0.10)'}`,
                      color: isPrimary ? '#9A7010' : '#6B7280',
                    }}>
                {regionMeta[regionId]?.label ?? regionId}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
