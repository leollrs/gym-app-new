import { useId } from 'react';
import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((region) => [region.id, region]),
);

// ─── Anatomically accurate figure: ~8 heads tall, 2.75 head shoulder width ───
// Canvas 160×320, center x=80. Head≈40px, shoulder y≈55, waist y≈120, crotch y≈170, knee y≈255, ankle y≈318

const FRONT_ANATOMY = [
  {
    id: 'head',
    parts: [{ type: 'circle', cx: 80, cy: 20, r: 18 }],
  },
  {
    id: 'neck',
    parts: [{ type: 'path', d: 'M 74 40 L 86 40 L 130 55 L 30 55 Z' }],
  },
  {
    id: 'torso-ribcage',
    parts: [{ type: 'path', d: 'M 30 55 C 80 50 130 55 L 124 60 C 118 88 102 120 L 58 120 C 52 88 36 60 30 55 Z' }],
  },
  {
    id: 'torso-pelvis',
    parts: [{ type: 'path', d: 'M 58 120 L 102 120 L 108 170 L 52 170 Z' }],
  },
  {
    id: 'arm-upper-L',
    parts: [{ type: 'path', d: 'M 30 55 C 24 80 22 98 24 120 L 30 118 C 30 98 30 72 30 55 Z' }],
  },
  {
    id: 'arm-fore-L',
    parts: [{ type: 'path', d: 'M 30 118 L 28 118 L 20 168 L 22 170 L 26 170 L 28 120 Z' }],
  },
  {
    id: 'arm-upper-R',
    parts: [{ type: 'path', d: 'M 130 55 C 136 80 138 98 136 120 L 130 118 C 130 98 130 72 130 55 Z' }],
  },
  {
    id: 'arm-fore-R',
    parts: [{ type: 'path', d: 'M 130 118 L 132 118 L 140 168 L 138 170 L 134 170 L 132 120 Z' }],
  },
  {
    id: 'leg-thigh-L',
    parts: [{ type: 'path', d: 'M 52 170 L 50 170 L 42 255 L 48 255 L 54 172 Z' }],
  },
  {
    id: 'leg-calf-L',
    parts: [{ type: 'path', d: 'M 42 255 L 48 255 L 46 318 L 42 318 Z' }],
  },
  {
    id: 'leg-thigh-R',
    parts: [{ type: 'path', d: 'M 108 170 L 110 170 L 118 255 L 112 255 L 106 172 Z' }],
  },
  {
    id: 'leg-calf-R',
    parts: [{ type: 'path', d: 'M 118 255 L 112 255 L 114 318 L 118 318 Z' }],
  },
];

const BACK_ANATOMY = [
  { id: 'head', parts: [{ type: 'circle', cx: 80, cy: 20, r: 18 }] },
  { id: 'neck', parts: [{ type: 'path', d: 'M 74 40 L 86 40 L 130 55 L 30 55 Z' }] },
  { id: 'torso-ribcage', parts: [{ type: 'path', d: 'M 30 55 C 80 51 130 55 L 124 60 C 118 88 102 120 L 58 120 C 52 88 36 60 30 55 Z' }] },
  { id: 'torso-pelvis', parts: [{ type: 'path', d: 'M 58 120 L 102 120 L 108 170 L 52 170 Z' }] },
  { id: 'arm-upper-L', parts: [{ type: 'path', d: 'M 30 55 C 24 80 22 98 24 120 L 30 118 C 30 98 30 72 30 55 Z' }] },
  { id: 'arm-fore-L', parts: [{ type: 'path', d: 'M 30 118 L 28 118 L 20 168 L 22 170 L 26 170 L 28 120 Z' }] },
  { id: 'arm-upper-R', parts: [{ type: 'path', d: 'M 130 55 C 136 80 138 98 136 120 L 130 118 C 130 98 130 72 130 55 Z' }] },
  { id: 'arm-fore-R', parts: [{ type: 'path', d: 'M 130 118 L 132 118 L 140 168 L 138 170 L 134 170 L 132 120 Z' }] },
  { id: 'leg-thigh-L', parts: [{ type: 'path', d: 'M 52 170 L 50 170 L 42 255 L 48 255 L 54 172 Z' }] },
  { id: 'leg-calf-L', parts: [{ type: 'path', d: 'M 42 255 L 48 255 L 46 318 L 42 318 Z' }] },
  { id: 'leg-thigh-R', parts: [{ type: 'path', d: 'M 108 170 L 110 170 L 118 255 L 112 255 L 106 172 Z' }] },
  { id: 'leg-calf-R', parts: [{ type: 'path', d: 'M 118 255 L 112 255 L 114 318 L 118 318 Z' }] },
];

