import { createContext, useContext, useRef, useCallback } from 'react';

/**
 * ScanClaimContext — allows a form/modal to temporarily "claim" physical
 * scanner input so it fills a field instead of triggering the default
 * check-in/purchase action pipeline.
 *
 * Only one component can claim at a time. Last claim wins.
 */
const ScanClaimContext = createContext(null);

export function ScanClaimProvider({ children }) {
  const claimRef = useRef(null);

  /**
   * Register a callback to receive the next scan(s).
   * Returns a release function to stop claiming.
   */
  const claimScan = useCallback((callback) => {
    claimRef.current = callback;
    return () => {
      // Only release if this is still the active claim
      if (claimRef.current === callback) {
        claimRef.current = null;
      }
    };
  }, []);

  /**
   * Check if there's an active claim and route the scan to it.
   * Returns true if claimed (caller should skip default handling).
   */
  const tryClaim = useCallback((rawText) => {
    if (claimRef.current) {
      claimRef.current(rawText);
      return true;
    }
    return false;
  }, []);

  return (
    <ScanClaimContext.Provider value={{ claimScan, tryClaim }}>
      {children}
    </ScanClaimContext.Provider>
  );
}

export function useScanClaimContext() {
  return useContext(ScanClaimContext);
}
