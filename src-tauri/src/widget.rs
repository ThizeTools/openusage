use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, WindowEvent};
use tauri_plugin_store::StoreExt;

pub const WIDGET_LABEL: &str = "widget";
const WIDGET_VISIBLE_KEY: &str = "widgetVisible";
const WIDGET_POSITION_KEY: &str = "widgetPosition";
const EDGE_GAP_PX: i32 = 16;

fn persist_visible(app_handle: &AppHandle, visible: bool) {
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(WIDGET_VISIBLE_KEY, serde_json::json!(visible));
        let _ = store.save();
    }
    let _ = app_handle.emit("widget:visibility", visible);
}

/// Reads a previously saved physical position, if any.
fn stored_position(app_handle: &AppHandle) -> Option<PhysicalPosition<i32>> {
    let store = app_handle.store("settings.json").ok()?;
    let value = store.get(WIDGET_POSITION_KEY)?;
    let x = value.get("x")?.as_f64()?;
    let y = value.get("y")?.as_f64()?;
    Some(PhysicalPosition {
        x: x.round() as i32,
        y: y.round() as i32,
    })
}

/// Widget's current outer size in physical pixels, with a sane fallback.
fn widget_size(window: &tauri::WebviewWindow) -> (i32, i32) {
    window
        .outer_size()
        .ok()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((260, 80))
}

/// Minimum overlap (px) the widget must share with a monitor to count as
/// on-screen — enough surface to grab and drag it back.
const MIN_VISIBLE_PX: i32 = 32;

/// True if the widget at `pos` overlaps any available monitor's full bounds by
/// at least [`MIN_VISIBLE_PX`] on both axes. Uses the full monitor (not the
/// work area) so the widget may sit on top of the taskbar.
fn position_is_on_screen(window: &tauri::WebviewWindow, pos: PhysicalPosition<i32>) -> bool {
    let (w, h) = widget_size(window);
    let Ok(monitors) = window.available_monitors() else {
        return true; // can't tell — assume fine, don't move it
    };
    monitors.iter().any(|monitor| {
        let (mx, my) = (monitor.position().x, monitor.position().y);
        let (mw, mh) = (monitor.size().width as i32, monitor.size().height as i32);
        let overlap_x = (pos.x + w).min(mx + mw) - pos.x.max(mx);
        let overlap_y = (pos.y + h).min(my + mh) - pos.y.max(my);
        overlap_x >= MIN_VISIBLE_PX && overlap_y >= MIN_VISIBLE_PX
    })
}

/// Clamps `pos` so the whole widget fits inside the primary monitor's full
/// bounds (taskbar included, so it may rest over it). Used to recover an
/// off-screen widget.
fn clamp_to_monitor(
    window: &tauri::WebviewWindow,
    pos: PhysicalPosition<i32>,
) -> Option<PhysicalPosition<i32>> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let (w, h) = widget_size(window);
    let min_x = monitor.position().x;
    let min_y = monitor.position().y;
    let max_x = min_x + monitor.size().width as i32 - w;
    let max_y = min_y + monitor.size().height as i32 - h;
    Some(PhysicalPosition {
        x: pos.x.clamp(min_x, max_x.max(min_x)),
        y: pos.y.clamp(min_y, max_y.max(min_y)),
    })
}

/// Default position: top-right corner of the primary monitor's work area.
fn default_position(window: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let work_area = monitor.work_area();
    let widget_width = window.outer_size().ok().map(|s| s.width as i32).unwrap_or(260);
    let x = work_area.position.x + work_area.size.width as i32 - widget_width - EDGE_GAP_PX;
    let y = work_area.position.y + EDGE_GAP_PX;
    Some(PhysicalPosition {
        x: x.max(work_area.position.x),
        y: y.max(work_area.position.y),
    })
}

pub fn restore_widget_position(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(WIDGET_LABEL) else {
        return;
    };
    let mut position = stored_position(app_handle).or_else(|| default_position(&window));
    // Auto-recover an off-screen position (e.g. after a monitor was unplugged).
    if let Some(pos) = position {
        if !position_is_on_screen(&window, pos) {
            position = clamp_to_monitor(&window, pos).or_else(|| default_position(&window));
        }
    }
    if let Some(position) = position {
        if let Err(error) = window.set_position(Position::Physical(position)) {
            log::warn!("Failed to position widget: {}", error);
        }
    }
}

