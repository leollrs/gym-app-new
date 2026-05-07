import React from 'react';
import { Trophy } from 'lucide-react';
import { exName } from '../../lib/exerciseName';
import { fmtDuration } from '../../lib/dateUtils';
import { STRATA_FONT_DISPLAY, STRATA_HOT } from './strataTokens';

// ─── Format dimensions (export pixel size) ─────────────────────────────────
// Card renders into these native dims and is then CSS-scaled to fit the
// preview. A real export step would draw this same component tree to a
// 1080×N canvas via html-to-image / dom-to-canvas.
export const SHARE_FORMATS = {
  story:    { label: 'Story',       sub: '9:16 · 1080×1920', w: 1080, h: 1920 },
  square:   { label: 'Square',      sub: '1:1 · 1080×1080',  w: 1080, h: 1080 },
  portrait: { label: 'Portrait',    sub: '4:5 · 1080×1350',  w: 1080, h: 1350 },
  reels:    { label: 'Reels',       sub: '9:16 · 1080×1920', w: 1080, h: 1920 },
  x:        { label: 'X / Twitter', sub: '16:9 · 1600×900',  w: 1600, h: 900 },
};

export const SHARE_TEMPLATES = ['photo', 'stats', 'minimal'];
export const SHARE_FILTERS = ['none', 'moody', 'warm', 'bw', 'cool'];

const FILTER_CSS = {
  none:  'none',
  moody: 'contrast(1.08) saturate(1.05) brightness(0.92)',
  warm:  'sepia(0.18) saturate(1.2) brightness(1.02)',
  bw:    'grayscale(1) contrast(1.12)',
  cool:  'hue-rotate(-12deg) saturate(0.9) brightness(0.96)',
};

// ─── Photo backdrop ─────────────────────────────────────────────────────────
// Real photo from the post if present, otherwise a generated gym-toned
// gradient backdrop that reads as "moody training shot".
function PhotoBackdrop({ src, filter = 'moody', accent }) {
  const filterCss = FILTER_CSS[filter] || 'none';
  if (src) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${src})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: filterCss,
        }}
      />
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', filter: filterCss }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse 60% 40% at 30% 30%, rgba(255,180,100,0.32), transparent 70%),
            radial-gradient(ellipse 60% 60% at 75% 75%, ${accent}33, transparent 65%),
            linear-gradient(180deg, #2a1c14 0%, #1a1208 50%, #0a0604 100%)
          `,
        }}
      />
      {/* abstract barbell silhouette */}
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 140"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0, opacity: 0.85 }}
      >
        <ellipse cx="50" cy="70" rx="50" ry="22" fill="rgba(255,180,120,0.12)" />
        <rect x="6" y="68" width="88" height="2.2" fill="#1a1208" />
        <rect x="10" y="60" width="3" height="18" fill="#0a0604" />
        <rect x="14" y="62" width="2.2" height="14" fill="#0a0604" />
        <rect x="87" y="60" width="3" height="18" fill="#0a0604" />
        <rect x="83.8" y="62" width="2.2" height="14" fill="#0a0604" />
        <ellipse cx="50" cy="80" rx="22" ry="6" fill="#0a0604" opacity="0.75" />
        <ellipse cx="50" cy="86" rx="14" ry="3.5" fill="#0a0604" opacity="0.6" />
      </svg>
    </div>
  );
}

// ─── Brand mark ─────────────────────────────────────────────────────────────
function ShareBrand({ size = 'md', dark = true, gymName = 'TuGymPR', handle = 'mono72', show = true }) {
  if (!show) return null;
  const fs = size === 'sm' ? 9 : size === 'md' ? 11 : 14;
  const ls = size === 'sm' ? 18 : size === 'md' ? 22 : 28;
  const fg = dark ? '#fff' : '#0a0d10';
  const fgSub = dark ? 'rgba(255,255,255,0.6)' : 'rgba(10,13,16,0.55)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: ls,
          height: ls,
          borderRadius: ls / 2,
          background: dark
            ? 'radial-gradient(circle at 35% 30%, #2a2d32 0%, #0a0c0f 100%)'
            : 'radial-gradient(circle at 35% 30%, #fff 0%, #e5e2da 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${dark ? '#1a1d22' : 'rgba(0,0,0,0.08)'}`,
        }}
      >
        <div
          style={{
            width: ls * 0.6,
            height: ls * 0.6,
            borderRadius: '50%',
            border: `1.5px solid #E8C547`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#E8C547',
            fontFamily: '"Archivo", system-ui',
            fontWeight: 900,
            fontSize: ls * 0.34,
            letterSpacing: -0.5,
          }}
        >
          {gymName?.[0]?.toUpperCase() ?? 'G'}
        </div>
      </div>
      <div>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontWeight: 800,
            fontSize: fs,
            color: fg,
            lineHeight: 1,
            letterSpacing: -0.2,
          }}
        >
          {gymName}
        </div>
        <div
          style={{
            fontSize: fs * 0.85,
            color: fgSub,
            marginTop: 1,
            fontWeight: 600,
            letterSpacing: 0.2,
          }}
        >
          @{handle}
        </div>
      </div>
    </div>
  );
}

