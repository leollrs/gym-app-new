import React, { useState, useEffect, useCallback } from 'react';

// ── AchievementToast ──────────────────────────────────────────────────────────
// Full-screen celebration overlay that sequences through earned achievements.
// Props:
//   achievements: array of achievement defs (from ACHIEVEMENT_DEFS)
//   onDone: callback fired when all achievements have been shown
export default function AchievementToast({ achievements, onDone }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Animate in on mount / when index changes
  useEffect(() => {
    if (!achievements?.length) return;
    setVisible(false);
    setExiting(false);
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, [index, achievements]);

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => advance(), 4000);
    return () => clearTimeout(t);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      const next = index + 1;
      if (next >= (achievements?.length ?? 0)) {
        onDone?.();
      } else {
        setIndex(next);
      }
    }, 350);
  }, [index, achievements, onDone]);

  if (!achievements?.length) return null;

  const current = achievements[index];
  if (!current) return null;

  const isVisible = visible && !exiting;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={advance}
      style={{
        background: 'rgba(5,7,11,0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        transition: 'opacity 350ms ease',
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        cursor: 'pointer',
      }}
    >
      {/* Radial glow behind card */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 50%, ${current.color}22 0%, transparent 70%)`,
          transition: 'opacity 350ms ease',
          opacity: isVisible ? 1 : 0,
        }}
      />

      {/* Card */}
      <div
        className="relative flex flex-col items-center text-center px-8 py-10 mx-6"
        style={{
          background: 'linear-gradient(160deg, #0F172A 0%, #111827 100%)',
          border: `1.5px solid ${current.color}55`,
          borderRadius: 28,
          boxShadow: `0 0 0 1px ${current.color}22, 0 8px 64px ${current.color}33, 0 0 120px ${current.color}18`,
          maxWidth: 340,
          width: '100%',
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.88) translateY(20px)',
          transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 350ms ease',
          opacity: isVisible ? 1 : 0,
        }}
      >
        {/* Header label */}
        <p
          className="text-[11px] font-bold uppercase tracking-[0.22em] mb-6"
          style={{ color: current.color }}
        >
          Achievement Unlocked
        </p>

        {/* Icon badge */}
        <div
          className="relative mb-6 flex items-center justify-center"
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            background: `${current.color}18`,
            border: `2px solid ${current.color}55`,
            boxShadow: `0 0 32px ${current.color}44, inset 0 1px 0 ${current.color}33`,
          }}
        >
          {/* Shimmer ring */}
          <div
            className="absolute inset-0 rounded-[24px] pointer-events-none"
            style={{
              background: `conic-gradient(from 0deg, transparent 0%, ${current.color}60 25%, transparent 50%, ${current.color}40 75%, transparent 100%)`,
              animation: 'spin 3s linear infinite',
              borderRadius: 24,
              mask: 'radial-gradient(ellipse at center, transparent 60%, black 65%)',
              WebkitMask: 'radial-gradient(ellipse at center, transparent 60%, black 65%)',
            }}
          />
          <span style={{ fontSize: 44, lineHeight: 1, userSelect: 'none' }}>
            {current.icon}
          </span>
        </div>

        {/* Name */}
        <h2
          className="text-[26px] font-black leading-tight mb-2"
          style={{
            color: '#E5E7EB',
            fontFamily: "'Barlow Condensed', sans-serif",
            letterSpacing: '-0.01em',
          }}
        >
          {current.label}
        </h2>

        {/* Description */}
        <p className="text-[14px] leading-relaxed mb-8" style={{ color: '#9CA3AF' }}>
          {current.desc}
        </p>

        {/* Dismiss hint */}
        <p className="text-[11px]" style={{ color: '#4B5563' }}>
          Tap anywhere to continue
        </p>

        {/* Multiple achievements indicator */}
        {achievements.length > 1 && (
          <div className="flex items-center gap-1.5 mt-4">
            {achievements.map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === index ? 16 : 5,
                  height: 5,
                  borderRadius: 99,
                  background: i === index ? current.color : '#374151',
                  transition: 'width 300ms ease, background 300ms ease',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Particle sparkles */}
      {isVisible && (
        <>
          {[...Array(8)].map((_, i) => {
            const angle = (i / 8) * 360;
            const distance = 160 + (i % 3) * 40;
            const rad = (angle * Math.PI) / 180;
            const x = Math.cos(rad) * distance;
            const y = Math.sin(rad) * distance;
            return (
              <div
                key={i}
                className="absolute pointer-events-none"
                style={{
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  width: i % 2 === 0 ? 6 : 4,
                  height: i % 2 === 0 ? 6 : 4,
                  borderRadius: '50%',
                  background: current.color,
                  opacity: 0.5 + (i % 3) * 0.15,
                  animation: `pulse ${1.2 + (i % 3) * 0.4}s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            );
          })}
        </>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          from { opacity: 0.2; transform: scale(0.7); }
          to { opacity: 0.8; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