function flattenAnatomy(anatomy) {
  return anatomy.flatMap((g) => g.parts.map((s) => ({ ...s })));
}

const FIGURES = {
  front: {
    label: 'FRONT',
    offsetX: 18,
    clipId: 'frontClip',
    anatomy: FRONT_ANATOMY,
    regions: [
      { id: 'upper_chest', type: 'path', d: 'M 48 58 C 64 54 96 54 112 58 L 108 78 L 52 78 Z' },
      { id: 'mid_chest', type: 'path', d: 'M 52 78 C 68 74 92 74 108 78 L 102 108 L 58 108 Z' },
      { id: 'front_delts', type: 'ellipse', cx: 38, cy: 68, rx: 10, ry: 12 },
      { id: 'front_delts', type: 'ellipse', cx: 122, cy: 68, rx: 10, ry: 12 },
      { id: 'side_delts', type: 'ellipse', cx: 26, cy: 78, rx: 9, ry: 11 },
      { id: 'side_delts', type: 'ellipse', cx: 134, cy: 78, rx: 9, ry: 11 },
      { id: 'biceps', type: 'path', d: 'M 28 58 C 26 82 26 100 28 118 L 34 116 C 34 98 34 78 32 58 Z' },
      { id: 'biceps', type: 'path', d: 'M 132 58 C 134 82 134 100 132 118 L 126 116 C 126 98 126 78 128 58 Z' },
      { id: 'forearms', type: 'path', d: 'M 26 118 L 22 118 L 20 165 L 24 168 L 28 168 L 30 120 Z' },
      { id: 'forearms', type: 'path', d: 'M 134 118 L 138 118 L 140 165 L 136 168 L 132 168 L 130 120 Z' },
      { id: 'abs', type: 'path', d: 'M 60 120 L 100 120 L 98 168 L 62 168 Z' },
      { id: 'obliques', type: 'path', d: 'M 52 118 L 58 120 L 62 168 L 56 170 L 50 120 Z' },
      { id: 'obliques', type: 'path', d: 'M 108 120 L 102 120 L 98 168 L 104 170 L 110 120 Z' },
      { id: 'quads', type: 'path', d: 'M 50 170 L 46 170 L 42 252 L 48 255 L 54 172 Z' },
      { id: 'quads', type: 'path', d: 'M 110 170 L 114 170 L 118 252 L 112 255 L 106 172 Z' },
      { id: 'adductors', type: 'path', d: 'M 72 170 L 70 170 L 68 252 L 72 255 L 76 172 Z' },
      { id: 'adductors', type: 'path', d: 'M 88 170 L 90 170 L 92 252 L 88 255 L 84 172 Z' },
      { id: 'calves', type: 'path', d: 'M 42 255 L 46 255 L 44 316 L 42 318 L 42 255 Z' },
      { id: 'calves', type: 'path', d: 'M 118 255 L 114 255 L 116 316 L 118 318 L 118 255 Z' },
    ],
  },
  back: {
    label: 'BACK',
    offsetX: 198,
    clipId: 'backClip',
    anatomy: BACK_ANATOMY,
    regions: [
      { id: 'traps', type: 'path', d: 'M 52 52 C 68 48 92 48 108 52 L 102 72 L 58 72 Z' },
      { id: 'rear_delts', type: 'ellipse', cx: 38, cy: 68, rx: 10, ry: 12 },
      { id: 'rear_delts', type: 'ellipse', cx: 122, cy: 68, rx: 10, ry: 12 },
      { id: 'upper_back', type: 'path', d: 'M 54 72 C 70 68 90 68 106 72 L 100 108 L 60 108 Z' },
      { id: 'lats', type: 'path', d: 'M 48 88 L 34 140 L 52 165 L 66 100 Z' },
      { id: 'lats', type: 'path', d: 'M 112 88 L 126 140 L 108 165 L 94 100 Z' },
      // Triceps: posterior upper arm (back of arm shoulder→elbow), following arm curvature
      { id: 'triceps', type: 'path', d: 'M 32 58 C 28 82 26 100 28 118 L 34 116 C 34 98 32 78 32 58 Z' },
      { id: 'triceps', type: 'path', d: 'M 128 58 C 132 82 134 100 132 118 L 126 116 C 126 98 128 78 128 58 Z' },
      { id: 'lower_back', type: 'path', d: 'M 60 108 L 100 108 L 98 168 L 62 168 Z' },
      { id: 'glutes', type: 'path', d: 'M 52 168 L 54 165 L 76 171 L 58 168 Z' },
      { id: 'glutes', type: 'path', d: 'M 108 168 L 106 165 L 84 171 L 102 168 Z' },
      { id: 'hamstrings', type: 'path', d: 'M 48 170 L 44 170 L 44 252 L 48 255 L 52 172 Z' },
      { id: 'hamstrings', type: 'path', d: 'M 112 170 L 116 170 L 116 252 L 112 255 L 108 172 Z' },
      { id: 'calves', type: 'path', d: 'M 42 255 L 46 255 L 44 316 L 42 318 Z' },
      { id: 'calves', type: 'path', d: 'M 118 255 L 114 255 L 116 316 L 118 318 Z' },
    ],
  },
};

