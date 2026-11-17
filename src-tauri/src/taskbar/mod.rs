//! Taskbar widget (Windows): a layered child window of `Shell_TrayWnd`,
//! placed left of the notification area. Same technique as
//! krisgfx9/Wireless-Device-Battery-Monitor. The frontend formats every
//! string; this module only lays out and draws.

use serde::Deserialize;
use std::sync::Mutex;

#[cfg(windows)]
mod paint;
#[cfg(windows)]
mod win;

/// One labeled value, e.g. label "Session", value "42/55%", tone "ahead".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarItem {
    pub label: String,
    pub value: String,
    /// "ahead" | "on-track" | "behind" | "neutral"
    pub tone: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarProvider {
    pub brand_color: Option<String>,
    /// base64 of a 64x64 alpha mask (row-major), rasterized by the frontend.
    pub icon_mask: Option<String>,
    pub items: Vec<TaskbarItem>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarPayload {
    pub providers: Vec<TaskbarProvider>,
    pub tooltip: String,
}

pub(crate) struct State {
    pub payload: Option<TaskbarPayload>,
    pub enabled: bool,
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
}

pub fn set_enabled(enabled: bool) {
    lock_state().enabled = enabled;
    #[cfg(windows)]
    win::notify();
}

pub fn is_enabled() -> bool {
    lock_state().enabled
}

/// Starts the widget thread (Windows only). Call once from `setup`.
pub fn init(app_handle: &tauri::AppHandle) {
    #[cfg(windows)]
    win::start(app_handle.clone());
    #[cfg(not(windows))]
    let _ = app_handle;
}