// ─── Default session shape ─────────────────────────────────────────────────
const SAMPLE_SESSION = {
  user: 'Leonel Llorens',
  handle: 'mono72',
  title: 'Upper Power · Day 4',
  date: 'Jan 14',
  duration: 52,            // minutes
  volume: 14520,           // lbs
  exercises: 6,
  prCount: 1,
  topLift: { name: 'Bench Press', sets: '5×3', weight: 245, unit: 'lb' },
  bpm: 142,
  photoUrl: null,
};

// Build a session payload from a feed item.
export function sessionFromFeedItem(item, profile) {
  const data = item?.data ?? {};
  const handle = profile?.username || item?.profiles?.username || '';
  const fullName = profile?.full_name || item?.profiles?.full_name || 'Member';
  const created = item?.created_at ? new Date(item.created_at) : new Date();
  const date = created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (item?.type === 'pr_hit') {
    const liftName =
      exName({ name: data.exercise_name, name_es: data.exercise_name_es }) ||
      data.exercise_name ||
      'PR';
    return {
      user: fullName,
      handle,
      title: 'Personal Record',
      date,
      duration: 0,
      volume: 0,
      exercises: 0,
      prCount: 1,
      topLift: { name: liftName, sets: `1×${data.reps || 1}`, weight: data.weight_lbs || 0, unit: 'lb' },
      bpm: 0,
      photoUrl: data.photo_url || null,
    };
  }

  if (item?.type === 'cardio_completed') {
    return {
      user: fullName,
      handle,
      title: data.cardio_type ? `${data.cardio_type} session` : 'Cardio',
      date,
      duration: Math.round((data.duration_seconds || 0) / 60),
      volume: 0,
      exercises: data.distance_km ? Math.round(data.distance_km * 10) / 10 : 0,
      prCount: 0,
      topLift: {
        name: data.cardio_type || 'Cardio',
        sets: '',
        weight: data.distance_km ? `${data.distance_km.toFixed(2)}` : `${Math.round((data.duration_seconds || 0) / 60)}`,
        unit: data.distance_km ? 'km' : 'min',
      },
      bpm: data.avg_heart_rate || 0,
      photoUrl: null,
    };
  }

  // workout_completed and user_post fall through to the lift session shape
  const top = (data.top_lifts && data.top_lifts[0]) || null;
  return {
    user: fullName,
    handle,
    title: data.routine_name || data.workout_name || 'Workout',
    date,
    duration: Math.round((data.duration_seconds || 0) / 60),
    volume: data.total_volume_lbs || 0,
    exercises: data.exercise_count || 0,
    prCount: data.pr_count || 0,
    topLift: top
      ? { name: top.name, sets: top.sets, weight: top.weight, unit: top.unit || 'lb' }
      : { name: data.routine_name || 'Top Set', sets: '', weight: data.total_volume_lbs ? Math.round(data.total_volume_lbs / 1000) : 0, unit: 'k lb' },
    bpm: 0,
    photoUrl: data.photo_url || null,
  };
}

const STAT_DEFS = {
  duration:  { label: 'TIME',      get: (s) => s.duration ? `${s.duration}m` : '—' },
  volume:    { label: 'VOLUME',    get: (s) => s.volume >= 1000 ? `${(s.volume / 1000).toFixed(1)}k` : String(s.volume || 0) },
  exercises: { label: 'EXERCISES', get: (s) => String(s.exercises || 0) },
  pr:        { label: 'PRS',       get: (s) => String(s.prCount || 0), accent: true },
  bpm:       { label: 'AVG BPM',   get: (s) => String(s.bpm || 0), accent: true },
};

