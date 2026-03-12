import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Reaction definitions ────────────────────────────────────────────────────
const REACTIONS = [
  { type: 'strong',     emoji: '\uD83D\uDCAA', label: 'Strong' },
  { type: 'fire',       emoji: '\uD83D\uDD25', label: 'Fire' },
  { type: 'clap',       emoji: '\uD83D\uDC4F', label: 'Clap' },
  { type: 'legend',     emoji: '\uD83C\uDFC6', label: 'Legend' },
  { type: 'beast_mode', emoji: '\uD83D\uDE24', label: 'Beast Mode' },
];

const DEFAULT_REACTION = 'strong';

const EMOJI_MAP = Object.fromEntries(REACTIONS.map(r => [r.type, r.emoji]));

// ── ReactionPicker ──────────────────────────────────────────────────────────
const ReactionPicker = ({ feedItemId, currentUserId, currentReaction, reactionCounts, onReact }) => {
  const [showPicker, setShowPicker] = useState(false);
  const longPressTimer = useRef(null);
  const containerRef = useRef(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [showPicker]);

  // Quick tap: toggle default reaction. Long press / hover: open picker.
  const handlePointerDown = () => {
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setShowPicker(true);
    }, 400);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      // Quick tap — toggle default reaction
      onReact(feedItemId, DEFAULT_REACTION);
    }
  };

  const handlePointerLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleSelectReaction = (type) => {
    onReact(feedItemId, type);
    setShowPicker(false);
  };

  // Total count across all reaction types
  const totalCount = Object.values(reactionCounts ?? {}).reduce((s, n) => s + n, 0);

  // Sorted reaction entries for display (highest count first)
  const countEntries = Object.entries(reactionCounts ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div ref={containerRef} className="relative flex items-center gap-3">

      {/* ── Reaction trigger button ──────────────────────────────── */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onMouseEnter={() => setShowPicker(true)}
        className={`flex items-center gap-2 text-[13px] font-semibold transition-colors select-none ${
          currentReaction
            ? 'text-[#D4AF37]'
            : 'text-[#6B7280] hover:text-[#9CA3AF]'
        }`}
      >
        <span className="text-[16px] leading-none">
          {currentReaction ? (EMOJI_MAP[currentReaction] ?? '\uD83D\uDCAA') : '\uD83D\uDCAA'}
        </span>
        {totalCount > 0 ? totalCount : 'React'}
      </button>

      {/* ── Picker popup ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            onMouseLeave={() => setShowPicker(false)}
            className="absolute bottom-full left-0 mb-2 z-50 flex items-center gap-1 px-2 py-1.5 rounded-full bg-[#111827] border border-white/10 shadow-xl shadow-black/40"
          >
            {REACTIONS.map((r) => {
              const isActive = currentReaction === r.type;
              return (
                <motion.button
                  key={r.type}
                  type="button"
                  onClick={() => handleSelectReaction(r.type)}
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ scale: 1.25 }}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-[18px] transition-colors ${
                    isActive
                      ? 'bg-[#D4AF37]/20 ring-2 ring-[#D4AF37]/50'
                      : 'hover:bg-white/8'
                  }`}
                  title={r.label}
                >
                  {r.emoji}
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Grouped emoji counts ─────────────────────────────────── */}
      {countEntries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {countEntries.map(([type, count]) => (
            <motion.span
              key={type}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={`flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full ${
                currentReaction === type
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                  : 'bg-white/5 text-[#9CA3AF]'
              }`}
            >
              <span className="text-[13px]">{EMOJI_MAP[type]}</span>
              {count}
            </motion.span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReactionPicker;
export { REACTIONS, EMOJI_MAP, DEFAULT_REACTION };
