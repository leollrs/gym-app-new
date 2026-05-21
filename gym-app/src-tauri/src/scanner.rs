// OBZ barcode scanner reader.
//
// Approach: the scanner is configured (manually, via a config barcode from the
// OBZ manual) into "USB Virtual COM" mode. In that mode it stops behaving as a
// keyboard and instead appears as a serial port — typically COM3+ on Windows,
// /dev/ttyUSB0+ on Linux. Reading the port directly means the scanner works
// regardless of which window is focused, so the front-desk app can keep
// listening even when its UI is hidden in the system tray.
//
// We auto-detect the port: every 2 seconds, list serial ports and try to open
// one that *looks* like a barcode scanner (USB VID/PID match for OBZ-class
// scanners) at 9600 8N1. If reading succeeds, we hold that port until it
// errors (cable yanked), then go back to scanning for a new port.
//
// On each line received (CR or LF terminated), we trim whitespace and emit a
// `scan-received` Tauri event with the raw text. The JavaScript side handles
// that the same way it handles a keyboard-scanner buffer-flush — same code
// path, same approval flow, same downstream RPCs.

use serialport::SerialPort;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

// Common OBZ-class scanner USB vendor IDs. The OBZ brand itself uses the
// generic CH340/CP210x USB-serial bridge chips, so we accept those VIDs
// plus a few known scanner-specific VIDs. If your scanner isn't listed,
// add its VID here — `serialport::available_ports()` reports usb_info.vid
// for every detected port at runtime so you can grep the logs.
const SCANNER_USB_VIDS: &[u16] = &[
  0x1A86, // QinHeng Electronics (CH340 — OBZ default)
  0x10C4, // Silicon Labs (CP210x — common in cheap scanners)
  0x0483, // STMicroelectronics (some Honeywell, generic Chinese)
  0x067B, // Prolific (PL2303 — legacy USB-serial bridge)
  0x05E0, // Honeywell
  0x0536, // Zebra / Symbol
];

const SCANNER_BAUD_RATE: u32 = 9600;
// Poll for new ports / reconnect when the cable is yanked. 2s feels snappy
// without burning CPU on idle enumeration.
const PORT_SCAN_INTERVAL: Duration = Duration::from_secs(2);
// Single-byte read timeout. Short enough that a missed read won't make the
// loop sluggish, long enough that we don't burn CPU on the idle device.
const READ_TIMEOUT: Duration = Duration::from_millis(200);

/// Spawn the always-on scanner reader thread. The thread runs until the app
/// process exits — close-to-tray keeps the process alive, so the scanner
/// stays connected even when the window is hidden.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
  // Cancellation flag — currently unused since the thread runs for the app's
  // entire lifetime, but wired up so we can add a "pause scanner" admin
  // toggle later (e.g. for a kiosk going offline overnight).
  let running = Arc::new(AtomicBool::new(true));
  let running_clone = Arc::clone(&running);

  thread::spawn(move || {
    log::info!("[scanner] reader thread started");
    let mut buf = String::new();
    let mut byte = [0u8; 1];

    while running_clone.load(Ordering::Relaxed) {
      // ── Hunt for a scanner port ──────────────────────────────
      let port_name = match find_scanner_port() {
        Some(name) => name,
        None => {
          thread::sleep(PORT_SCAN_INTERVAL);
          continue;
        }
      };

      log::info!("[scanner] opening port {}", port_name);
      let mut port: Box<dyn SerialPort> = match serialport::new(&port_name, SCANNER_BAUD_RATE)
        .timeout(READ_TIMEOUT)
        .open()
      {
        Ok(p) => p,
        Err(e) => {
          log::warn!("[scanner] failed to open {}: {}", port_name, e);
          thread::sleep(PORT_SCAN_INTERVAL);
          continue;
        }
      };

      // Notify the UI that a scanner is online so the connection-status pill
      // can flip green. JS-side listens for `scan-status` events.
      let _ = app.emit("scan-status", serde_json::json!({
        "connected": true,
        "port": &port_name,
      }));

      // ── Read loop: stay on this port until it errors ─────────
      buf.clear();
      loop {
        match port.read(&mut byte) {
          Ok(0) => continue,
          Ok(_) => {
            let c = byte[0];
            // Terminator: CR or LF (OBZ defaults to CR; some firmwares emit
            // both). Emit on terminator, ignore on empty buffer.
            if c == b'\r' || c == b'\n' {
              if !buf.is_empty() {
                let scanned = buf.trim().to_string();
                if !scanned.is_empty() {
                  log::info!("[scanner] scan: {} chars", scanned.len());
                  let _ = app.emit("scan-received", serde_json::json!({
                    "text": scanned,
                    "source": "usb-serial",
                  }));
                }
                buf.clear();
              }
            } else if c.is_ascii() && !c.is_ascii_control() {
              // Accumulate printable ASCII only. Most barcode payloads are
              // alphanumeric + a few separators; control bytes from a noisy
              // line would corrupt the payload silently.
              buf.push(c as char);
              // Cap buffer length so a stuck-open port can't OOM us.
              if buf.len() > 1024 {
                log::warn!("[scanner] buffer overflow, clearing");
                buf.clear();
              }
            }
          }
          Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
            // Expected — no byte arrived during the timeout window. Keep
            // looping; serialport's timeout is per-read, not a fatal error.
            continue;
          }
          Err(e) => {
            log::warn!("[scanner] read error on {}: {} — disconnecting", port_name, e);
            let _ = app.emit("scan-status", serde_json::json!({
              "connected": false,
              "port": &port_name,
              "error": e.to_string(),
            }));
            break;
          }
        }
      }

      // Lost the port — back off briefly before re-scanning so we don't
      // hammer the OS device enumeration in a tight loop.
      thread::sleep(PORT_SCAN_INTERVAL);
    }

    log::info!("[scanner] reader thread exiting");
  });
}

/// Enumerate serial ports and return the first one that looks like a scanner.
/// Heuristic: USB-attached + VID matches a known scanner / USB-serial bridge
/// chip. Falls back to the first available USB port if no VID match — so a
/// scanner using an obscure chipset still gets a chance.
fn find_scanner_port() -> Option<String> {
  let ports = match serialport::available_ports() {
    Ok(p) => p,
    Err(e) => {
      log::warn!("[scanner] failed to enumerate ports: {}", e);
      return None;
    }
  };

  // First pass: match known VIDs.
  for port in &ports {
    if let serialport::SerialPortType::UsbPort(info) = &port.port_type {
      if SCANNER_USB_VIDS.contains(&info.vid) {
        log::info!(
          "[scanner] matched VID {:04x}:{:04x} on {}",
          info.vid, info.pid, port.port_name
        );
        return Some(port.port_name.clone());
      }
    }
  }

  // Second pass: any USB port at all. Lets the user plug in an off-list
  // scanner without code changes — the actual read attempt will tell us
  // whether the device speaks at 9600 baud.
  for port in &ports {
    if matches!(port.port_type, serialport::SerialPortType::UsbPort(_)) {
      log::info!("[scanner] fallback to first USB port: {}", port.port_name);
      return Some(port.port_name.clone());
    }
  }

  None
}
