use tauri::{AppHandle, Emitter, Manager, Position, Size};

#[cfg(not(target_os = "macos"))]
use tauri::PhysicalPosition;
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
#[cfg(not(target_os = "macos"))]
use std::time::Duration;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

fn monitor_contains_physical_point(
    origin_x: f64,
    origin_y: f64,
    width: f64,
    height: f64,
    point_x: f64,
    point_y: f64,
) -> bool {
    point_x >= origin_x
        && point_x < origin_x + width
        && point_y >= origin_y
        && point_y < origin_y + height
}

#[cfg(not(target_os = "macos"))]
struct PanelLayout {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(not(target_os = "macos"))]
fn panel_layout_for_window(window: &tauri::WebviewWindow) -> PanelLayout {
    let panel_size = window.outer_size().ok();
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is valid");
    let fallback_scale = window
        .scale_factor()
        .ok()
        .or_else(|| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor.scale_factor())
        })
        .unwrap_or(1.0);
    let fallback_width =
        conf["app"]["windows"][0]["width"].as_f64().unwrap_or(400.0) * fallback_scale;
    let fallback_height = conf["app"]["windows"][0]["height"]
        .as_f64()
        .unwrap_or(500.0)
        * fallback_scale;

    PanelLayout {
        x: 0.0,
        y: 0.0,
        width: panel_size
            .as_ref()
            .map(|size| size.width as f64)
            .unwrap_or(fallback_width),
        height: panel_size
            .as_ref()
            .map(|size| size.height as f64)
            .unwrap_or(fallback_height),
    }
}

#[cfg(not(target_os = "macos"))]
fn work_area_layout(monitor: &tauri::Monitor) -> PanelLayout {
    let work_area = monitor.work_area();
    PanelLayout {
        x: work_area.position.x as f64,
        y: work_area.position.y as f64,
        width: work_area.size.width as f64,
        height: work_area.size.height as f64,
    }
}

#[cfg(not(target_os = "macos"))]
fn position_panel_at_taskbar(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        log::error!("Main window not found");
        return;
    };

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        log::warn!("No monitor available for taskbar panel positioning");
        return;
    };

    let panel = panel_layout_for_window(&window);
    let work_area = work_area_layout(&monitor);
    let gap = 12.0;
    let _ = app_handle.emit("panel:anchor", "bottom");
    let panel_x = (work_area.x + work_area.width - panel.width - gap).max(work_area.x);
    let panel_y = (work_area.y + work_area.height - panel.height - gap).max(work_area.y);

    set_panel_top_left_immediately(&window, app_handle, panel_x, panel_y, 0.0);
}

#[cfg(target_os = "macos")]
unsafe fn set_panel_frame_top_left(panel: &tauri_nspanel::NSPanel, x: f64, y: f64) {
    let point = tauri_nspanel::NSPoint::new(x, y);
    let _: () = objc2::msg_send![panel, setFrameTopLeftPoint: point];
}

