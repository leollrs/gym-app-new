// AllExercisesModal.jsx
//
// Fullscreen browse modal opened by tapping the search bar in the
// Exercise Library. Reuses the same video-bg tile style as the muscle-
// specific sheet so the visual language stays consistent. Search input
// + quick chip filters at the top, exercise grid below.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Search } from 'lucide-react';
import { exName } from '../lib/exerciseName';
import LazyVideoTile from './LazyVideoTile';

const VIDEO_BASE = 'https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/';

function videoSrc(ex) {
  const v = ex.videoUrl || ex.video_url || ex.video;
  if (!v) return null;
  if (/^(https?:|blob:|data:)/.test(v)) return v;
  return `${VIDEO_BASE}${v}`;
}

function ExerciseBox({ ex, onTap }) {
  const vsrc = videoSrc(ex);
  return (
    <button
      type="button"
      onClick={() => onTap?.(ex)}
      className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
    >
      {vsrc ? (
        <LazyVideoTile
          src={vsrc}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent)' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0) 100%)' }} />
      <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
        <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
          {exName(ex)}
        </p>
      </div>
    </button>
  );
}

export default function AllExercisesModal({
  open,
  onClose,
  exercises,
  onExerciseTap,
  initialSearch = '',
  initialChip = 'all',
  chipDefs = [],
  filterByChip,            // (exercise, chipId) => boolean
}) {
  const { t } = useTranslation('pages');
  const [search, setSearch] = useState(initialSearch);
  const [chip, setChip] = useState(initialChip);

  // Reset to the externally-provided starting state every time the modal opens
  // so chip taps from the parent surface here as the active chip.
  useEffect(() => {
    if (!open) return;
    setSearch(initialSearch);
    setChip(initialChip);
  }, [open, initialSearch, initialChip]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const list = (exercises || []).filter((ex) => {
      if (q) {
        const hay = `${ex.name || ''} ${ex.name_es || ''} ${ex.muscle || ''} ${ex.equipment || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (chip && chip !== 'all' && typeof filterByChip === 'function') {
        if (!filterByChip(ex, chip)) return false;
      }
      return true;
    });
    return list.sort((a, b) => exName(a).localeCompare(exName(b)));
  }, [exercises, search, chip, filterByChip]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: 'var(--color-bg-primary)',
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="h-full flex flex-col"
            >
              {/* Header — search input + close */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                <div
                  className="flex-1 flex items-center gap-2 rounded-[14px] px-3.5 py-2.5"
                  style={{ background: 'var(--color-bg-card)', border: '1.5px solid var(--color-border-subtle)' }}
                >
                  <Search size={16} strokeWidth={2} style={{ color: 'var(--color-text-subtle)' }} />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('exerciseLibrary.searchPlaceholder', 'Search exercises, muscles, gear…')}
                    className="flex-1 bg-transparent border-0 outline-none"
                    style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}
                    maxLength={100}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--color-surface-hover)' }}
                    >
                      <X size={12} style={{ color: 'var(--color-text-muted)' }} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('common.close', 'Close')}
                  className="min-w-[44px] min-h-[44px] rounded-[12px] flex items-center justify-center"
                  style={{ background: 'var(--color-surface-hover)' }}
                >
                  <X size={16} style={{ color: 'var(--color-text-muted)' }} />
                </button>
              </div>

              {/* Chips */}
              {chipDefs.length > 0 && (
                <div className="px-4 -mx-px overflow-x-auto no-scrollbar mb-2">
                  <div className="flex gap-1.5 whitespace-nowrap pb-1">
                    {chipDefs.map((c) => {
                      const active = c.id === chip;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setChip(c.id)}
                          className="text-[12px] font-bold px-3.5 py-1.5 rounded-full transition-all active:scale-95"
                          style={{
                            background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                            color: active ? 'var(--color-text-on-accent, #000)' : 'var(--color-text-muted)',
                            border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          }}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Count */}
              <div className="px-4 mb-2">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-muted)' }}>
                  {t('exerciseLibrary.countExercises', { count: filtered.length, defaultValue: `${filtered.length} exercises` })}
                </p>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto px-4 pb-6">
                {filtered.length === 0 ? (
                  <div
                    className="rounded-2xl py-12 px-4 text-center"
                    style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}
                  >
                    <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('exerciseLibrary.noExercisesFound', 'No exercises found')}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filtered.map((ex) => (
                      <ExerciseBox key={ex.id} ex={ex} onTap={onExerciseTap} />
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
