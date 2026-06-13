import { useEffect, useState } from 'react';

/**
 * Increments when appResume decides the routed page should remount after a
 * long hidden spell (event fired with a fresh auth token already in hand).
 * App.jsx keys <Routes> with this, so EVERY page's own load logic re-runs —
 * including pages that fetch with plain useEffect/useState and are invisible
 * to queryClient.invalidateQueries().
 */
export default function useResumeEpoch() {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setEpoch((e) => e + 1);
    window.addEventListener('tugympr:resume-remount', bump);
    return () => window.removeEventListener('tugympr:resume-remount', bump);
  }, []);

  return epoch;
}