#[cfg(target_os = "macos")]
fn set_panel_top_left_immediately(
    window: &tauri::WebviewWindow,
    app_handle: &AppHandle,
    panel_x: f64,
    panel_y: f64,
    primary_logical_h: f64,
) {
    let Ok(panel_handle) = app_handle.get_webview_panel("main") else {
        return;
    };

    let target_x = panel_x;
    let target_y = primary_logical_h - panel_y;

    if objc2_foundation::MainThreadMarker::new().is_some() {
        unsafe {
            set_panel_frame_top_left(panel_handle.as_panel(), target_x, target_y);
        }
        return;
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let panel_handle = panel_handle.clone();

    if let Err(error) = window.run_on_main_thread(move || {
        unsafe {
            set_panel_frame_top_left(panel_handle.as_panel(), target_x, target_y);
        }
        let _ = tx.send(());
    }) {
        log::warn!("Failed to position panel on main thread: {}", error);
        return;
    }

    if rx.recv().is_err() {
        log::warn!("Failed waiting for panel position on main thread");
    }
}

#[cfg(not(target_os = "macos"))]
fn set_panel_top_left_immediately(
    window: &tauri::WebviewWindow,
    _app_handle: &AppHandle,
    panel_x: f64,
    panel_y: f64,
    _primary_logical_h: f64,
) {
    let position = PhysicalPosition {
        x: panel_x.round() as i32,
        y: panel_y.round() as i32,
    };
    if let Err(error) = window.set_position(Position::Physical(position)) {
        log::warn!("Failed to position panel: {}", error);
    }
}

#[cfg(target_os = "macos")]
macro_rules! get_or_init_panel {
    ($app_handle:expr) => {
        match $app_handle.get_webview_panel("main") {
            Ok(panel) => Some(panel),
            Err(_) => {
                if let Err(err) = crate::panel::init($app_handle) {
                    log::error!("Failed to init panel: {}", err);
                    None
                } else {
                    match $app_handle.get_webview_panel("main") {
                        Ok(panel) => Some(panel),
                        Err(err) => {
                            log::error!("Panel missing after init: {:?}", err);
                            None
                        }
                    }
                }
            }
        }
    };
}

pub fn reposition_panel(app_handle: &AppHandle) {
    position_panel_from_tray(app_handle);
}

/// Screen rect (physical px) of the taskbar widget that opened the panel.
/// `None` means the panel anchors to the tray icon.
#[cfg(not(target_os = "macos"))]
static PANEL_ANCHOR: std::sync::Mutex<Option<(f64, f64, f64, f64)>> = std::sync::Mutex::new(None);

#[cfg(not(target_os = "macos"))]
fn set_panel_anchor(anchor: Option<(f64, f64, f64, f64)>) {
    *PANEL_ANCHOR.lock().unwrap_or_else(|p| p.into_inner()) = anchor;
}

#[cfg(not(target_os = "macos"))]
fn panel_anchor() -> Option<(f64, f64, f64, f64)> {
    *PANEL_ANCHOR.lock().unwrap_or_else(|p| p.into_inner())
}

/// Opens/closes the panel above the taskbar widget.
#[cfg(not(target_os = "macos"))]
pub fn toggle_panel_at_anchor(app_handle: &AppHandle, x: i32, y: i32, w: i32, h: i32) {
    set_panel_anchor(Some((x as f64, y as f64, w as f64, h as f64)));
    cancel_blur_hide();
    toggle_panel(app_handle);
}

#[cfg(not(target_os = "macos"))]
pub fn show_panel_at_anchor(app_handle: &AppHandle, x: i32, y: i32, w: i32, h: i32) {
    set_panel_anchor(Some((x as f64, y as f64, w as f64, h as f64)));
    cancel_blur_hide();
    show_panel(app_handle);
}

/// Centers the panel over the anchor rect, just above (or below) the taskbar.
#[cfg(not(target_os = "macos"))]
fn position_panel_at_anchor(app_handle: &AppHandle, (ax, ay, aw, ah): (f64, f64, f64, f64)) {
    let Some(window) = app_handle.get_webview_window("main") else {
        log::error!("Main window not found");
        return;
    };
    let monitor = app_handle
        .monitor_from_point(ax + aw / 2.0, ay + ah / 2.0)
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        log::warn!("No monitor available for anchored panel positioning");
        return;
    };
    let panel = panel_layout_for_window(&window);
    let work_area = work_area_layout(&monitor);
    let gap = 12.0;
    let at_bottom = ay + ah / 2.0 > work_area.y + work_area.height / 2.0;
    let _ = app_handle.emit("panel:anchor", if at_bottom { "bottom" } else { "top" });
    let max_x = (work_area.x + work_area.width - panel.width).max(work_area.x);
    let panel_x = (ax + aw / 2.0 - panel.width / 2.0).clamp(work_area.x, max_x);
    let panel_y = if at_bottom {
        (work_area.y + work_area.height - panel.height - gap).max(work_area.y)
    } else {
        work_area.y + gap
    };
    set_panel_top_left_immediately(&window, app_handle, panel_x, panel_y, 0.0);
}