const renderShape = (shape, key, props = {}) => {
  if (shape.type === 'circle')
    return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} {...props} />;
  if (shape.type === 'rect')
    return <rect key={key} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} {...props} />;
  if (shape.type === 'ellipse')
    return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...props} />;
  return <path key={key} d={shape.d} {...props} />;
};

const pathStrokeProps = { strokeLinejoin: 'round', strokeLinecap: 'round' };

const renderFigure = (figure, primarySet, secondarySet, ids) => {
  const parts = flattenAnatomy(figure.anatomy);
  const clipId = ids[figure.clipId];

  return (
    <g key={figure.label} transform={`translate(${figure.offsetX}, 32)`}>
      <clipPath id={clipId}>
        {parts.map((shape, i) => renderShape(shape, `clip-${i}`, {}))}
      </clipPath>

      {/* Base silhouette: semantic groups, same fill/stroke as before */}
      {figure.anatomy.map((group) => (
        <g key={group.id} id={`${figure.label.toLowerCase()}-${group.id}`} opacity="0.95">
          {group.parts.map((shape, i) =>
            renderShape(shape, `${group.id}-${i}`, {
              fill: group.id === 'head' || group.id === 'neck'
                ? 'rgba(207, 216, 228, 0.12)'
                : 'rgba(30, 41, 59, 0.92)',
              stroke: 'rgba(148, 163, 184, 0.18)',
              strokeWidth: 1.2,
              ...(shape.type === 'path' && pathStrokeProps),
            }),
          )}
        </g>
      ))}

      <g clipPath={`url(#${clipId})`}>
        <rect x="0" y="0" width="160" height="320" fill={`url(#${ids.figureShading})`} opacity="0.42" />
        {figure.regions.map((shape, i) => {
          const isPrimary = primarySet.has(shape.id);
          const isSecondary = secondarySet.has(shape.id);
          const fill = isPrimary
            ? `url(#${ids.primaryFill})`
            : isSecondary
              ? `url(#${ids.secondaryFill})`
              : 'rgba(255, 255, 255, 0.055)';
          return (
            <g
              key={`${figure.label}-${shape.id}-${i}`}
              filter={isPrimary ? `url(#${ids.regionGlow})` : undefined}
              opacity={isPrimary ? 1 : isSecondary ? 0.92 : 1}
            >
              {renderShape(shape, `${figure.label}-${shape.id}-${i}`, {
                fill,
                stroke: isPrimary
                  ? 'rgba(226, 232, 240, 0.38)'
                  : isSecondary
                    ? 'rgba(191, 219, 254, 0.18)'
                    : 'transparent',
                strokeWidth: 0.7,
              })}
            </g>
          );
        })}
      </g>

      {/* Outline pass */}
      {figure.anatomy.map((group) => (
        <g key={`outline-${group.id}`} opacity="0.7">
          {group.parts.map((shape, i) =>
            renderShape(shape, `out-${group.id}-${i}`, {
              fill: 'none',
              stroke: 'rgba(226, 232, 240, 0.08)',
              strokeWidth: 1.1,
              ...(shape.type === 'path' && pathStrokeProps),
            }),
          )}
        </g>
      ))}

      <text x="80" y="-6" textAnchor="middle" fill="rgba(191, 219, 254, 0.72)" fontSize="11" letterSpacing="3">
        {figure.label}
      </text>
    </g>
  );
};

