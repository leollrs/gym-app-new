import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Detects USB HID barcode/QR scanner input.
 *
 * USB scanners act as keyboard devices: they type characters at machine speed
 * (2-5ms between chars) and terminate with Enter. This hook distinguishes
 * scanner bursts from human typing using an inter-character time threshold.
 *
 * @param {Object} opts
 * @param {(rawText: string) => void} opts.onScan  - Called with the scanned text
 * @param {boolean} [opts.enabled=true]             - Enable/disable the listener
 * @param {number}  [opts.charThresholdMs=50]       - Max ms between chars to count as scanner
 * @param {number}  [opts.minLength=6]              - Min chars to qualify as a scan
 */
export default function useBarcodeScanner({
  onScan,
  enabled = true,
  charThresholdMs = 50,
  minLength = 6,
} = {}) {
  const bufferRef = useRef('');
  const lastCharRef = useRef(0);
  const suppressingRef = useRef(false);
  const onScanRef = useRef(onScan);
  const [lastScanTime, setLastScanTime] = useState(0);

  // Keep callback ref fresh without re-attaching listener
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const isConnected = Date.now() - lastScanTime < 60_000;

  const handleKeyDown = useCallback((e) => {
    const now = performance.now();

    // Ignore modifier-only keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;

    // Enter = terminator
    if (e.key === 'Enter') {
      // console.log('[Scanner] Enter pressed, buffer:', bufferRef.current, 'len:', bufferRef.current.length);
      if (bufferRef.current.length >= minLength) {
        e.preventDefault();
        e.stopPropagation();
        const text = bufferRef.current;
        bufferRef.current = '';
        suppressingRef.current = false;
        setLastScanTime(Date.now());
        // console.log('[Scanner] SCAN DETECTED:', text);
        onScanRef.current?.(text);
      } else {
        bufferRef.current = '';
        suppressingRef.current = false;
      }
      return;
    }

    // Escape clears buffer
    if (e.key === 'Escape') {
      bufferRef.current = '';
      suppressingRef.current = false;
      return;
    }

    // Only accumulate single printable characters
    if (e.key.length !== 1) return;

    const gap = now - lastCharRef.current;
    lastCharRef.current = now;

    if (gap < charThresholdMs || bufferRef.current.length === 0) {
      bufferRef.current += e.key;

      // After 3+ fast chars, start suppressing input to focused fields
      if (bufferRef.current.length >= 3) {
        suppressingRef.current = true;
      }
    } else {
      // Gap too long — human typing, reset
      if (bufferRef.current.length > 1) {
        // console.log('[Scanner] Buffer reset (gap too long:', Math.round(gap), 'ms), had:', bufferRef.current);
      }
      bufferRef.current = e.key;
      suppressingRef.current = false;
    }

    // Suppress scanner chars from reaching input fields
    if (suppressingRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [charThresholdMs, minLength]);

  useEffect(() => {
    if (!enabled) return;

    // Use capture phase to intercept before input fields see the events
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      bufferRef.current = '';
      suppressingRef.current = false;
    };
  }, [enabled, handleKeyDown]);

  return { lastScanTime, isConnected };
}
