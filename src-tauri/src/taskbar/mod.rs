//! Taskbar widget. Windows: a layered child window of `Shell_TrayWnd`,
//! placed left of the notification area. Same technique as
//! krisgfx9/Wireless-Device-Battery-Monitor. The frontend formats every
//! string; this module only lays out and draws. macOS: the frontend renders the
//! widget to a PNG shown as the menu bar (tray) icon.

use serde::Deserialize;
use std::sync::Mutex;

#[cfg(windows)]
mod backdrop;
#[cfg(windows)]
mod paint;
#[cfg(windows)]
mod win;
#[cfg(target_os = "macos")]
mod dock;
#[cfg(target_os = "macos")]
mod dock_owners;
#[cfg(target_os = "macos")]
mod mac;

/// One labeled value, e.g. label "Session", value "42/55%", tone "ahead".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarItem {
    #[cfg_attr(not(windows), allow(dead_code))]
    pub label: String,
    pub value: String,
    /// "ahead" | "on-track" | "behind" | "neutral"
    #[cfg_attr(not(windows), allow(dead_code))]
    pub tone: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarProvider {
    #[cfg_attr(not(windows), allow(dead_code))]
    pub brand_color: Option<String>,
    /// base64 of a 64x64 alpha mask (row-major), rasterized by the frontend.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub icon_mask: Option<String>,
    pub items: Vec<TaskbarItem>,
}

/// Blur under the widget's background card (the image itself never blurs). macOS: a native blur view;
/// Windows: the desktop wallpaper behind the widget, blurred in software (taskbar/backdrop.rs).
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarBackdrop {
    /// 0..=1 strength (alpha of the blur view).
    pub blur: f64,
    /// Corner radius in pt.
    pub radius: f64,
    /// Size of the widget image in pt.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub width_pt: f64,
    pub height_pt: f64,
}

/// Windows: the widget pre-rendered by the frontend (same renderer as the macOS menu bar), straight RGBA, base64.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct WidgetImage {
    pub width: u32,
    pub height: u32,
    pub rgba: String,
}

/// macOS: a transparent PNG drawn over the Dock icon of the app with one of these bundle ids.
#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct DockOverlay {
    pub bundle_ids: Vec<String>,
    /// base64 PNG
    pub png: String,
    /// OpenUsage account (Claude accounts): the overlay goes only on the Dock tile of the app copy signed in to it.
    /// `None`: the first free tile of the app.
    #[serde(default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarPayload {
    pub providers: Vec<TaskbarProvider>,
    #[cfg_attr(not(windows), allow(dead_code))]
    pub tooltip: String,
    /// macOS: base64 PNG of the pre-rendered menu bar widget (22pt tall).
    #[serde(default)]
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub menu_bar_image: Option<String>,
    /// Blur under the image (macOS and Windows); null when the background is off or its blur is 0.
    #[serde(default)]
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    pub menu_bar_backdrop: Option<TaskbarBackdrop>,
    /// Windows: pre-rendered widget (rendered at 3x); null/absent falls back to the native text layout.
    #[serde(default)]
    #[cfg_attr(not(windows), allow(dead_code))]
    pub widget_image: Option<WidgetImage>,
    /// macOS: overlays drawn over app icons in the Dock; empty/absent = none.
    #[serde(default)]
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub dock_overlays: Option<Vec<DockOverlay>>,
}

pub(crate) struct State {
    pub payload: Option<TaskbarPayload>,
    pub enabled: bool,
    #[cfg_attr(not(windows), allow(dead_code))]
    pub hover: bool,
}

pub(crate) static STATE: Mutex<State> = Mutex::new(State {
    payload: None,
    enabled: false,
    hover: false,
});

pub(crate) fn lock_state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub fn taskbar_widget_update(payload: TaskbarPayload) {
    lock_state().payload = Some(payload);
    #[cfg(windows)]
    win::notify();
    #[cfg(target_os = "macos")]
    {
        mac::notify();
        dock::notify();
    }
}

/// Appearance of the real menu bar / taskbar: "dark" | "light", or null when unknown / not macOS or Windows.
/// Async so the main-thread read never blocks the main thread itself.
#[tauri::command]
pub async fn menu_bar_appearance(app: tauri::AppHandle) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        mac::query_appearance(&app).map(str::to_string)
    }
    #[cfg(windows)]
    {
        let _ = app;
        Some(if win::taskbar_is_light() { "light" } else { "dark" }.to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        None
    }
}

/// Re-reads the menu bar appearance (macOS); emits `menubar:appearance` when it changed.
#[cfg(target_os = "macos")]
pub fn refresh_menu_bar_appearance() {
    mac::refresh_appearance();
}

pub fn set_enabled(enabled: bool) {
    lock_state().enabled = enabled;
    #[cfg(windows)]
    win::notify();
    #[cfg(target_os = "macos")]
    mac::notify();
}

pub fn is_enabled() -> bool {
    lock_state().enabled
}

/// Starts the widget thread (Windows) / menu bar title updater (macOS). Call once from `setup`.
pub fn init(app_handle: &tauri::AppHandle) {
    #[cfg(windows)]
    win::start(app_handle.clone());
    #[cfg(target_os = "macos")]
    {
        mac::start(app_handle.clone());
        dock::start(app_handle.clone());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = app_handle;
}
