// ExerciseVideoThumb — a real still frame of an exercise (the demo video's first
// frame, seeked via the #t=0.1 media fragment) so lists, equipment tiles, and the
// onboarding preview SHOW the movement instead of a generic icon.
//
// Lazy by design: the <video> only mounts once the tile scrolls near the viewport
// (IntersectionObserver, 200px margin), so a long list never fires hundreds of
// metadata requests at once. Falls back to a muscle-tinted dumbbell when an
// exercise has no video yet.
//
// Self-contained (its own resolveVideoUrl + tint map) so it can be imported into
// the onboarding path WITHOUT dragging in the heavy ExerciseLibrary module.

import { useEffect, useRef, useState } from 'react';
import { Dumbbell, Play } from 'lucide-react';
import { supabase } from '../lib/supabase';

const MUSCLE_TINTS = {
  Chest: '#E8927C', Back: '#7CA8E8', Shoulders: '#C9A84C', Biceps: '#C9A84C',
  Triceps: '#E8A87C', Legs: '#6BC4A6', Glutes: '#E8A87C', Core: '#7CB8E8',
  Calves: '#6BC4A6', Forearms: '#C9A84C', Traps: '#7CA8E8', 'Full Body': '#8B95A5',
};
const tintFor = (muscle) => MUSCLE_TINTS[muscle] || '#C9A84C';

/** Resolve a stored video path to a full public URL. */
function resolveVideoUrl(path) {
  if (!path) return null;
  if (path.startsWith('/') || path.startsWith('http')) return path;
  const { data } = supabase.storage.from('exercise-videos').getPublicUrl(path);
  return data?.publicUrl || null;
}

export default function ExerciseVideoThumb({ exercise, size = 46, radius = 13, fill = false, showBadge = true, className = '', style = {} }) {
  const src = exercise?.videoUrl ? resolveVideoUrl(exercise.videoUrl) : null;
  const tint = tintFor(exercise?.muscle);
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!src || inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [src, inView]);

  const box = fill
    ? { position: 'absolute', inset: 0, overflow: 'hidden', ...style }
    : { width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden', position: 'relative', ...style };
  const iconSize = fill ? 34 : Math.round(size * 0.4);

  if (!src) {
    return (
      <div ref={ref} className={className}
        style={{ ...box, background: `${tint}12`, border: fill ? 'none' : `1px solid ${tint}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Dumbbell size={iconSize} strokeWidth={2} style={{ color: tint }} />
      </div>
    );
  }
  return (
    <div ref={ref} className={className}
      style={{ ...box, background: 'var(--color-bg-primary)', border: fill ? 'none' : '1px solid var(--color-border-subtle)' }}>
      {inView && (
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          className="w-full h-full object-cover"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {showBadge && (
        <span style={{ position: 'absolute', right: 3, bottom: 3, width: Math.max(14, size * 0.28), height: Math.max(14, size * 0.28), borderRadius: '50%', background: 'rgba(10,13,16,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
          <Play size={Math.max(8, size * 0.15)} strokeWidth={2.5} style={{ color: '#fff', marginLeft: 1 }} fill="#fff" />
        </span>
      )}
    </div>
  );
}