fn position_panel_from_tray(app_handle: &AppHandle) {
    #[cfg(not(target_os = "macos"))]
    if let Some(anchor) = panel_anchor() {
        position_panel_at_anchor(app_handle, anchor);
        return;
    }
    let Some(tray) = app_handle.tray_by_id("tray") else {
        log::debug!("position_panel_from_tray: tray icon not found");
        #[cfg(not(target_os = "macos"))]
        {
            let _ = app_handle.emit("panel:anchor", "bottom");
            position_panel_at_taskbar(app_handle);
        }
        return;
    };
    match tray.rect() {
        Ok(Some(rect)) => {
            position_panel_at_tray_icon(app_handle, rect.position, rect.size);
        }
        Ok(None) => {
            log::debug!("position_panel_from_tray: tray rect not available yet");
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle.emit("panel:anchor", "bottom");
                position_panel_at_taskbar(app_handle);
            }
        }
        Err(e) => {
            log::warn!("position_panel_from_tray: failed to get tray rect: {}", e);
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle.emit("panel:anchor", "bottom");
                position_panel_at_taskbar(app_handle);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn show_panel(app_handle: &AppHandle) {
    crate::macos_dock::run_main(app_handle, show_panel_on_main);
}

/// Opens the transient popup: no Dock icon, no Cmd-Tab entry, positioned under the
/// tray icon, key; click-outside hides it (see the resign-key handler in `init`).
#[cfg(target_os = "macos")]
fn show_panel_on_main(app_handle: &AppHandle) {
    if let Some(panel) = get_or_init_panel!(app_handle) {
        panel.show_and_make_key();
        position_panel_from_tray(app_handle);
        crate::taskbar::refresh_menu_bar_appearance();
        // The panel always hangs from the menu bar; the nav icons follow this side.
        let _ = app_handle.emit("panel:anchor", "top");
        // Always reopen on the Stats view (also dismisses a leftover About overlay).
        let _ = app_handle.emit("tray:navigate", "home");
    }
}

/// Frameless, transparent popup (shadow disabled) loses DWM auto-rounding;
/// re-assert rounded corners. See docs/tauri-fix/tauri-win11-frameless-fix.md.
#[cfg(windows)]
fn apply_panel_rounded_corners(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let pref = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &pref as *const _ as *const c_void,
            std::mem::size_of_val(&pref) as u32,
        );
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn apply_panel_rounded_corners(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "macos"))]
static PANEL_OPEN: AtomicBool = AtomicBool::new(false);
#[cfg(not(target_os = "macos"))]
static BLUR_HIDE_GEN: AtomicU64 = AtomicU64::new(0);
#[cfg(all(not(target_os = "macos"), not(debug_assertions)))]
static RELOAD_MAIN_ON_FIRST_SHOW: AtomicBool = AtomicBool::new(true);
#[cfg(not(target_os = "macos"))]
const BLUR_HIDE_DELAY_MS: u64 = 200;

/// Cancel a pending click-outside hide (e.g. tray click races with blur on Windows).
#[cfg(not(target_os = "macos"))]
pub fn cancel_blur_hide() {
    BLUR_HIDE_GEN.fetch_add(1, Ordering::SeqCst);
}

/// Hide the panel shortly after blur so tray clicks can toggle first.
#[cfg(not(target_os = "macos"))]
pub fn schedule_blur_hide(app_handle: &AppHandle) {
    let generation = BLUR_HIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(BLUR_HIDE_DELAY_MS));
        if BLUR_HIDE_GEN.load(Ordering::SeqCst) != generation {
            return;
        }
        if PANEL_OPEN.load(Ordering::SeqCst) {
            hide_panel(&handle);
        }
    });
}

#[cfg(target_os = "macos")]
pub fn toggle_panel_from_tray(app_handle: &AppHandle) {
    toggle_panel(app_handle);
}

#[cfg(not(target_os = "macos"))]
pub fn toggle_panel_from_tray(app_handle: &AppHandle) {
    set_panel_anchor(None);
    cancel_blur_hide();
    toggle_panel(app_handle);
}

