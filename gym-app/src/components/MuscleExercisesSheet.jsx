// MuscleExercisesSheet.jsx
//
// Center-aligned modal (per project convention — no bottom sheets) showing
// the exercises that target a tapped sub-region. Boxes are 2-per-row with
// the exercise's looping muted video as the background, name overlaid.
//
// "Ver todo [Group]" chip at the top broadens the filter from the sub-
// region (e.g. Upper Chest) to its whole parent group (Chest) — covers
// the common "I just want any chest exercise" case in two taps.

import { useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X, Layers } from 'lucide-react';
import { MUSCLE_BUCKET_BY_ID, GROUP_TO_REGIONS, bucketGroup } from '../lib/muscleBuckets';
import { exName } from '../lib/exerciseName';
import LazyVideoTile from './LazyVideoTile';

// Human-readable region labels used as subsection headers when expanded
// to a whole muscle group. Falls back to i18n if a key exists.
const REGION_LABEL_KEY = (regionId) => `readinessModal.regions.${regionId}`;

// Single exercise tile with looping video background + name overlay.
// Extracted so both the flat-grid and sub-sectioned renders use the same.
function ExerciseBox({ ex, t, onTap }) {
  const vsrc = videoSrc(ex);
  return (
    <button
      type="button"
      onClick={() => onTap?.(ex)}
      className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      {vsrc ? (
        <LazyVideoTile
          src={vsrc}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }}
        />
      ) : (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent)',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0) 100%)',
        }}
      />
      <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
        <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
          {exName(ex)}
        </p>
        {ex._matchKind === 'secondary' && (
          <p className="text-[9px] font-bold mt-0.5 opacity-80" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
            {t('exerciseLibrary.secondary', { defaultValue: 'Secondary' })}
          </p>
        )}
      </div>
    </button>
  );
}

const VIDEO_BASE = 'https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/';

/**
 * Filter all exercises by a region set. We use `muscleScores` as the
 * source of truth when available (≥60 → primary, ≥30 → secondary). The
 * curated `primaryRegions` / `secondaryRegions` arrays are spotty — many
 * exercises only list `mid_chest` even when their muscleScores show big
 * lower/upper-chest activation — so leaning on the scores produces far
 * better matches across all sub-buckets. Falls back to the region arrays
 * for exercises without muscleScores.
 */
function filterExercisesByRegions(exercises, regionSet) {
  if (!regionSet || regionSet.length === 0) return [];
  const targets = new Set(regionSet);
  const out = [];
  for (const ex of exercises) {
    let kind = null;
    let bestScore = 0;
    const scores = ex.muscleScores && typeof ex.muscleScores === 'object' ? ex.muscleScores : null;
    if (scores) {
      for (const r of targets) {
        const s = Number(scores[r]) || 0;
        if (s > bestScore) bestScore = s;
      }
      if (bestScore >= 60) kind = 'primary';
      else if (bestScore >= 30) kind = 'secondary';
    }
    if (!kind) {
      const primary = Array.isArray(ex.primaryRegions) ? ex.primaryRegions : [];
      const secondary = Array.isArray(ex.secondaryRegions) ? ex.secondaryRegions : [];
      if (primary.some((r) => targets.has(r))) kind = 'primary';
      else if (secondary.some((r) => targets.has(r))) kind = 'secondary';
    }
    if (kind) out.push({ ...ex, _matchKind: kind, _matchScore: bestScore });
  }
  // Primary before secondary, highest match score first, alphabetical tiebreak.
  out.sort((a, b) => {
    if (a._matchKind !== b._matchKind) return a._matchKind === 'primary' ? -1 : 1;
    if (b._matchScore !== a._matchScore) return (b._matchScore || 0) - (a._matchScore || 0);
    return exName(a).localeCompare(exName(b));
  });
  return out;
}

function videoSrc(ex) {
  const v = ex.videoUrl || ex.video_url || ex.video;
  if (!v) return null;
  // Already a full URL (https://, blob:, etc.) → use as-is. Otherwise treat
  // as a storage path under the exercise-videos bucket.
  if (/^(https?:|blob:|data:)/.test(v)) return v;
  return `${VIDEO_BASE}${v}`;
}

