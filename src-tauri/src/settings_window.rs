use tauri::{AppHandle, Manager};

pub const SETTINGS_LABEL: &str = "settings";

/// Shows (or reveals) the dedicated Settings window, bringing it to the front.
/// On macOS the app becomes a Regular app (Dock icon, Cmd-Tab) while it is open.
pub fn open(app_handle: &AppHandle) {
    #[cfg(target_os = "macos")]
    crate::macos_dock::run_main(app_handle, open_now);
    #[cfg(not(target_os = "macos"))]
    open_now(app_handle);
}

fn open_now(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(SETTINGS_LABEL) else {
        log::error!("Settings window not found");
        return;
    };
    apply_rounded_corners(&window);
    // Hides the panel (it would float over Settings) and switches to Regular.
    #[cfg(target_os = "macos")]
    crate::macos_dock::prepare_for_settings(app_handle);
    if let Err(error) = window.show() {
        log::error!("Failed to show settings window: {}", error);
        return;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
    #[cfg(target_os = "macos")]
    {
        crate::macos_dock::activate();
        // The policy switch can make macOS deactivate the app for a moment.
        crate::macos_dock::reactivate_next_tick(app_handle);
    }
}

/// The Settings window is frameless (`decorations: false`). On Windows 11 the
/// native rounded corners are not guaranteed on a custom-chrome window, so we
/// re-assert them explicitly via DWM. See docs/tauri-fix/tauri-win11-frameless-fix.md.
#[cfg(windows)]
fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Dwm::{
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let corner_preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner_preference as *const _ as *const c_void,
            std::mem::size_of_val(&corner_preference) as u32,
        );
    }
}

#[cfg(not(windows))]
fn apply_rounded_corners(_window: &tauri::WebviewWindow) {}
