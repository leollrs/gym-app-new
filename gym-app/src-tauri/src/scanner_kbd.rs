// Global keyboard-hook scanner reader.
//
// This module exists to solve a specific problem: a USB barcode/QR scanner
// in default HID-keyboard mode types its scanned data as keystrokes into
// whichever window happens to be focused. When TuGymPR is hidden in the
// system tray, those keystrokes leak into Slack, the browser, a Word doc,
// wherever. The serial-port reader in `scanner.rs` solves the same problem
// in a cleaner way — but only after the user manually switches the scanner
// into USB-CDC / Virtual COM mode via a config barcode. Most owners won't
// do that.
//
// So: we install a low-level OS keyboard hook (via the `rdev` crate, which
// abstracts Win32 / CoreGraphics / X11 hook APIs). The hook fires for every
// keystroke on the entire system, before any application sees them.
// Pattern detection: if keystrokes arrive faster than a human can type
// (sub-50ms gaps) and end in Enter, that's a scanner burst — we swallow
// every keystroke in the burst (so nothing leaks into other apps) and
// emit the assembled string as a Tauri event.
//
// As a bonus, we also pop the main window open on a successful scan so the
// admin approval modal appears even if the window was hidden in the tray.
//
// Coexistence with scanner.rs:
//   - HID-keyboard mode scanner → keystrokes → caught here, serial port is empty
//   - USB-CDC mode scanner      → no keystrokes, serial port catches the data
//   Both modules can run simultaneously; only one fires per scan, depending
//   on whatever mode the physical scanner is in.

use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

// ── Tuning constants ─────────────────────────────────────────────────────
// Max gap (ms) between two characters that still counts as scanner input.
// USB HID scanners type at ~5ms inter-character intervals. Windows key
// repeat is ~33ms. 50ms catches scanners and excludes both human typing
// (~150ms typical) and key repeat.
const CHAR_GAP_MS: u128 = 50;
// Min length to qualify as a scan — anything shorter is probably someone
// mashing keys. QR codes and barcodes are universally longer than this.
const MIN_SCAN_LEN: usize = 6;
// Cap buffer length so a hung hook can't OOM the process. Real barcodes
// max at ~200 chars; 1024 leaves enormous headroom.
const MAX_BUFFER_LEN: usize = 1024;

// How many chars in a fast-burst before we engage suppression. Lower = less
// leakage but more false positives on rapid typing.
//   - With SUPPRESS_AFTER=3: first 2 chars of every scan leak through
//   - With SUPPRESS_AFTER=2: first 1 char leaks (we backspace it below)
//   - SUPPRESS_AFTER=1 would suppress on the first keystroke alone, but we
//     can't detect "fast" without a previous char to measure against — so
//     the minimum useful value is 2.
const SUPPRESS_AFTER: usize = 2;

struct HookState {
  buffer: String,
  last_keystroke: Option<Instant>,
  // Once we've accumulated `SUPPRESS_AFTER` fast chars in a row, we're
  // confident this is a scanner — start swallowing every subsequent
  // keystroke so the scanner's payload doesn't leak through. Reset on
  // terminator or timing gap.
  suppressing: bool,
}

impl HookState {
  const fn new() -> Self {
    Self {
      buffer: String::new(),
      last_keystroke: None,
      suppressing: false,
    }
  }

  fn reset(&mut self) {
    self.buffer.clear();
    self.suppressing = false;
  }
}

// One global state shared between the rdev-grab thread and the main thread.
// We use a Mutex (not AtomicBool / RwLock combos) because the operations
// are infrequent (~human-rate keystrokes) and the critical sections are
// tiny — contention is a non-issue.
static STATE: Mutex<HookState> = Mutex::new(HookState::new());

/// Spawn the global keyboard hook on a dedicated thread.
///
/// `rdev::grab` blocks the thread it's called on for the program's
/// lifetime, so it MUST run on its own thread. The closure given to
/// grab is `'static`, so we move-clone the AppHandle into it.
///
/// On Windows / macOS this installs a low-level OS-wide keyboard hook.
/// macOS additionally requires the user to grant Accessibility permission
/// (System Preferences → Privacy → Accessibility). On first launch macOS
/// will prompt; until granted, rdev::grab silently fails and the hook is
/// inactive (the serial-port path in `scanner.rs` still works fine).
pub fn spawn(app: AppHandle) {
  std::thread::spawn(move || {
    log::info!("[scanner_kbd] installing global keyboard hook");
    let app_for_callback = app.clone();

    // rdev::grab takes ownership of the callback. The callback returns
    // Option<Event>: Some(event) lets it pass through to whatever window
    // is focused; None blocks it entirely. Returning None is what makes
    // scanner keystrokes NOT leak into other apps.
    let callback = move |event: rdev::Event| -> Option<rdev::Event> {
      handle_event(&app_for_callback, event)
    };

    if let Err(e) = rdev::grab(callback) {
      // grab can fail on macOS without accessibility permission, or on
      // Linux without X11. We log and continue — the serial path is the
      // fallback, and the user can re-grant permission then restart.
      log::warn!("[scanner_kbd] rdev::grab error: {:?}", e);
    }
  });
}