export default function MuscleExercisesSheet({
  open,
  bucketId,
  expandToGroup,
  exercises,
  onClose,
  onExerciseTap,
  onToggleExpand,
  customRegions = null,   // array of region IDs — overrides bucketId path (used by chip filters)
  customLabel = null,     // header label when customRegions is in play
}) {
  const { t } = useTranslation('pages');

  const bucket = bucketId ? MUSCLE_BUCKET_BY_ID.get(bucketId) : null;
  const group = bucket ? bucketGroup(bucket.id) : null;
  const usingCustom = Array.isArray(customRegions) && customRegions.length > 0;

  // When `customRegions` is supplied (chip filter), use those directly and
  // skip the bucket/group dance. Otherwise fall back to bucket → group.
  const activeRegions = useMemo(() => {
    if (usingCustom) return customRegions;
    if (expandToGroup && group) return GROUP_TO_REGIONS[group] || bucket?.regionIds || [];
    return bucket?.regionIds || [];
  }, [usingCustom, customRegions, bucket, group, expandToGroup]);

  const matched = useMemo(
    () => filterExercisesByRegions(exercises || [], activeRegions),
    [exercises, activeRegions]
  );

  // When expanded to a whole muscle group with multiple sub-regions, group
  // the matched exercises by their primary sub-region so the user can see
  // "Pecho superior / Pecho medio / Pecho inferior" instead of one flat
  // mash. Exercises whose primary regions don't fall in the group (i.e.
  // matched only as secondary) collect at the bottom.
  const sections = useMemo(() => {
    // Determine which regions to use as section keys:
    //  - customRegions: group by the supplied region set (chip filters)
    //  - expandToGroup: group by all regions in the parent muscle group
    //  - otherwise:    no grouping (flat grid)
    let sectionRegions = null;
    if (usingCustom) {
      sectionRegions = customRegions;
    } else if (expandToGroup && group) {
      sectionRegions = GROUP_TO_REGIONS[group] || null;
    }
    if (!sectionRegions || sectionRegions.length < 2) return null;
    const buckets = sectionRegions.map((r) => ({ regionId: r, items: [] }));
    const secondaryBucket = { regionId: '__secondary', items: [] };
    for (const ex of matched) {
      // Prefer the region with the highest muscleScore inside this section
      // set — way more accurate than primaryRegions, which often only lists
      // mid_chest even when lower_chest is the bigger hit (dips, decline).
      const scores = ex.muscleScores && typeof ex.muscleScores === 'object' ? ex.muscleScores : null;
      let bestRegion = null;
      let bestScore = 0;
      if (scores) {
        for (const b of buckets) {
          const s = Number(scores[b.regionId]) || 0;
          if (s > bestScore) { bestScore = s; bestRegion = b.regionId; }
        }
      }
      if (!bestRegion) {
        const primary = Array.isArray(ex.primaryRegions) ? ex.primaryRegions : [];
        const fallback = buckets.find((b) => primary.includes(b.regionId));
        bestRegion = fallback?.regionId || null;
      }
      const target = bestRegion ? buckets.find((b) => b.regionId === bestRegion) : null;
      if (target) target.items.push(ex);
      else secondaryBucket.items.push(ex);
    }
    const filled = buckets.filter((b) => b.items.length > 0);
    if (secondaryBucket.items.length > 0) filled.push(secondaryBucket);
    return filled;
  }, [matched, usingCustom, customRegions, expandToGroup, group]);

  // Lock scroll while the sheet is mounted (single-owner pattern — no
  // parent should also lock, otherwise the save-restore order races and
  // leaves overflow:hidden stuck).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (typeof document === 'undefined') return null;

  const headerLabel = usingCustom
    ? (customLabel || '')
    : expandToGroup && group
    ? t(`muscleGroups.${group}`, group)
    : t(`readinessModal.buckets.${bucket?.id}`, { defaultValue: bucket?.label || '' });

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            className="relative w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: 'var(--color-bg-deep)',
              border: '1px solid var(--color-border-subtle)',
              maxHeight: '82vh',
            }}
            initial={{ y: 24, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            role="dialog"
            aria-modal="true"
            aria-label={headerLabel}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-5 py-4"
              style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-muted)' }}>
                  {usingCustom
                    ? t('exerciseLibrary.filter', { defaultValue: 'Filter' })
                    : expandToGroup && group
                    ? t('exerciseLibrary.allOfGroup', { defaultValue: 'All of' })
                    : t('exerciseLibrary.muscle', { defaultValue: 'Muscle' })}
                </p>
                <h2 className="text-[18px] font-extrabold leading-snug truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {headerLabel}
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('exerciseLibrary.countExercises', { count: matched.length, defaultValue: `${matched.length} exercises` })}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close', 'Close')}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors"
              >
                <X size={16} style={{ color: 'var(--color-text-muted)' }} />
              </button>
            </div>

            {/* "Ver todo [Group]" expand chip — only show if there IS a parent
                group AND we're currently zoomed on a sub-region. */}
            {!usingCustom && group && bucket && !expandToGroup && (
              <button
                type="button"
                onClick={() => onToggleExpand?.(true)}
                className="mx-5 my-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold transition-colors"
                style={{
                  background: 'var(--color-surface-hover)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <Layers size={13} />
                {t('exerciseLibrary.seeAllOfGroup', {
                  group: t(`muscleGroups.${group}`, group),
                  defaultValue: `Ver todo ${group}`,
                })}
              </button>
            )}
            {!usingCustom && group && expandToGroup && (
              <button
                type="button"
                onClick={() => onToggleExpand?.(false)}
                className="mx-5 my-3 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold transition-colors"
                style={{
                  background: 'var(--color-surface-hover)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {t('exerciseLibrary.backToSubregion', {
                  region: bucket.label,
                  defaultValue: `Solo ${bucket.label}`,
                })}
              </button>
            )}

            {/* Grid (flat) or sub-sectioned list (when expanded to group) */}
            <div className="px-5 pb-5 overflow-y-auto" style={{ flex: 1 }}>
              {matched.length === 0 ? (
                <div
                  className="rounded-2xl py-10 px-4 text-center"
                  style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}
                >
                  <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('exerciseLibrary.noExercisesForMuscle', { defaultValue: 'No exercises here yet' })}
                  </p>
                </div>
              ) : sections ? (
                // Subsectioned view (Ver todo Pecho → upper / mid / lower / serrato).
                <div className="flex flex-col gap-5">
                  {sections.map((section) => {
                    const sectionLabel = section.regionId === '__secondary'
                      ? t('exerciseLibrary.secondary', { defaultValue: 'Secundario' })
                      : t(REGION_LABEL_KEY(section.regionId), { defaultValue: section.regionId });
                    return (
                      <div key={section.regionId}>
                        <p
                          className="text-[10px] font-extrabold uppercase tracking-[0.12em] mb-2.5"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {sectionLabel} · {section.items.length}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {section.items.map((ex) => (
                            <ExerciseBox key={ex.id} ex={ex} t={t} onTap={onExerciseTap} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {matched.map((ex) => (
                    <ExerciseBox key={ex.id} ex={ex} t={t} onTap={onExerciseTap} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
