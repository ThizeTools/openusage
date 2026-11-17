//! Taskbar widget visibility (persisted as `widgetVisible`). Drawing lives in
//! `taskbar/`.

use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

// New key: the old "widgetVisible" belonged to the floating widget.
const WIDGET_VISIBLE_KEY: &str = "taskbarWidgetVisible";

fn persist_visible(app_handle: &AppHandle, visible: bool) {
    if let Ok(store) = app_handle.store("settings.json") {
        store.set(WIDGET_VISIBLE_KEY, serde_json::json!(visible));
        let _ = store.save();
    }
    let _ = app_handle.emit("widget:visibility", visible);
}

pub fn set_widget_visible(app_handle: &AppHandle, visible: bool) {
    crate::taskbar::set_enabled(visible);
    persist_visible(app_handle, visible);
}

/// Toggles widget visibility. Returns the new visibility state.
pub fn toggle_widget(app_handle: &AppHandle) -> bool {
    let visible = !crate::taskbar::is_enabled();
    set_widget_visible(app_handle, visible);
    visible
}

/// Startup: shown unless the user turned it off.
pub fn restore_on_startup(app_handle: &AppHandle) {
    let visible = app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| store.get(WIDGET_VISIBLE_KEY))
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    crate::taskbar::set_enabled(visible);
}
