use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_store::StoreExt;

use crate::log_path;
use crate::panel::show_panel;

const LOG_LEVEL_STORE_KEY: &str = "logLevel";
const TRAY_ID: &str = "tray";

fn get_stored_log_level(app_handle: &AppHandle) -> log::LevelFilter {
    let store = match app_handle.store("settings.json") {
        Ok(s) => s,
        Err(_) => return log::LevelFilter::Error,
    };
    let value = store.get(LOG_LEVEL_STORE_KEY);
    let level_str = value.and_then(|v| v.as_str().map(|s| s.to_string()));
    match level_str.as_deref() {
        Some("error") => log::LevelFilter::Error,
        Some("warn") => log::LevelFilter::Warn,
        Some("info") => log::LevelFilter::Info,
        Some("debug") => log::LevelFilter::Debug,
        Some("trace") => log::LevelFilter::Trace,
        _ => log::LevelFilter::Error, // Default: least verbose
    }
}

fn show_panel_from_tray_event(app_handle: &AppHandle, event: TrayIconEvent) {
    let TrayIconEvent::Click {
        button,
        button_state,
        rect: _,
        ..
    } = event
    else {
        return;
    };

    if button != MouseButton::Left || button_state != MouseButtonState::Down {
        return;
    }

    log::debug!("tray click: showing main window");
    show_panel(app_handle);
}

pub fn create(app_handle: &AppHandle) -> tauri::Result<()> {
    // Same icon as the taskbar/window icon.
    let icon = app_handle
        .default_window_icon()
        .cloned()
        .expect("default window icon must be configured");

    // Load persisted log level
    log::set_max_level(get_stored_log_level(app_handle));

    let show_stats = MenuItem::with_id(app_handle, "show_stats", "Show Stats", true, None::<&str>)?;
    let copy_log_path = MenuItem::with_id(
        app_handle,
        "copy_log_path",
        "Copy Log Path",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app_handle)?;
    let about = MenuItem::with_id(app_handle, "about", "About WinUsage", true, None::<&str>)?;
    let quit = MenuItem::with_id(app_handle, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app_handle,
        &[&show_stats, &copy_log_path, &separator, &about, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("OpenUsage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app_handle, event| {
            log::debug!("tray menu: {}", event.id.as_ref());
            match event.id.as_ref() {
                "show_stats" => {
                    // show_panel emits tray:navigate "home" to land on Stats.
                    show_panel(app_handle);
                }
                "about" => {
                    show_panel(app_handle);
                    let _ = app_handle.emit("tray:show-about", ());
                }
                "quit" => {
                    log::info!("quit requested via tray");
                    app_handle.exit(0);
                }
                "copy_log_path" => match log_path::for_app(app_handle) {
                    Ok(path) => {
                        if let Err(error) = app_handle
                            .clipboard()
                            .write_text(path.to_string_lossy().to_string())
                        {
                            log::error!("failed to copy log path to clipboard: {}", error);
                        } else {
                            log::info!("copied log path to clipboard");
                        }
                    }
                    Err(error) => {
                        log::error!("failed to resolve log path: {}", error);
                    }
                },
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            show_panel_from_tray_event(tray.app_handle(), event);
        })
        .build(app_handle)?;

    Ok(())
}
