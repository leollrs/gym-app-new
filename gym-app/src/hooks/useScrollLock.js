import { useEffect } from 'react';

// Ref-counted body/scroll-region lock so an open modal freezes the page behind
// it (no background scroll / scroll-chaining on touch). Ref-counting means
// stacked modals (e.g. meal modal + its meal picker) stay locked until the LAST
// one closes. The actual freezing is done in index.css via the `modal-scroll-lock`
// class on <html>/<body> (which also targets the trainer scroll region, since on
// mobile the page scrolls inside that container, not <body>).
let lockCount = 0;

export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    lockCount += 1;
    document.documentElement.classList.add('modal-scroll-lock');
    document.body.classList.add('modal-scroll-lock');
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.documentElement.classList.remove('modal-scroll-lock');
        document.body.classList.remove('modal-scroll-lock');
      }
    };
  }, [active]);
}