// ─── Template 1: PHOTO-FORWARD ─────────────────────────────────────────────
function ShareCardPhoto({ fmt, branding, accent, filter, stats, session, gymName }) {
  const isLandscape = fmt.w > fmt.h;
  const isSquare = fmt.w === fmt.h;
  const isStory = fmt.h / fmt.w > 1.5;
  const padX = Math.round(fmt.w * 0.06);
  const padTop = isStory ? Math.round(fmt.h * 0.12) : Math.round(fmt.h * 0.08);
  const padBottom = isStory ? Math.round(fmt.h * 0.18) : Math.round(fmt.h * 0.08);
  const maxStats = isStory ? 4 : isSquare ? 3 : isLandscape ? 4 : 3;
  const visible = stats.filter((k) => STAT_DEFS[k]).slice(0, maxStats);
  const titleSize = isStory ? 96 : isSquare ? 64 : isLandscape ? 56 : 72;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', color: '#fff' }}>
      <PhotoBackdrop src={session.photoUrl} filter={filter} accent={accent} />
      {/* legibility gradients */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.85) 100%)',
        }}
      />
      {/* TOP */}
      <div
        style={{
          position: 'absolute',
          top: padTop * 0.6,
          left: padX,
          right: padX,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <ShareBrand size={isStory ? 'lg' : 'md'} show={branding} gymName={gymName} handle={session.handle} />
        <div
          style={{
            padding: `${isStory ? 12 : 8}px ${isStory ? 18 : 14}px`,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.18)',
            fontSize: isStory ? 22 : 16,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {session.date}
        </div>
      </div>
      {/* BOTTOM */}
      <div style={{ position: 'absolute', bottom: padBottom, left: padX, right: padX }}>
        {session.prCount > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: `${isStory ? 10 : 7}px ${isStory ? 18 : 14}px`,
              borderRadius: 6,
              background: accent,
              color: '#fff',
              fontSize: isStory ? 22 : 14,
              fontWeight: 800,
              letterSpacing: 1.4,
              transform: 'rotate(-1.5deg)',
              boxShadow: `0 6px 20px ${accent}55`,
              marginBottom: isStory ? 20 : 14,
            }}
          >
            ★ NEW PR · {session.topLift.name.toUpperCase()}
          </div>
        )}
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: titleSize,
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: -3,
            color: '#fff',
            textShadow: '0 2px 24px rgba(0,0,0,0.5)',
            marginBottom: isStory ? 36 : 20,
          }}
        >
          {session.title}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
            paddingTop: isStory ? 24 : 16,
            borderTop: '1.5px solid rgba(255,255,255,0.25)',
          }}
        >
          {visible.map((k, i) => {
            const def = STAT_DEFS[k];
            return (
              <div
                key={k}
                style={{
                  paddingLeft: i > 0 ? (isStory ? 24 : 16) : 0,
                  borderLeft: i > 0 ? '1.5px solid rgba(255,255,255,0.18)' : 'none',
                }}
              >
                <div
                  style={{
                    fontSize: isStory ? 18 : 12,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.65)',
                    letterSpacing: 1.6,
                    textTransform: 'uppercase',
                    marginBottom: isStory ? 10 : 6,
                  }}
                >
                  {def.label}
                </div>
                <div
                  style={{
                    fontFamily: STRATA_FONT_DISPLAY,
                    fontSize: isStory ? 56 : isLandscape ? 38 : isSquare ? 42 : 44,
                    fontWeight: 800,
                    color: def.accent ? accent : '#fff',
                    letterSpacing: -2,
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {def.get(session)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Template 2: STATS-FORWARD ─────────────────────────────────────────────
function ShareCardStats({ fmt, branding, accent, filter, stats, session, gymName }) {
  const isStory = fmt.h / fmt.w > 1.5;
  const isLandscape = fmt.w > fmt.h;
  const isSquare = fmt.w === fmt.h;
  const padX = Math.round(fmt.w * 0.06);
  const padY = Math.round(fmt.h * 0.06);
  const heroVal = session.topLift.weight || 0;
  const heroUnit = session.topLift.unit || 'lb';
  const heroSets = session.topLift.sets || '';
  const heroSize = isStory ? 360 : isLandscape ? 220 : isSquare ? 260 : 280;
  const visible = stats.filter((k) => STAT_DEFS[k] && k !== 'topLift').slice(0, isLandscape ? 4 : 4);
  const photoW = isStory
    ? Math.round(fmt.w * 0.52)
    : isLandscape
    ? Math.round(fmt.w * 0.34)
    : Math.round(fmt.w * 0.42);
  const photoH = Math.round(photoW * (isLandscape ? 0.85 : 1.15));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', color: '#fff', background: '#0a0d10' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 12, background: accent }} />
      <div
        style={{
          position: 'absolute',
          top: padY,
          left: padX,
          right: padX + 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <ShareBrand size={isStory ? 'lg' : 'md'} show={branding} gymName={gymName} handle={session.handle} />
        {session.prCount > 0 && (
          <div
            style={{
              padding: `${isStory ? 12 : 8}px ${isStory ? 20 : 14}px`,
              borderRadius: 6,
              background: accent,
              fontSize: isStory ? 22 : 14,
              fontWeight: 800,
              letterSpacing: 1.6,
              color: '#fff',
            }}
          >
            NEW PR
          </div>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          top: isLandscape ? Math.round(fmt.h * 0.32) : Math.round(fmt.h * 0.22),
          left: padX,
          right: isLandscape ? '50%' : padX,
        }}
      >
        <div
          style={{
            fontSize: isStory ? 24 : isLandscape ? 16 : 18,
            fontWeight: 800,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: isStory ? 18 : 12,
          }}
        >
          {session.topLift.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: heroSize,
              fontWeight: 800,
              color: accent,
              letterSpacing: -10,
              lineHeight: 0.9,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {heroVal}
          </span>
          <span
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: heroSize * 0.22,
              fontWeight: 700,
              color: 'rgba(255,255,255,0.7)',
              letterSpacing: -1,
            }}
          >
            {heroUnit}
          </span>
        </div>
        {heroSets && (
          <div
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: isStory ? 36 : isLandscape ? 22 : 28,
              fontWeight: 700,
              color: '#fff',
              marginTop: isStory ? 8 : 4,
              letterSpacing: -0.6,
            }}
          >
            {heroSets}
          </div>
        )}
      </div>
      {isLandscape ? (
        <div style={{ position: 'absolute', right: 12, top: 0, bottom: 0, width: '50%', overflow: 'hidden' }}>
          <PhotoBackdrop src={session.photoUrl} filter={filter} accent={accent} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, #0a0d10 0%, transparent 40%)',
            }}
          />
        </div>
      ) : !isStory ? (
        <div
          style={{
            position: 'absolute',
            top: padY,
            right: padX + 30,
            width: photoW,
            height: photoH,
            borderRadius: 12,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.08)',
          }}
        >
          <PhotoBackdrop src={session.photoUrl} filter={filter} accent={accent} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', bottom: padY, left: padX, right: padX + 12 }}>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: isStory ? 32 : isLandscape ? 18 : 22,
            fontWeight: 800,
            color: '#fff',
            letterSpacing: -0.5,
            marginBottom: isStory ? 22 : 14,
          }}
        >
          {session.title}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
            paddingTop: isStory ? 22 : 14,
            borderTop: `2px solid ${accent}`,
          }}
        >
          {visible.map((k, i) => {
            const def = STAT_DEFS[k];
            return (
              <div
                key={k}
                style={{
                  paddingLeft: i > 0 ? (isStory ? 20 : 12) : 0,
                  borderLeft: i > 0 ? '1.5px solid rgba(255,255,255,0.12)' : 'none',
                }}
              >
                <div
                  style={{
                    fontSize: isStory ? 18 : 11,
                    fontWeight: 800,
                    color: 'rgba(255,255,255,0.55)',
                    letterSpacing: 1.6,
                    textTransform: 'uppercase',
                    marginBottom: isStory ? 8 : 5,
                  }}
                >
                  {def.label}
                </div>
                <div
                  style={{
                    fontFamily: STRATA_FONT_DISPLAY,
                    fontSize: isStory ? 56 : isLandscape ? 36 : isSquare ? 42 : 44,
                    fontWeight: 800,
                    color: def.accent ? accent : '#fff',
                    letterSpacing: -1.6,
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {def.get(session)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Template 3: MINIMAL ───────────────────────────────────────────────────
function ShareCardMinimal({ fmt, branding, accent, session, gymName }) {
  const isStory = fmt.h / fmt.w > 1.5;
  const isLandscape = fmt.w > fmt.h;
  const isSquare = fmt.w === fmt.h;
  const padX = Math.round(fmt.w * 0.08);
  const padY = Math.round(fmt.h * 0.08);
  const numSize = isStory ? 540 : isLandscape ? 280 : isSquare ? 360 : 420;
  const bg = '#f4f1ea';
  const ink = '#0a0d10';
  const subInk = '#5a6570';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: bg, color: ink }}>
      <div
        style={{
          position: 'absolute',
          top: padY,
          left: padX,
          right: padX,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <ShareBrand size={isStory ? 'lg' : 'md'} dark={false} show={branding} gymName={gymName} handle={session.handle} />
        <div
          style={{
            fontSize: isStory ? 22 : 14,
            fontWeight: 700,
            color: subInk,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
          }}
        >
          {session.date}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: `0 ${padX}px`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            fontSize: isStory ? 22 : 14,
            fontWeight: 800,
            color: accent,
            letterSpacing: 2,
            textTransform: 'uppercase',
            marginBottom: isStory ? 32 : 20,
          }}
        >
          <span style={{ width: isStory ? 60 : 40, height: 2, background: accent }} />
          {session.prCount > 0 ? 'NEW PR' : 'SESSION'}
          <span style={{ width: isStory ? 60 : 40, height: 2, background: accent }} />
        </div>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: isStory ? 40 : isLandscape ? 26 : 32,
            fontWeight: 700,
            color: ink,
            letterSpacing: -1,
            marginBottom: isStory ? 12 : 8,
          }}
        >
          {session.topLift.name || session.title}
        </div>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: numSize,
            fontWeight: 800,
            color: ink,
            letterSpacing: -16,
            lineHeight: 0.85,
            fontVariantNumeric: 'tabular-nums',
            textShadow: `4px 4px 0 ${accent}28`,
          }}
        >
          {session.topLift.weight || session.volume || '—'}
        </div>
        <div
          style={{
            fontFamily: STRATA_FONT_DISPLAY,
            fontSize: isStory ? 38 : isLandscape ? 22 : 28,
            fontWeight: 700,
            color: subInk,
            letterSpacing: -0.4,
            marginTop: isStory ? 18 : 12,
          }}
        >
          {session.topLift.unit || 'lb'}
          {session.topLift.sets ? ` · ${session.topLift.sets}` : ''}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: padY,
          left: padX,
          right: padX,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: isStory ? 22 : 14,
          color: subInk,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, color: ink, letterSpacing: -0.2 }}>{session.title}</div>
          <div style={{ marginTop: 4 }}>
            {session.duration > 0 && `${session.duration}m`}
            {session.volume > 0 && ` · ${(session.volume / 1000).toFixed(1)}k lb`}
            {session.exercises > 0 && ` · ${session.exercises} ex`}
          </div>
        </div>
        <div style={{ width: isStory ? 6 : 4, height: isStory ? 70 : 44, background: accent }} />
      </div>
    </div>
  );
}

// ─── Public ShareCard ──────────────────────────────────────────────────────
// Renders the export image at native pixel size, scaled into displayW.
const TEMPLATES = {
  photo: ShareCardPhoto,
  stats: ShareCardStats,
  minimal: ShareCardMinimal,
};

export default function ShareCard({
  format = 'story',
  template = 'photo',
  displayW = 280,
  branding = true,
  accent = STRATA_HOT,
  filter = 'moody',
  stats = ['duration', 'volume', 'exercises', 'pr'],
  session = SAMPLE_SESSION,
  gymName = 'TuGymPR',
}) {
  const fmt = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const Tpl = TEMPLATES[template] || ShareCardPhoto;
  const scale = displayW / fmt.w;
  const displayH = fmt.h * scale;

  return (
    <div
      style={{
        position: 'relative',
        width: displayW,
        height: displayH,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
        background: '#000',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: fmt.w,
          height: fmt.h,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <Tpl
          fmt={fmt}
          branding={branding}
          accent={accent}
          filter={filter}
          stats={stats}
          session={session}
          gymName={gymName}
        />
      </div>
    </div>
  );
}