#[cfg(not(target_os = "macos"))]
fn reload_main_webview_on_first_release_show(window: &tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        let _ = window;
    }

    #[cfg(not(debug_assertions))]
    {
        if !RELOAD_MAIN_ON_FIRST_SHOW.swap(false, Ordering::SeqCst) {
            return;
        }

        let window = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let reload_window = window.clone();
            if let Err(error) = window.run_on_main_thread(move || {
                if let Err(error) = reload_window.reload() {
                    log::warn!(
                        "Failed to reload main WebView after first visible show: {}",
                        error
                    );
                } else {
                    log::info!("Reloaded main WebView after first visible show");
                }
            }) {
                log::warn!("Failed to schedule main WebView reload: {}", error);
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
pub fn show_panel(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        log::error!("Main window not found");
        return;
    };

    apply_panel_rounded_corners(&window);
    if let Err(error) = window.show() {
        log::error!("Failed to show panel: {}", error);
        return;
    }
    PANEL_OPEN.store(true, Ordering::SeqCst);
    if let Err(error) = window.unminimize() {
        log::debug!("Failed to unminimize panel: {}", error);
    }
    if let Err(error) = window.set_focus() {
        log::debug!("Failed to focus panel: {}", error);
    }
    reload_main_webview_on_first_release_show(&window);
    // Anchor the popup at the tray icon (frontend skips repositioning on Windows).
    position_panel_from_tray(app_handle);
    // Always reopen on the Stats view (also dismisses a leftover About overlay).
    let _ = app_handle.emit("tray:navigate", "home");
}

#[cfg(target_os = "macos")]
pub fn hide_panel(app_handle: &AppHandle) {
    crate::macos_dock::run_main(app_handle, |app_handle| {
        if let Ok(panel) = app_handle.get_webview_panel("main") {
            panel.hide();
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn hide_panel(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };
    PANEL_OPEN.store(false, Ordering::SeqCst);
    if let Err(error) = window.hide() {
        log::warn!("Failed to hide panel: {}", error);
    }
}

#[cfg(target_os = "macos")]
pub fn toggle_panel(app_handle: &AppHandle) {
    crate::macos_dock::run_main(app_handle, |app_handle| {
        let Some(panel) = get_or_init_panel!(app_handle) else {
            return;
        };

        if panel.is_visible() {
            log::debug!("toggle_panel: hiding panel");
            panel.hide();
        } else {
            log::debug!("toggle_panel: showing panel");
            show_panel_on_main(app_handle);
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn toggle_panel(app_handle: &AppHandle) {
    if app_handle.get_webview_window("main").is_none() {
        log::error!("Main window not found");
        return;
    }

    if PANEL_OPEN.load(Ordering::SeqCst) {
        log::debug!("toggle_panel: hiding panel");
        hide_panel(app_handle);
    } else {
        log::debug!("toggle_panel: showing panel");
        show_panel(app_handle);
    }
}

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(OpenUsagePanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    panel_event!(OpenUsagePanelEventHandler {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

#[cfg(target_os = "macos")]
pub fn init(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if app_handle.get_webview_panel("main").is_ok() {
        return Ok(());
    }

    let window = app_handle.get_webview_window("main").unwrap();

    let panel = window.to_panel::<OpenUsagePanel>()?;

    // Disable native shadow - it causes gray border on transparent windows
    // Let CSS handle shadow via shadow-xl class
    panel.set_has_shadow(false);
    panel.set_opaque(false);

    // Configure panel behavior
    panel.set_level(PanelLevel::MainMenu.value() + 1);

    // can_join_all_spaces + full_screen_auxiliary: lets the popup appear over a
    // full-screen app's Space (move_to_active_space does not).
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .value(),
    );

    panel.set_style_mask(StyleMask::empty().nonactivating_panel().value());

    // Set up event handler to hide panel when it loses focus (click-outside-to-close)
    let event_handler = OpenUsagePanelEventHandler::new();

    let handle = app_handle.clone();
    event_handler.window_did_resign_key(move |_notification| {
        if let Ok(panel) = handle.get_webview_panel("main") {
            panel.hide();
        }
    });

    panel.set_event_handler(Some(event_handler.as_ref()));

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn init(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app_handle.get_webview_window("main") else {
        return Ok(());
    };

    let _ = window;

    Ok(())
}

pub fn position_panel_at_tray_icon(
    app_handle: &tauri::AppHandle,
    icon_position: Position,
    icon_size: Size,
) {
    let Some(window) = app_handle.get_webview_window("main") else {
        log::error!("Main window not found");
        return;
    };

    let (icon_phys_x, icon_phys_y) = match &icon_position {
        Position::Physical(pos) => (pos.x as f64, pos.y as f64),
        Position::Logical(pos) => (pos.x, pos.y),
    };
    let (icon_phys_w, icon_phys_h) = match &icon_size {
        Size::Physical(s) => (s.width as f64, s.height as f64),
        Size::Logical(s) => (s.width, s.height),
    };

    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            log::warn!("failed to get monitors: {}", error);
            return;
        }
    };
    let primary_logical_h = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.size().height as f64 / m.scale_factor())
        .unwrap_or(0.0);

    let icon_center_x = icon_phys_x + (icon_phys_w / 2.0);
    let icon_center_y = icon_phys_y + (icon_phys_h / 2.0);

    let found_monitor = monitors.iter().find(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        monitor_contains_physical_point(
            origin.x as f64,
            origin.y as f64,
            size.width as f64,
            size.height as f64,
            icon_center_x,
            icon_center_y,
        )
    });

    let monitor = match found_monitor {
        Some(m) => m.clone(),
        None => {
            log::warn!(
                "No monitor found for tray rect center at ({:.0}, {:.0}), using primary",
                icon_center_x,
                icon_center_y
            );
            match window.primary_monitor() {
                Ok(Some(m)) => m,
                _ => return,
            }
        }
    };

    #[cfg(target_os = "macos")]
    {
        let target_scale = monitor.scale_factor();
        let mon_phys_x = monitor.position().x as f64;
        let mon_phys_y = monitor.position().y as f64;
        let mon_logical_x = mon_phys_x / target_scale;
        let mon_logical_y = mon_phys_y / target_scale;

        let icon_logical_x = mon_logical_x + (icon_phys_x - mon_phys_x) / target_scale;
        let icon_logical_y = mon_logical_y + (icon_phys_y - mon_phys_y) / target_scale;
        let icon_logical_w = icon_phys_w / target_scale;
        let icon_logical_h = icon_phys_h / target_scale;

        let panel_width = match (window.outer_size(), window.scale_factor()) {
            (Ok(s), Ok(win_scale)) => s.width as f64 / win_scale,
            _ => {
                let conf: serde_json::Value =
                    serde_json::from_str(include_str!("../tauri.conf.json"))
                        .expect("tauri.conf.json must be valid JSON");
                conf["app"]["windows"][0]["width"]
                    .as_f64()
                    .expect("width must be set in tauri.conf.json")
            }
        };

        let icon_center_x = icon_logical_x + (icon_logical_w / 2.0);
        let panel_x = icon_center_x - (panel_width / 2.0);
        let nudge_up: f64 = 6.0;
        let panel_y = icon_logical_y + icon_logical_h - nudge_up;

        set_panel_top_left_immediately(&window, app_handle, panel_x, panel_y, primary_logical_h);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let panel = panel_layout_for_window(&window);
        let work_area = work_area_layout(&monitor);
        let gap = 12.0;

        let icon_near_bottom = icon_center_y > work_area.y + (work_area.height * 0.7);
        let icon_near_top = icon_center_y < work_area.y + (work_area.height * 0.3);
        if !icon_near_bottom && !icon_near_top {
            let _ = app_handle.emit("panel:anchor", "bottom");
            position_panel_at_taskbar(app_handle);
            return;
        }
        let _ = app_handle.emit(
            "panel:anchor",
            if icon_near_bottom { "bottom" } else { "top" },
        );

        let desired_x = icon_center_x - (panel.width / 2.0);
        let desired_y = if icon_near_bottom {
            icon_phys_y - panel.height - gap
        } else {
            icon_phys_y + icon_phys_h + gap
        };

        let max_x = work_area.x + work_area.width - panel.width;
        let max_y = work_area.y + work_area.height - panel.height;
        let panel_x = desired_x.clamp(work_area.x, max_x.max(work_area.x));
        let panel_y = desired_y.clamp(work_area.y, max_y.max(work_area.y));

        set_panel_top_left_immediately(&window, app_handle, panel_x, panel_y, primary_logical_h);
    }
}
