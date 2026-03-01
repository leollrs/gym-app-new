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
    parts: [
      { type: 'circle', cx: 80, cy: 28, r: 20 },
      { type: 'rect', x: 69, y: 46, width: 22, height: 18, rx: 9 },
      { type: 'path', d: 'M44 68C55 59 69 54 80 54C91 54 105 59 116 68C122 86 121 111 115 136C110 158 98 179 80 198C62 179 50 158 45 136C39 111 38 86 44 68Z' },
      { type: 'path', d: 'M41 71C26 95 18 119 17 146C16 169 21 191 30 212L44 205C36 183 33 163 34 144C35 122 42 99 53 79Z' },
      { type: 'path', d: 'M119 71C134 95 142 119 143 146C144 169 139 191 130 212L116 205C124 183 127 163 126 144C125 122 118 99 107 79Z' },
      { type: 'path', d: 'M64 191C54 222 49 254 51 298H69C68 260 71 227 78 195Z' },
      { type: 'path', d: 'M96 191C106 222 111 254 109 298H91C92 260 89 227 82 195Z' },
    ],
    regions: [
      { id: 'upper_chest',  type: 'path',    d: 'M58 73C65 66 73 63 80 63C87 63 95 66 102 73L95 93H65Z' },
      { id: 'mid_chest',    type: 'path',    d: 'M55 95C62 88 71 84 80 84C89 84 98 88 105 95L98 121H62Z' },
      { id: 'front_delts',  type: 'ellipse', cx: 49,  cy: 76,  rx: 11, ry: 15 },
      { id: 'front_delts',  type: 'ellipse', cx: 111, cy: 76,  rx: 11, ry: 15 },
      { id: 'side_delts',   type: 'ellipse', cx: 36,  cy: 84,  rx: 10, ry: 14 },
      { id: 'side_delts',   type: 'ellipse', cx: 124, cy: 84,  rx: 10, ry: 14 },
      { id: 'biceps',       type: 'path',    d: 'M24 88C18 101 15 114 15 127C15 138 17 149 21 159L34 152C31 143 30 135 31 126C31 116 34 105 39 93Z' },
      { id: 'biceps',       type: 'path',    d: 'M136 88C142 101 145 114 145 127C145 138 143 149 139 159L126 152C129 143 130 135 129 126C129 116 126 105 121 93Z' },
      { id: 'forearms',     type: 'path',    d: 'M20 160C21 176 25 192 31 207L42 202C37 188 34 174 33 159Z' },
      { id: 'forearms',     type: 'path',    d: 'M140 160C139 176 135 192 129 207L118 202C123 188 126 174 127 159Z' },
      { id: 'abs',          type: 'path',    d: 'M67 124H93L98 171H62Z' },
      { id: 'obliques',     type: 'path',    d: 'M50 120L61 171L74 176L67 123Z' },
      { id: 'obliques',     type: 'path',    d: 'M110 120L93 123L86 176L99 171Z' },
      { id: 'quads',        type: 'path',    d: 'M57 192C50 223 47 253 49 289H67C66 252 69 222 75 194Z' },
      { id: 'quads',        type: 'path',    d: 'M103 192C110 223 113 253 111 289H93C94 252 91 222 85 194Z' },
      { id: 'adductors',    type: 'path',    d: 'M76 195C73 223 72 249 73 286H82V196Z' },
      { id: 'adductors',    type: 'path',    d: 'M84 196V286H93C94 249 93 223 90 195Z' },
      { id: 'calves',       type: 'path',    d: 'M50 266C49 278 51 289 55 300H67C64 289 63 277 64 266Z' },
      { id: 'calves',       type: 'path',    d: 'M110 266C111 278 109 289 105 300H93C96 289 97 277 96 266Z' },
    ],
  },
  back: {
    label: 'BACK',
    offsetX: 198,
    clipId: 'back-clip',
    parts: [
      { type: 'circle', cx: 80, cy: 28, r: 20 },
      { type: 'rect', x: 69, y: 46, width: 22, height: 18, rx: 9 },
      { type: 'path', d: 'M44 68C55 58 69 54 80 54C91 54 105 58 116 68C122 89 121 114 114 138C109 160 98 181 80 199C62 181 51 160 46 138C39 114 38 89 44 68Z' },
      { type: 'path', d: 'M41 71C26 94 18 118 17 145C16 167 21 190 30 212L44 205C36 183 33 163 34 143C35 122 42 99 53 79Z' },
      { type: 'path', d: 'M119 71C134 94 142 118 143 145C144 167 139 190 130 212L116 205C124 183 127 163 126 143C125 122 118 99 107 79Z' },
      { type: 'path', d: 'M64 191C54 222 49 254 51 298H69C68 260 71 227 78 195Z' },
      { type: 'path', d: 'M96 191C106 222 111 254 109 298H91C92 260 89 227 82 195Z' },
    ],
    regions: [
      { id: 'traps',      type: 'path',    d: 'M58 69C65 63 72 60 80 60C88 60 95 63 102 69L94 88H66Z' },
      { id: 'rear_delts', type: 'ellipse', cx: 48,  cy: 77,  rx: 11, ry: 15 },
      { id: 'rear_delts', type: 'ellipse', cx: 112, cy: 77,  rx: 11, ry: 15 },
      { id: 'upper_back', type: 'path',    d: 'M56 88C63 80 71 76 80 76C89 76 97 80 104 88L98 124H62Z' },
      { id: 'lats',       type: 'path',    d: 'M49 97L35 150L58 169L70 112Z' },
      { id: 'lats',       type: 'path',    d: 'M111 97L125 150L102 169L90 112Z' },
      { id: 'triceps',    type: 'path',    d: 'M23 89C17 102 14 115 14 127C14 138 16 148 20 158L33 151C30 142 29 134 30 126C30 116 33 105 38 94Z' },
      { id: 'triceps',    type: 'path',    d: 'M137 89C143 102 146 115 146 127C146 138 144 148 140 158L127 151C130 142 131 134 130 126C130 116 127 105 122 94Z' },
      { id: 'lower_back', type: 'path',    d: 'M66 127H94L98 171H62Z' },
      { id: 'glutes',     type: 'path',    d: 'M58 176C64 186 71 192 80 196L72 211C61 207 52 198 46 186Z' },
      { id: 'glutes',     type: 'path',    d: 'M102 176C96 186 89 192 80 196L88 211C99 207 108 198 114 186Z' },
      { id: 'hamstrings', type: 'path',    d: 'M57 192C51 220 48 250 49 286H66C66 251 69 221 76 194Z' },
      { id: 'hamstrings', type: 'path',    d: 'M103 192C109 220 112 250 111 286H94C94 251 91 221 84 194Z' },
      { id: 'calves',     type: 'path',    d: 'M51 265C50 277 52 289 56 300H67C64 289 63 277 64 265Z' },
      { id: 'calves',     type: 'path',    d: 'M109 265C110 277 108 289 104 300H93C96 289 97 277 96 265Z' },
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
