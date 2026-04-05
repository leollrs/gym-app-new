import { useEffect, useRef } from 'react';
import { useScanClaimContext } from '../contexts/ScanClaimContext';

/**
 * Convenience hook to claim physical scanner input for a form field.
 * While enabled, scans go to `onScan` instead of the default ScanFeedback pipeline.
 * Automatically releases on unmount.
 *
 * @param {(rawText: string) => void} onScan - Callback for scanned text
 * @param {boolean} enabled - Whether to actively claim (default true)
 */
export default function useScanClaim(onScan, enabled = true) {
  const ctx = useScanClaimContext();
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!enabled || !ctx) return;
    const release = ctx.claimScan((rawText) => onScanRef.current?.(rawText));
    return release;
  }, [enabled, ctx]);
}