fn handle_event(app: &AppHandle, event: rdev::Event) -> Option<rdev::Event> {
  use rdev::EventType;

  // We only care about KeyPress. KeyRelease and mouse events pass through
  // untouched. We also pass through any KeyPress that isn't part of a
  // scanner burst, so normal typing (and ordinary app shortcuts) work.
  let press = match event.event_type {
    EventType::KeyPress(k) => k,
    _ => return Some(event),
  };

  let now = Instant::now();
  let mut state = STATE.lock().expect("scanner_kbd state mutex poisoned");

  let gap_ms = state
    .last_keystroke
    .map(|t| now.duration_since(t).as_millis())
    .unwrap_or(u128::MAX);
  state.last_keystroke = Some(now);

  // Enter = terminator. If we've accumulated a long-enough fast burst,
  // emit it as a scan. Otherwise just reset state and let Enter through.
  if matches!(press, rdev::Key::Return | rdev::Key::KpReturn) {
    if state.buffer.len() >= MIN_SCAN_LEN && state.suppressing {
      let scanned = std::mem::take(&mut state.buffer);
      state.reset();
      // Drop the lock before we do anything that might call back into
      // Tauri (avoid potential reentrancy / deadlock).
      drop(state);
      emit_scan_and_show_window(app, scanned);
      return None; // Swallow this Enter — it's the scanner's, not a human's.
    }
    state.reset();
    return Some(event);
  }

  // Escape clears the buffer (matches the existing JS-side hook behavior).
  if matches!(press, rdev::Key::Escape) {
    state.reset();
    return Some(event);
  }

  // Anything that isn't a single printable char (function keys, arrows,
  // modifiers, etc.) — pass through untouched, reset burst tracking.
  let ch = match event.name.as_deref() {
    Some(s) if s.chars().count() == 1 => s.chars().next().unwrap(),
    _ => {
      // Don't reset suppressing here — modifier keys (Shift) within a
      // scanner burst are normal. But do leave the buffer alone too;
      // the next printable char will append correctly.
      return Some(event);
    }
  };

  // Printable char. Decide: is this part of a scanner burst, or just
  // human typing? Only push to the burst buffer if the gap is small.
  // The very first char of any input always passes through — we can't
  // know it's a scanner until char 2 arrives quickly after it.
  let was_suppressing_before = state.suppressing;

  if gap_ms < CHAR_GAP_MS {
    state.buffer.push(ch);
    if state.buffer.len() >= SUPPRESS_AFTER {
      state.suppressing = true;
    }
    if state.buffer.len() > MAX_BUFFER_LEN {
      log::warn!("[scanner_kbd] buffer overflow, clearing");
      state.reset();
    }
  } else {
    // Gap too long — this was a human, not a scanner. Reset and start
    // fresh with the current char as a possible burst-start.
    state.buffer.clear();
    state.buffer.push(ch);
    state.suppressing = false;
  }

  // Detect the transition from "not suppressing" to "suppressing." Exactly
  // one char already leaked through before we became confident (the very
  // first char of the burst, which we can't predict). Send a single
  // backspace to clean it up in whatever window had focus, so the user
  // never sees scanner gibberish typed anywhere.
  let just_engaged = !was_suppressing_before && state.suppressing;

  // While we're confident this is a scanner burst, swallow the keystroke
  // so it doesn't leak into whatever window has focus. Otherwise pass it
  // through — that lets human typing into other apps work normally even
  // with the hook installed.
  let result = if state.suppressing { None } else { Some(event) };

  // Drop the mutex before doing IO. Backspace injection happens on a
  // detached thread so the hook returns immediately — `rdev::simulate`
  // from inside the grab callback would deadlock the OS hook chain.
  drop(state);

  if just_engaged {
    std::thread::spawn(|| {
      use rdev::{simulate, EventType, Key};
      // KeyPress then KeyRelease — Windows treats these as one tap.
      let _ = simulate(&EventType::KeyPress(Key::Backspace));
      let _ = simulate(&EventType::KeyRelease(Key::Backspace));
    });
  }

  result
}

fn emit_scan_and_show_window(app: &AppHandle, scanned: String) {
  log::info!("[scanner_kbd] scan: {} chars", scanned.len());

  // Show + focus the main window so the approval modal becomes visible.
  // This is the key UX fix: scans no longer get lost when the window
  // is hidden in the tray. ScanFeedback.handleScan + the approval flow
  // takes over from here.
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }

  // Emit the scan to the JS layer. useBarcodeScanner already listens for
  // this event and feeds it into the existing scan pipeline.
  let _ = app.emit(
    "scan-received",
    serde_json::json!({
      "text": scanned,
      "source": "keyboard-hook",
    }),
  );
}
