import React, { useRef, useEffect, useCallback } from 'react';

// ── Particle colors (gold / amber / orange / white) ────────────────────────────
const COLORS = ['#D4AF37', '#F59E0B', '#FF8A00', '#E5E7EB'];

// ── Create a single particle ───────────────────────────────────────────────────
function createParticle(canvasW, canvasH) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 2 + Math.random() * 4;
  return {
    x: canvasW * (0.3 + Math.random() * 0.4), // center-ish horizontally
    y: canvasH * 0.15 + Math.random() * canvasH * 0.05, // top area
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 2, // slight upward bias
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
export default function Confetti({
  active = false,
  duration = 2000,
  particleCount = 50,
  onComplete,
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const startRef = useRef(null);
  const particlesRef = useRef([]);

  const stop = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    particlesRef.current = [];
    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const run = useCallback(() => {
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

    // Spawn particles
    particlesRef.current = Array.from({ length: particleCount }, () =>
      createParticle(w, h),
    );
    startRef.current = performance.now();

    function tick(now) {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      ctx.clearRect(0, 0, w, h);

      const gravity = 0.12;
      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        // Fade out in the last 40%
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
        stop();
        onComplete?.();
      }
    }

    animRef.current = requestAnimationFrame(tick);
  }, [duration, particleCount, onComplete, stop]);

  // Trigger on active change
  useEffect(() => {
    if (active) {
      stop();
      run();
    } else {
      stop();
    }
    return stop;
  }, [active, run, stop]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
