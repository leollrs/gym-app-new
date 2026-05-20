import { createContext, useContext, useState, useCallback, useMemo } from 'react';

// Shared date-range state for the Insights pages (Analytics, Attendance,
// Revenue, NPS). Lets the admin pick "90 days" once on one page and have
// it propagate to the others, instead of resetting per page.
//
// Canonical value is `periodDays` — number of days back, or null for "all
// time." Each page renders its own selector UI with its own option set;
// the context just stores whatever the user picked last. If a page doesn't
// offer the current value, it falls back to its default for display +
// data fetching without overwriting the shared state.

const InsightsRangeContext = createContext({
  periodDays: 30,
  setPeriodDays: () => {},
});

export function InsightsRangeProvider({ children, initialDays = 30 }) {
  const [periodDays, setPeriodDaysRaw] = useState(initialDays);
  const setPeriodDays = useCallback((days) => {
    // Accept number or null; coerce strings ("30") for older call sites.
    if (days === null || days === undefined) return setPeriodDaysRaw(null);
    const n = Number(days);
    setPeriodDaysRaw(Number.isFinite(n) ? n : null);
  }, []);

  const value = useMemo(() => ({ periodDays, setPeriodDays }), [periodDays, setPeriodDays]);
  return (
    <InsightsRangeContext.Provider value={value}>
      {children}
    </InsightsRangeContext.Provider>
  );
}

export function useInsightsRange() {
  return useContext(InsightsRangeContext);
}
