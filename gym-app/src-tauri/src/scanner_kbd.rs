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
  // Shift modifier tracking. rdev's `event.name` is supposed to apply
  // shift state automatically, but on Windows it can race — when the
  // hook fires for the press of a shifted key, the OS keyboard-state
  // hasn't always updated with Shift-down yet, so `event.name` returns
  // the unshifted char (`;` instead of `:`, `\` instead of `|`). That's
  // catastrophic for QR scans: stripping every `:` and `|` corrupts the
  // payload past recognition. We track Shift ourselves and apply it via
  // our own Key→char mapping, which gives consistent results.
  shift_held: bool,
}

impl HookState {
  const fn new() -> Self {
    Self {
      buffer: String::new(),
      last_keystroke: None,
      suppressing: false,
      shift_held: false,
    }
  }

  fn reset(&mut self) {
    self.buffer.clear();
    self.suppressing = false;
    // Leave shift_held alone — the OS modifier state outlives our burst.
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

  // We care about both KeyPress and KeyRelease, but only for narrow reasons:
  // KeyRelease lets us track Shift-up so our shift_held flag stays in sync;
  // KeyPress drives the scanner-burst detection. Everything else passes
  // through unmodified.
  match &event.event_type {
    EventType::KeyRelease(k) => {
      if matches!(k, rdev::Key::ShiftLeft | rdev::Key::ShiftRight) {
        let mut state = STATE.lock().expect("scanner_kbd state mutex poisoned");
        state.shift_held = false;
      }
      return Some(event);
    }
    EventType::KeyPress(_) => {}
    _ => return Some(event),
  }
  let press = match event.event_type {
    EventType::KeyPress(k) => k,
    _ => return Some(event),
  };

  // Update shift state on Shift-down. We don't use this as a "burst" key
  // since Shift alone is held for ~ms per shifted char and confuses the
  // gap detector. Pass through and return early.
  if matches!(press, rdev::Key::ShiftLeft | rdev::Key::ShiftRight) {
    let mut state = STATE.lock().expect("scanner_kbd state mutex poisoned");
    state.shift_held = true;
    // Returning None here would swallow user Shift presses when no burst
    // is active — undesirable. Pass through.
    return Some(event);
  }

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

  // Derive the printable char ourselves rather than trusting `event.name`.
  // On Windows, rdev's name field can lag the OS keyboard state — Shift-down
  // and the shifted key arrive close enough together that `name` sometimes
  // returns the unshifted glyph (`;` instead of `:`, `\` instead of `|`).
  // For a 200-char signed QR payload, even one missing `:` corrupts the
  // payload past parser recognition and the scan gets routed to the
  // check-in catch-all by mistake. Our own mapping uses our shift_held
  // flag (updated on the Shift-down event we processed above) which is
  // race-free with respect to the KeyPress events that follow it.
  let ch = match key_to_char(press, state.shift_held) {
    Some(c) => c,
    None => {
      // Pass through and don't disturb burst tracking — non-printable keys
      // (function keys, arrows) between scanner bursts are normal.
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

// Map an rdev::Key to its US-keyboard-layout character, respecting shift
// state. Covers every printable character a typical QR/barcode scanner
// emits: alphanumerics, common punctuation, separator chars (`:`, `|`,
// `-`, `=`, `/`, `\`, etc.). Returns None for non-printable keys
// (modifiers, arrows, function keys) so the caller can pass them through
// without disturbing burst tracking.
//
// We hard-code the US layout because virtually every gym in PR uses
// US-layout keyboards and the scanner emits the corresponding scancodes.
// If a gym ever has a Spanish-layout keyboard with a scanner that maps
// to different physical keys for `:` / `|`, we'd need to teach this
// function the alternate layout (or read the layout from the OS).
fn key_to_char(key: rdev::Key, shift: bool) -> Option<char> {
  use rdev::Key;
  let c = match key {
    // Digit row — Shift gives the symbol above each number.
    Key::Num1 => if shift { '!' } else { '1' },
    Key::Num2 => if shift { '@' } else { '2' },
    Key::Num3 => if shift { '#' } else { '3' },
    Key::Num4 => if shift { '$' } else { '4' },
    Key::Num5 => if shift { '%' } else { '5' },
    Key::Num6 => if shift { '^' } else { '6' },
    Key::Num7 => if shift { '&' } else { '7' },
    Key::Num8 => if shift { '*' } else { '8' },
    Key::Num9 => if shift { '(' } else { '9' },
    Key::Num0 => if shift { ')' } else { '0' },

    // Letters — Shift gives uppercase. We don't factor in Caps Lock
    // here: QR scanners drive Shift explicitly when they want uppercase,
    // and downstream parseQRContent is case-insensitive for prefix
    // detection (the case-flipping fix already shipped). The handful of
    // gyms whose admin PC has Caps Lock on by accident would get all-
    // uppercase output, which DB lookups handle fine for UUIDs.
    Key::KeyA => if shift { 'A' } else { 'a' },
    Key::KeyB => if shift { 'B' } else { 'b' },
    Key::KeyC => if shift { 'C' } else { 'c' },
    Key::KeyD => if shift { 'D' } else { 'd' },
    Key::KeyE => if shift { 'E' } else { 'e' },
    Key::KeyF => if shift { 'F' } else { 'f' },
    Key::KeyG => if shift { 'G' } else { 'g' },
    Key::KeyH => if shift { 'H' } else { 'h' },
    Key::KeyI => if shift { 'I' } else { 'i' },
    Key::KeyJ => if shift { 'J' } else { 'j' },
    Key::KeyK => if shift { 'K' } else { 'k' },
    Key::KeyL => if shift { 'L' } else { 'l' },
    Key::KeyM => if shift { 'M' } else { 'm' },
    Key::KeyN => if shift { 'N' } else { 'n' },
    Key::KeyO => if shift { 'O' } else { 'o' },
    Key::KeyP => if shift { 'P' } else { 'p' },
    Key::KeyQ => if shift { 'Q' } else { 'q' },
    Key::KeyR => if shift { 'R' } else { 'r' },
    Key::KeyS => if shift { 'S' } else { 's' },
    Key::KeyT => if shift { 'T' } else { 't' },
    Key::KeyU => if shift { 'U' } else { 'u' },
    Key::KeyV => if shift { 'V' } else { 'v' },
    Key::KeyW => if shift { 'W' } else { 'w' },
    Key::KeyX => if shift { 'X' } else { 'x' },
    Key::KeyY => if shift { 'Y' } else { 'y' },
    Key::KeyZ => if shift { 'Z' } else { 'z' },

    // Punctuation row — the critical ones for QR payloads are `:` (Shift+;)
    // and `|` (Shift+\) since the in-app signed QR uses both.
    Key::Minus      => if shift { '_' } else { '-' },
    Key::Equal      => if shift { '+' } else { '=' },
    Key::LeftBracket  => if shift { '{' } else { '[' },
    Key::RightBracket => if shift { '}' } else { ']' },
    Key::BackSlash  => if shift { '|' } else { '\\' },
    Key::SemiColon  => if shift { ':' } else { ';' },
    Key::Quote      => if shift { '"' } else { '\'' },
    Key::Comma      => if shift { '<' } else { ',' },
    Key::Dot        => if shift { '>' } else { '.' },
    Key::Slash      => if shift { '?' } else { '/' },
    Key::BackQuote  => if shift { '~' } else { '`' },
    Key::Space      => ' ',

    // Numpad — numeric value regardless of NumLock (rdev only emits these
    // when NumLock is on; otherwise the keys come through as arrows/etc).
    Key::Kp1 => '1', Key::Kp2 => '2', Key::Kp3 => '3',
    Key::Kp4 => '4', Key::Kp5 => '5', Key::Kp6 => '6',
    Key::Kp7 => '7', Key::Kp8 => '8', Key::Kp9 => '9',
    Key::Kp0 => '0',
    Key::KpMinus    => '-',
    Key::KpPlus     => '+',
    Key::KpDivide   => '/',
    Key::KpMultiply => '*',
    Key::KpDelete   => '.',

    // Everything else — modifiers, navigation, function keys — isn't part
    // of QR/barcode payloads, so signal "skip this" to the caller.
    _ => return None,
  };
  Some(c)
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