/// Moves the widget back into the visible work area when it sits off-screen.
/// No-op if already visible on any monitor. Persists the corrected position.
pub fn bring_widget_on_screen(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(WIDGET_LABEL) else {
        return;
    };
    let Some(current) = window
        .outer_position()
        .ok()
        .map(|p| PhysicalPosition { x: p.x, y: p.y })
    else {
        return;
    };
    if position_is_on_screen(&window, current) {
        return;
    }
    let target = clamp_to_monitor(&window, current).or_else(|| default_position(&window));
    if let Some(target) = target {
        if let Err(error) = window.set_position(Position::Physical(target)) {
            log::warn!("Failed to reposition widget: {}", error);
            return;
        }
        save_widget_position(app_handle, target.x, target.y);
    }
}

pub fn save_widget_position(app_handle: &AppHandle, x: i32, y: i32) {
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(WIDGET_POSITION_KEY, serde_json::json!({ "x": x, "y": y }));
        let _ = store.save();
    }
}

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};

/// Tracks whether the widget should currently be kept on top. The guard loop
/// reads this each tick; `hide_widget` clears it to stop the loop.
#[cfg(windows)]
static TOPMOST_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Forces the widget to the top of the topmost z-order via raw Win32.
///
/// `WebviewWindow::set_always_on_top(true)` is a no-op once the flag is already
/// set — tao diffs window flags and skips the `SetWindowPos` call — so it
/// cannot recover z-order after the taskbar steals the top of the band.
/// Calling `SetWindowPos(HWND_TOPMOST)` directly re-inserts the widget at the
/// top unconditionally, without stealing activation (`SWP_NOACTIVATE`).
#[cfg(windows)]
fn force_topmost(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

/// Re-asserts topmost z-order on focus loss for immediate recovery, and starts
/// a background loop that keeps the widget at the top of the topmost band.
///
/// The Windows taskbar (`Shell_TrayWnd`) is itself a topmost window, so
/// activating it pushes it above our widget within the same band. Worse, the
/// widget has `skipTaskbar` and rarely holds focus, so a focus-change event is
/// not guaranteed to fire when the taskbar is clicked. A periodic
/// [`force_topmost`] re-inserts the widget at the top of the band regardless of
/// events. Guarded so a single handler + loop exist per process.
#[cfg(windows)]
fn ensure_topmost_guard(app_handle: &AppHandle, window: &tauri::WebviewWindow) {
    use std::time::Duration;

    static ATTACHED: AtomicBool = AtomicBool::new(false);
    TOPMOST_ACTIVE.store(true, Ordering::SeqCst);
    if ATTACHED.swap(true, Ordering::SeqCst) {
        return;
    }

    let guarded = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            force_topmost(&guarded);
        }
    });

    let handle = app_handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        if !TOPMOST_ACTIVE.load(Ordering::SeqCst) {
            continue;
        }
        if let Some(window) = handle.get_webview_window(WIDGET_LABEL) {
            force_topmost(&window);
        }
    });
}

#[cfg(not(windows))]
fn ensure_topmost_guard(_app_handle: &AppHandle, _window: &tauri::WebviewWindow) {}

/// The widget is a frameless, transparent, shadowless overlay. Disabling the
/// shadow removes DWM's auto-rounding, so re-assert rounded corners explicitly.
/// See docs/tauri-fix/tauri-win11-frameless-fix.md.
#[cfg(windows)]
fn apply_widget_rounded_corners(window: &tauri::WebviewWindow) {
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
fn apply_widget_rounded_corners(_window: &tauri::WebviewWindow) {}

pub fn show_widget(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(WIDGET_LABEL) else {
        log::error!("Widget window not found");
        return;
    };
    // Drop the native window shadow/frame so only the CSS card border shows.
    if let Err(error) = window.set_shadow(false) {
        log::debug!("Failed to disable widget shadow: {}", error);
    }
    apply_widget_rounded_corners(&window);
    restore_widget_position(app_handle);
    ensure_topmost_guard(app_handle, &window);
    let _ = window.set_always_on_top(true);
    if let Err(error) = window.show() {
        log::error!("Failed to show widget: {}", error);
        return;
    }
    let _ = window.set_focus();
    persist_visible(app_handle, true);
}

pub fn hide_widget(app_handle: &AppHandle) {
    #[cfg(windows)]
    TOPMOST_ACTIVE.store(false, Ordering::SeqCst);
    let Some(window) = app_handle.get_webview_window(WIDGET_LABEL) else {
        return;
    };
    if let Err(error) = window.hide() {
        log::warn!("Failed to hide widget: {}", error);
        return;
    }
    persist_visible(app_handle, false);
}

pub fn set_widget_visible(app_handle: &AppHandle, visible: bool) {
    if visible {
        show_widget(app_handle);
    } else {
        hide_widget(app_handle);
    }
}

/// Toggles widget visibility. Returns the new visibility state.
pub fn toggle_widget(app_handle: &AppHandle) -> bool {
    let visible = app_handle
        .get_webview_window(WIDGET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    set_widget_visible(app_handle, !visible);
    !visible
}
