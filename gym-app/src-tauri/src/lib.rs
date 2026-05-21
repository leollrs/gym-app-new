// TuGymPR desktop entry. Three behaviors that matter for a gym front-desk PC:
//
//   1. Autostart on boot — registered via tauri-plugin-autostart. When the
//      receptionist powers the PC on, the app appears without anyone clicking.
//
//   2. Close-to-tray, don't quit — when the user hits the window's X button,
//      we hide the window and leave the process running in the system tray.
//      This keeps notifications/heartbeats/check-in logic alive even when
//      "closed," and one click on the tray icon brings the window back.
//      The escape hatch is the tray menu's "Quit" item (intentional exit).
//
//   3. Tray icon with menu — single icon, two actions:
//        - Show TuGymPR (also bound to single-click on the icon)
//        - Quit
//      Anything more would clutter a launch-and-forget kiosk app.

use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_autostart::init(
      // On macOS, "launch agent" is the right place for this — registers a
      // ~/Library/LaunchAgents plist instead of Login Items so behavior is
      // identical across Mac versions. On Windows + Linux this argument is
      // ignored (HKCU\...\Run on Windows, .desktop in autostart on Linux).
      MacosLauncher::LaunchAgent,
      // No CLI args — we want the app to launch its own default window.
      None,
    ))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Enable autostart immediately on first run. The autostart plugin's
      // `enable()` is idempotent — calling it on every launch keeps the
      // registry entry / launch agent in sync with the installed binary
      // path, so even if the user reinstalls to a different directory the
      // boot launcher self-heals.
      use tauri_plugin_autostart::ManagerExt;
      let autostart = app.autolaunch();
      let _ = autostart.enable();

      // ── System tray ────────────────────────────────────────────────
      let show_item = MenuItem::with_id(app, "show", "Show TuGymPR", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

      let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("TuGymPR")
        .menu(&tray_menu)
        // Don't auto-open the menu on left-click — left-click reveals the
        // window directly (the more intuitive gesture). Right-click opens
        // the menu via Tauri's default behavior, which we keep enabled.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => show_main_window(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main_window(tray.app_handle());
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      // The "close" X button on the window doesn't actually quit — it hides
      // the window and lets the process keep running in the tray. This is
      // what makes the app "always on" for a front-desk PC: heartbeats,
      // notifications, and any background work continue even when the
      // owner has "closed" the visible window.
      if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          let _ = window.hide();
          api.prevent_close();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// Show + focus the main window. Works whether the window is hidden (close-
// to-tray case) or just minimized.
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}
