// Keep the focused text field visible when the native keyboard opens.
//
// THE PROBLEM: capacitor.config sets `Keyboard.resize: "native"`, so the WebView
// itself shrinks when the keyboard appears. WebKit then usually scrolls the
// focused element into view on its own — but only reliably when that element
// sits in the DOCUMENT's scroll flow. This app puts most inputs inside nested
// scroll containers (`overflow-y: auto` panels, bottom sheets, modals), and for
// those WebKit frequently does nothing: the field ends up underneath the
// keyboard with no way to see what you are typing. Reported on the Grocery List
// "new item" field; the same shape exists on every sheet in the app.
//
// THE FIX: one document-level listener. On keyboard-show — and on any focus
// change while the keyboard is already up — check whether the focused field is
// actually obscured, and only then scroll it into view.
//
// Deliberately conservative:
//   * It measures first and no-ops when the field is already visible, so it
//     cannot fight screens that do their own scrolling (Messages scrolls the
//     thread to its newest message on keyboardWillShow; that lands the composer
//     in view, this then sees it is visible and does nothing).
//   * `block: 'nearest'` — the browser's own MINIMUM-scroll calculation. Do not
//     "improve" this to 'center' or to hand-computed scrollTop arithmetic; both
//     were tried and both over-scroll, because WebKit is already running its own
//     animated scroll and anything non-minimal composes badly with it.
//   * Opt out per element with `data-no-kb-scroll` if a surface ever needs to
//     own this behaviour completely.
//
// Web/PWA is untouched: browsers there resize the visual viewport and handle
// this natively, and Keyboard plugin events don't fire off-device anyway.

import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

const EDITABLE = 'input, textarea, [contenteditable="true"]';

function focusedEditable() {
  const el = document.activeElement;
  if (!el || !el.matches?.(EDITABLE)) return null;
  if (el.closest('[data-no-kb-scroll]')) return null;
  // Fields that never take a keyboard (checkbox, file, the QR scanner's hidden
  // capture input) would otherwise get scrolled to on a stray focus.
  if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'file', 'hidden', 'range', 'button', 'submit'].includes(el.type)) return null;
  return el;
}

/**
 * Bring the focused field above the keyboard — using the browser's own minimal
 * scroll calculation, not hand-rolled arithmetic.
 *
 * `block: 'nearest'` is the whole answer and it took three tries to get here:
 *   - `block: 'center'` deliberately CENTRES the element, i.e. over-scrolls by
 *     design. That was attempt one.
 *   - Computing a delta and assigning `scrollTop` was attempt two, and it is
 *     strictly worse: WebKit runs its own animated scroll when the WebView
 *     resizes around a focused field, so our delta lands ON TOP of WebKit's and
 *     the field shoots far above the keyboard.
 *   - `'nearest'` scrolls the MINIMUM needed, is a no-op when the element is
 *     already visible, and — crucially — is idempotent, so it composes with
 *     WebKit's scroll instead of fighting it.
 *
 * The measurement below is only a gate (should we act at all), never the amount.
 */
function revealFocused(keyboardHeight) {
  const el = focusedEditable();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // With resize:"native" the WebView is already shorter, so innerHeight excludes
  // the keyboard and `keyboardHeight` contributes nothing. On any platform or
  // version where the viewport is NOT resized, subtracting the reported height
  // is what keeps this from being a permanent no-op.
  const visibleBottom = window.innerHeight - (keyboardHeight || 0);
  // Must match `scroll-margin-bottom` on inputs in index.css. If this gate is
  // looser than the scroll-margin, a field whose PADDED WRAPPER is still clipped
  // reads as "visible" here and never gets corrected — which is exactly how the
  // field ended up flush against the keyboard edge with its border cut off.
  const GAP = 28;
  if (rect.bottom <= visibleBottom - GAP && rect.top >= 0) return;  // already fine

  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

let installed = false;

/** Install once, at app bootstrap. Safe to call on web (no-ops). */
export function installKeyboardScrollIntoView() {
  if (installed || !Capacitor.isNativePlatform() || !Keyboard) return () => {};
  installed = true;

  const handles = [];
  // `DidShow` (not WillShow): the viewport has finished resizing by then, so the
  // measurement above reflects reality. WillShow measures the pre-resize layout
  // and would misjudge whether the field is covered.
  Keyboard.addListener('keyboardDidShow', (info) => {
    const kb = info?.keyboardHeight ?? 0;
    // ONE pass, and a late one — this is the whole trick.
    //
    // WebKit runs its OWN scroll adjustment when the WebView resizes around a
    // focused field, and that scroll is animated. Measuring while it is still
    // in flight sees the field at its pre-scroll position, so we add a delta
    // WebKit is about to apply as well and the field ends up pushed far above
    // the keyboard. That was the "now it pushes it too high" bug — the earlier
    // rAF + 150ms passes were both landing mid-animation.
    //
    // 350ms is after the resize reflow AND after WebKit's own scroll settles, so
    // we measure the real resting position and only correct what is genuinely
    // still covered. The second pass is a safety net for slow devices; it no-ops
    // whenever the first one already did the job.
    setTimeout(() => revealFocused(kb), 350);
    setTimeout(() => revealFocused(kb), 700);
  }).then((h) => handles.push(h));

  // Focus moving between fields while the keyboard stays up fires no Keyboard
  // event at all — e.g. tabbing from "item name" to "quantity" on a sheet.
  const onFocusIn = () => {
    if (!focusedEditable()) return;
    // Same 350ms as above, for the same reason: focusing a second field while
    // the keyboard is already up still triggers a WebKit scroll, and measuring
    // during it double-counts. This path is also the one that fires on
    // `autoFocus` before the keyboard exists — there the viewport is still full
    // height, `revealFocused` measures no overflow and correctly does nothing,
    // leaving the work to keyboardDidShow.
    setTimeout(() => revealFocused(0), 350);
  };
  document.addEventListener('focusin', onFocusIn);

  return () => {
    handles.forEach((h) => h.remove());
    document.removeEventListener('focusin', onFocusIn);
    installed = false;
  };
}
