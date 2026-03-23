import { useRef, useEffect } from 'react';

// ── Particle colors (gold / amber / orange / white) ────────────────────────────
const COLORS = ['#D4AF37', '#F59E0B', '#FF8A00', '#E5E7EB'];

// ── Create a single particle ───────────────────────────────────────────────────
function createParticle(canvasW, canvasH) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 2 + Math.random() * 4;
  return {
    x: canvasW * (0.3 + Math.random() * 0.4),
    y: canvasH * 0.15 + Math.random() * canvasH * 0.05,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 2,
    w: 4 + Math.random() * 4,
    h: 3 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * 360,
    spin: (Math.random() - 0.5) * 8,
    opacity: 1,
    isCircle: Math.random() > 0.5,
  };
}

// ── Confetti ───────────────────────────────────────────────────────────────────
// Lightweight canvas-based confetti burst for PR celebrations.
// Fires once when `active` flips to true, then auto-cleans up.
export default function Confetti({
  active = false,
  duration = 2000,
  particleCount = 50,
  onComplete,
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Fire once when active becomes true
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    const particles = Array.from({ length: particleCount }, () =>
      createParticle(w, h),
    );
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);

      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.vy += 0.12;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        p.opacity = progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1;
        if (p.opacity <= 0) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.isCircle) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }

        ctx.restore();
      }

      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
        onCompleteRef.current?.();
      }
    }

    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [active, duration, particleCount]); // stable deps only

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[201]"
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
