import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Detects USB barcode/QR scanner input from TWO sources:
 *
 * 1. **HID keyboard mode (browser/Capacitor)** — scanner acts as a keyboard,
 *    typing characters at machine speed (2-5ms between chars) terminated by
 *    Enter. We distinguish from human typing via inter-character timing.
 *    Requires the window to be focused.
 *
 * 2. **USB-serial mode (Tauri desktop only)** — the OBZ scanner is switched
 *    to virtual COM mode and read directly by the Rust side, which emits
 *    `scan-received` Tauri events with the scanned text. Works regardless of
 *    window focus, so a hidden-to-tray app keeps capturing scans.
 *
 * Both inputs flow through the same `onScan` callback. The Tauri listener is
 * a no-op outside Tauri (event API import fails silently), so this hook stays
 * safe to use in the web/mobile builds where only path 1 applies.
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

    // Only accumulate single printable characters. Guard against synthetic
    // events from browser autofill / IME composition where `e.key` is undefined.
    if (typeof e.key !== 'string' || e.key.length !== 1) return;

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

  // ── Tauri USB-serial scanner channel ────────────────────────────────────
  // When running inside the Tauri desktop shell, the Rust side opens the
  // scanner's virtual COM port and forwards each barcode line via the
  // `scan-received` event. That path bypasses the focus dependency of the
  // keyboard channel above, so the scanner keeps working even when the
  // window is hidden in the system tray.
  //
  // Outside Tauri (mobile/web), `@tauri-apps/api/event` resolves but the
  // event channel is silent — so this listener subscribes but never fires.
  // The dynamic import keeps the bundle clean for mobile builds.
  useEffect(() => {
    if (!enabled) return;
    let unlistenFn = null;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('scan-received', (event) => {
          const text = event?.payload?.text;
          if (typeof text === 'string' && text.length >= minLength) {
            setLastScanTime(Date.now());
            onScanRef.current?.(text);
          }
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch {
        // Not running inside Tauri (or @tauri-apps/api not bundled) —
        // keyboard channel only. Silent failure is correct here.
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, [enabled, minLength]);

  return { lastScanTime, isConnected };
}