export default function BodyDiagram({
  primaryRegions = [],
  secondaryRegions = [],
  title = 'Muscles worked',
  compact = false,
}) {
  const instanceId = useId().replace(/:/g, '');
  const primarySet = new Set(primaryRegions);
  const secondarySet = new Set(secondaryRegions);
  const visibleRegions = [...primarySet, ...secondarySet];

  const ids = {
    frontClip: `frontClip-${instanceId}`,
    backClip: `backClip-${instanceId}`,
    primaryFill: `primaryFill-${instanceId}`,
    secondaryFill: `secondaryFill-${instanceId}`,
    figureShading: `figureShading-${instanceId}`,
    regionGlow: `regionGlow-${instanceId}`,
  };

  return (
    <div
      className="rounded-[12px] border border-white/6 overflow-hidden"
      style={{
        padding: compact ? '0.875rem' : '1.25rem',
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(8, 13, 22, 0.96))',
      }}
    >
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-[0.12em]">{title}</p>
        <div className="flex gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#9CA3AF]"
            style={{ background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.18)' }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: 'linear-gradient(180deg, rgba(191,219,254,0.95), rgba(59,130,246,0.95))' }}
            />
            Primary
          </span>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#9CA3AF]"
            style={{ background: 'rgba(125,211,252,0.07)', border: '1px solid rgba(125,211,252,0.12)' }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: 'linear-gradient(180deg, rgba(191,219,254,0.48), rgba(56,189,248,0.42))' }}
            />
            Secondary
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 376 352"
        role="img"
        aria-label="Front and back body diagram with highlighted muscle regions."
        style={{ width: '100%', height: compact ? '220px' : '320px' }}
      >
        <defs>
          <linearGradient id={ids.primaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(226, 232, 240, 0.95)" />
            <stop offset="35%" stopColor="rgba(125, 211, 252, 0.92)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0.95)" />
          </linearGradient>
          <linearGradient id={ids.secondaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(226, 232, 240, 0.38)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.42)" />
          </linearGradient>
          <linearGradient id={ids.figureShading} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="42%" stopColor="rgba(15,23,42,0)" />
            <stop offset="100%" stopColor="rgba(2,6,23,0.22)" />
          </linearGradient>
          <filter id={ids.regionGlow} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4.5" result="blurred" />
            <feMerge>
              <feMergeNode in="blurred" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect
          x="0"
          y="0"
          width="376"
          height="352"
          rx="28"
          fill="rgba(5, 10, 18, 0.92)"
          stroke="rgba(148, 163, 184, 0.12)"
        />
        <path d="M188 20V332" stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 8" />

        {renderFigure({ ...FIGURES.front, clipId: 'frontClip' }, primarySet, secondarySet, ids)}
        {renderFigure({ ...FIGURES.back, clipId: 'backClip' }, primarySet, secondarySet, ids)}
      </svg>

      {visibleRegions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {visibleRegions.map((regionId) => {
            const isPrimary = primarySet.has(regionId);
            return (
              <span
                key={regionId}
                className="text-[11px] px-2.5 py-1 rounded-full text-[#E5E7EB]"
                style={{
                  background: isPrimary ? 'rgba(96,165,250,0.12)' : 'rgba(148,163,184,0.07)',
                  border: `1px solid ${isPrimary ? 'rgba(96,165,250,0.24)' : 'rgba(148,163,184,0.14)'}`,
                }}
              >
                {regionMeta[regionId]?.label ?? regionId}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
