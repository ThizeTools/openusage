use tauri::{AppHandle, Manager};

pub const SETTINGS_LABEL: &str = "settings";

/// Shows (or reveals) the dedicated Settings window, bringing it to the front.
pub fn open(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(SETTINGS_LABEL) else {
        log::error!("Settings window not found");
        return;
    };
    apply_rounded_corners(&window);
    if let Err(error) = window.show() {
        log::error!("Failed to show settings window: {}", error);
        return;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// The Settings window is frameless (`decorations: false`). On Windows 11 the
/// native rounded corners are not guaranteed on a custom-chrome window, so we
/// re-assert them explicitly via DWM. See docs/tauri-fix/tauri-win11-frameless-fix.md.
#[cfg(windows)]
fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
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
