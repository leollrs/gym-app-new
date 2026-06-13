import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/**
 * True while the on-screen keyboard is visible.
 *
 * Used by the bottom navigation docks (member / trainer / platform) to hide
 * themselves while typing — the iOS webview resizes with the keyboard, so a
 * `fixed bottom-0` dock would otherwise ride up and sit on top of it. App
 * rule: the footer is NEVER pushed up by the keyboard, it just disappears.
 *
 * Native: Capacitor Keyboard events. Web fallback: visualViewport heuristic
 * (>120px height loss ≈ keyboard).
 */
export default function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      const subs = [];
      let alive = true;
      (async () => {
        try {
          const s1 = await Keyboard.addListener('keyboardWillShow', () => alive && setOpen(true));
          const s2 = await Keyboard.addListener('keyboardWillHide', () => alive && setOpen(false));
          subs.push(s1, s2);
        } catch { /* plugin unavailable — keep docks visible */ }
      })();
      return () => { alive = false; subs.forEach((s) => s?.remove?.()); };
    }
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const onResize = () => setOpen(window.innerHeight - vv.height > 120);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return open;
}
