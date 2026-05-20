import { useState, useCallback } from 'react';

/**
 * Cap a long client-rendered list at `initial` items, with a "load more"
 * action that reveals `step` more at a time. Keeps the DOM small on
 * gyms where lists can balloon (members table, activity feeds, etc.)
 * without forcing every list into a server-paginated query.
 *
 * Used by AdminMembers, AdminTrainers, AdminClasses, ReportsTab,
 * PostsTab, RewardLog, MorningQueuePanel, etc. Each consumer slices
 * its full array to `visibleCount` and renders a footer that shows
 * "Showing X of Y" + the loadMore CTA.
 *
 * @param {object} opts
 * @param {number} [opts.initial=10] - initial visible count
 * @param {number} [opts.step=10]    - how many more to reveal per click
 * @returns {{
 *   visibleCount: number,
 *   loadMore: () => void,
 *   collapse: () => void,
 *   reset: () => void,
 *   canLoadMore: (totalCount: number) => boolean,
 *   isCollapsible: (totalCount: number) => boolean,
 *   nextStepSize: (totalCount: number) => number,
 * }}
 */
export default function usePagedVisible({ initial = 10, step = 10 } = {}) {
  const [visibleCount, setVisibleCount] = useState(initial);

  const loadMore = useCallback(() => {
    setVisibleCount(n => n + step);
  }, [step]);

  const collapse = useCallback(() => {
    setVisibleCount(initial);
  }, [initial]);

  // Reset is the same as collapse but semantically signals "the underlying
  // data changed; start from the top" — consumers wire it to filter changes.
  const reset = useCallback(() => {
    setVisibleCount(initial);
  }, [initial]);

  const canLoadMore = useCallback((totalCount) => visibleCount < totalCount, [visibleCount]);
  const isCollapsible = useCallback(
    (totalCount) => visibleCount >= totalCount && visibleCount > initial,
    [visibleCount, initial],
  );
  const nextStepSize = useCallback(
    (totalCount) => Math.min(step, Math.max(0, totalCount - visibleCount)),
    [visibleCount, step],
  );

  return { visibleCount, loadMore, collapse, reset, canLoadMore, isCollapsible, nextStepSize };
}
