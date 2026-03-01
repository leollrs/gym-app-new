import { useId } from 'react';
import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

const regionMeta = Object.fromEntries(
  BODY_REGION_DEFINITIONS.map((region) => [region.id, region]),
);

const FIGURES = {
  front: {
    label: 'FRONT',
    offsetX: 18,
    clipId: 'front-clip',
    // Human-like silhouette: proportional head, curved torso, natural arms & legs
    parts: [
      { type: 'circle', cx: 80, cy: 24, r: 13 },
      { type: 'path', d: 'M76 37 L84 37 L83 50 L77 50 Z' },
      { type: 'path', d: 'M52 52 C80 48 80 48 108 52 L110 56 C112 72 112 94 110 118 C108 142 108 166 110 192 L108 200 L52 200 L50 192 C48 166 48 142 50 118 C48 94 48 72 50 56 Z' },
      { type: 'path', d: 'M50 54 C38 64 30 88 28 112 L26 145 L25 178 L30 198 L42 195 C40 168 40 142 42 112 C46 82 50 58 50 54 Z' },
      { type: 'path', d: 'M110 54 C122 64 130 88 132 112 L134 145 L135 178 L130 198 L118 195 C120 168 120 142 118 112 C114 82 110 58 110 54 Z' },
      { type: 'path', d: 'M52 198 C48 222 46 252 48 278 L52 298 L64 296 C62 268 62 238 64 208 L52 198 Z' },
      { type: 'path', d: 'M108 198 C112 222 114 252 112 278 L108 298 L96 296 C98 268 98 238 96 208 L108 198 Z' },
    ],
    regions: [
      { id: 'upper_chest',  type: 'path',    d: 'M58 62C65 58 73 56 80 56C87 56 95 58 102 62L96 82H64Z' },
      { id: 'mid_chest',    type: 'path',    d: 'M56 82C63 76 71 72 80 72C89 72 97 76 104 82L98 108H62Z' },
      { id: 'front_delts',  type: 'ellipse', cx: 48,  cy: 72,  rx: 10, ry: 13 },
      { id: 'front_delts',  type: 'ellipse', cx: 112, cy: 72,  rx: 10, ry: 13 },
      { id: 'side_delts',   type: 'ellipse', cx: 35,  cy: 80,  rx: 9,  ry: 12 },
      { id: 'side_delts',   type: 'ellipse', cx: 125, cy: 80,  rx: 9,  ry: 12 },
      { id: 'biceps',       type: 'path',    d: 'M32 82C26 98 24 114 25 132C26 148 29 162 34 172L42 168C38 155 36 140 37 126C37 112 40 98 44 86Z' },
      { id: 'biceps',       type: 'path',    d: 'M128 82C134 98 136 114 135 132C134 148 131 162 126 172L118 168C122 155 124 140 123 126C123 112 120 98 116 86Z' },
      { id: 'forearms',     type: 'path',    d: 'M28 172C29 186 32 200 36 212L44 208C40 196 38 182 39 170Z' },
      { id: 'forearms',     type: 'path',    d: 'M132 172C131 186 128 200 124 212L116 208C120 196 122 182 121 170Z' },
      { id: 'abs',          type: 'path',    d: 'M64 112H96L98 168H62Z' },
      { id: 'obliques',     type: 'path',    d: 'M50 108L60 168L72 172L64 106Z' },
      { id: 'obliques',     type: 'path',    d: 'M110 108L96 106L88 172L100 168Z' },
      { id: 'quads',        type: 'path',    d: 'M54 198C48 228 46 258 48 288H64C62 252 65 222 72 196Z' },
      { id: 'quads',        type: 'path',    d: 'M106 198C112 228 114 258 112 288H96C98 252 95 222 88 196Z' },
      { id: 'adductors',    type: 'path',    d: 'M74 198C72 226 71 252 72 286H82V198Z' },
      { id: 'adductors',    type: 'path',    d: 'M86 198V286H96C97 252 96 226 94 198Z' },
      { id: 'calves',       type: 'path',    d: 'M50 268C49 280 51 290 54 298H64C62 288 61 278 62 268Z' },
      { id: 'calves',       type: 'path',    d: 'M110 268C111 280 109 290 106 298H96C98 288 99 278 98 268Z' },
    ],
  },
  back: {
    label: 'BACK',
    offsetX: 198,
    clipId: 'back-clip',
    parts: [
      { type: 'circle', cx: 80, cy: 24, r: 13 },
      { type: 'path', d: 'M76 37 L84 37 L83 50 L77 50 Z' },
      { type: 'path', d: 'M50 52 C80 48 80 48 110 52 L112 56 C114 72 114 94 112 118 C110 142 110 166 112 192 L110 200 L50 200 L48 192 C46 166 46 142 48 118 C46 94 46 72 48 56 Z' },
      { type: 'path', d: 'M48 54 C36 64 28 88 26 112 L24 145 L23 178 L28 198 L40 195 C38 168 38 142 40 112 C44 82 48 58 48 54 Z' },
      { type: 'path', d: 'M112 54 C124 64 132 88 134 112 L136 145 L137 178 L132 198 L120 195 C122 168 122 142 120 112 C116 82 112 58 112 54 Z' },
      { type: 'path', d: 'M52 198 C48 222 46 252 48 278 L52 298 L64 296 C62 268 62 238 64 208 L52 198 Z' },
      { type: 'path', d: 'M108 198 C112 222 114 252 112 278 L108 298 L96 296 C98 268 98 238 96 208 L108 198 Z' },
    ],
    regions: [
      { id: 'traps',      type: 'path',    d: 'M58 60C65 56 72 54 80 54C88 54 95 56 102 60L94 78H66Z' },
      { id: 'rear_delts', type: 'ellipse', cx: 48,  cy: 72,  rx: 10, ry: 13 },
      { id: 'rear_delts', type: 'ellipse', cx: 112, cy: 72,  rx: 10, ry: 13 },
      { id: 'upper_back', type: 'path',    d: 'M56 78C63 72 71 68 80 68C89 68 97 72 104 78L98 112H62Z' },
      { id: 'lats',       type: 'path',    d: 'M50 88L36 142L56 166L68 104Z' },
      { id: 'lats',       type: 'path',    d: 'M110 88L124 142L104 166L92 104Z' },
      { id: 'triceps',    type: 'path',    d: 'M32 82C26 98 24 114 25 132C26 148 29 162 34 172L42 168C38 155 36 140 37 126C37 112 40 98 44 86Z' },
      { id: 'triceps',    type: 'path',    d: 'M128 82C134 98 136 114 135 132C134 148 131 162 126 172L118 168C122 155 124 140 123 126C123 112 120 98 116 86Z' },
      { id: 'lower_back', type: 'path',    d: 'M64 112H96L98 168H62Z' },
      { id: 'glutes',     type: 'path',    d: 'M56 172C62 182 69 188 80 192L72 206C62 202 52 194 48 182Z' },
      { id: 'glutes',     type: 'path',    d: 'M104 172C98 182 91 188 80 192L88 206C98 202 108 194 112 182Z' },
      { id: 'hamstrings', type: 'path',    d: 'M54 198C48 228 46 258 48 288H64C62 252 65 222 72 196Z' },
      { id: 'hamstrings', type: 'path',    d: 'M106 198C112 228 114 258 112 288H96C98 252 95 222 88 196Z' },
      { id: 'calves',     type: 'path',    d: 'M50 268C49 280 51 290 54 298H64C62 288 61 278 62 268Z' },
      { id: 'calves',     type: 'path',    d: 'M110 268C111 280 109 290 106 298H96C98 288 99 278 98 268Z' },
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

const renderFigure = (figure, primarySet, secondarySet, ids) => (
  <g key={figure.label} transform={`translate(${figure.offsetX}, 32)`}>
    <clipPath id={ids[figure.clipId]}>
      {figure.parts.map((shape, i) => renderShape(shape, `${ids[figure.clipId]}-${i}`, {}))}
    </clipPath>

    <g opacity="0.95">
      {figure.parts.map((shape, i) =>
        renderShape(shape, `${figure.label}-base-${i}`, {
          fill: i < 2 ? 'rgba(207, 216, 228, 0.12)' : 'rgba(30, 41, 59, 0.92)',
          stroke: 'rgba(148, 163, 184, 0.18)',
          strokeWidth: 1.2,
          ...(shape.type === 'path' && {
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
          }),
        }),
      )}
    </g>

    <g clipPath={`url(#${ids[figure.clipId]})`}>
      <rect x="0" y="0" width="160" height="320" fill={`url(#${ids.figureShading})`} opacity="0.42" />
      {figure.regions.map((shape, i) => {
        const isPrimary   = primarySet.has(shape.id);
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
            {renderShape(shape, `${figure.label}-${shape.id}-${i}-shape`, {
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

    <g opacity="0.7">
      {figure.parts.map((shape, i) =>
        renderShape(shape, `${figure.label}-outline-${i}`, {
          fill: 'none',
          stroke: 'rgba(226, 232, 240, 0.08)',
          strokeWidth: 1.1,
          ...(shape.type === 'path' && {
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
          }),
        }),
      )}
    </g>

    <text x="80" y="-6" textAnchor="middle" fill="rgba(191, 219, 254, 0.72)" fontSize="11" letterSpacing="3">
      {figure.label}
    </text>
  </g>
);

export default function BodyDiagram({
  primaryRegions = [],
  secondaryRegions = [],
  title = 'Muscles worked',
  compact = false,
}) {
  const instanceId = useId().replace(/:/g, '');
  const primarySet   = new Set(primaryRegions);
  const secondarySet = new Set(secondaryRegions);
  const visibleRegions = [...primarySet, ...secondarySet];

  const ids = {
    frontClip:     `frontClip-${instanceId}`,
    backClip:      `backClip-${instanceId}`,
    primaryFill:   `primaryFill-${instanceId}`,
    secondaryFill: `secondaryFill-${instanceId}`,
    figureShading: `figureShading-${instanceId}`,
    regionGlow:    `regionGlow-${instanceId}`,
  };

  return (
    <div
      className="rounded-[12px] border border-white/6 overflow-hidden"
      style={{
        padding: compact ? '0.875rem' : '1.25rem',
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(8, 13, 22, 0.96))',
      }}
    >
      {/* Header row */}
      <div className="flex justify-between items-start gap-3 flex-wrap mb-3">
        <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-[0.12em]">{title}</p>
        <div className="flex gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#9CA3AF]"
            style={{ background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.18)' }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: 'linear-gradient(180deg, rgba(191,219,254,0.95), rgba(59,130,246,0.95))' }} />
            Primary
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] text-[#9CA3AF]"
            style={{ background: 'rgba(125,211,252,0.07)', border: '1px solid rgba(125,211,252,0.12)' }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: 'linear-gradient(180deg, rgba(191,219,254,0.48), rgba(56,189,248,0.42))' }} />
            Secondary
          </span>
        </div>
      </div>

      {/* SVG body diagram */}
      <svg
        viewBox="0 0 376 352"
        role="img"
        aria-label="Front and back body diagram with highlighted muscle regions."
        style={{ width: '100%', height: compact ? '220px' : '320px' }}
      >
        <defs>
          <linearGradient id={ids.primaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgba(226, 232, 240, 0.95)" />
            <stop offset="35%"  stopColor="rgba(125, 211, 252, 0.92)" />
            <stop offset="100%" stopColor="rgba(59, 130, 246, 0.95)"  />
          </linearGradient>
          <linearGradient id={ids.secondaryFill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgba(226, 232, 240, 0.38)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.42)"  />
          </linearGradient>
          <linearGradient id={ids.figureShading} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.08)" />
            <stop offset="42%"  stopColor="rgba(15,23,42,0)"       />
            <stop offset="100%" stopColor="rgba(2,6,23,0.22)"      />
          </linearGradient>
          <filter id={ids.regionGlow} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4.5" result="blurred" />
            <feMerge>
              <feMergeNode in="blurred" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="376" height="352" rx="28"
          fill="rgba(5, 10, 18, 0.92)"
          stroke="rgba(148, 163, 184, 0.12)" />
        <path d="M188 20V332" stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 8" />

        {renderFigure({ ...FIGURES.front, clipId: 'frontClip' }, primarySet, secondarySet, ids)}
        {renderFigure({ ...FIGURES.back,  clipId: 'backClip'  }, primarySet, secondarySet, ids)}
      </svg>

      {/* Region label chips */}
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
