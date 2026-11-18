//! macOS Dock / Cmd-Tab presence while the Settings window is open.
//!
//! The app idles as an Accessory (menu bar only) app. The stats panel is a transient
//! popup and never changes the policy; only the Settings window does: it is Regular
//! (Dock icon, Cmd-Tab entry) exactly while Settings is visible. All AppKit calls
//! here must run on the main thread.

use std::sync::atomic::{AtomicBool, Ordering};

use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::MainThreadMarker;
use tauri::{AppHandle, Manager};
use tauri_nspanel::ManagerExt;

use crate::settings_window::SETTINGS_LABEL;

// NSApplicationActivationPolicyRegular = 0, ...Accessory = 1.
const POLICY_REGULAR: isize = 0;
const POLICY_ACCESSORY: isize = 1;

static IS_REGULAR: AtomicBool = AtomicBool::new(false);

/// Runs `f` on the main thread (inline when already there).
pub fn run_main(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    if MainThreadMarker::new().is_some() {
        f(app);
        return;
    }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || f(&handle)) {
        log::warn!("Failed to dispatch to main thread: {}", error);
    }
}

fn shared_application() -> *mut AnyObject {
    unsafe { msg_send![class!(NSApplication), sharedApplication] }
}

pub fn activate() {
    let app = shared_application();
    if !app.is_null() {
        unsafe {
            let _: () = msg_send![app, activateIgnoringOtherApps: Bool::YES];
        }
    }
}

fn set_policy_raw(regular: bool) {
    if IS_REGULAR.swap(regular, Ordering::SeqCst) == regular {
        return;
    }
    let app = shared_application();
    if app.is_null() {
        return;
    }
    let policy = if regular { POLICY_REGULAR } else { POLICY_ACCESSORY };
    unsafe {
        let _: Bool = msg_send![app, setActivationPolicy: policy];
    }
    log::debug!("activation policy -> {}", if regular { "Regular" } else { "Accessory" });
}

pub fn settings_visible(app: &AppHandle) -> bool {
    app.get_webview_window(SETTINGS_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Called right before the Settings window is shown: becomes a Regular app and
/// hides the stats panel (it would otherwise float over the window).
pub fn prepare_for_settings(app: &AppHandle) {
    set_policy_raw(true);
    if let Ok(panel) = app.get_webview_panel("main") {
        if panel.is_visible() {
            panel.hide();
        }
    }
}

/// Called after the Settings window was hidden/closed: back to a menu-bar-only app.
pub fn settings_hidden() {
    set_policy_raw(false);
}

/// Activates the app again on the next main-loop tick. Changing the activation
/// policy can make macOS briefly deactivate the app; this makes sure we end up
/// active (with Settings in front) afterwards.
pub fn reactivate_next_tick(app: &AppHandle) {
    let handle = app.clone();
    let result = app.run_on_main_thread(move || {
        if settings_visible(&handle) {
            activate();
        }
    });
    if let Err(error) = result {
        log::warn!("Failed to schedule re-activation: {}", error);
    }
}

/// Dock icon click / re-launch of the running app. The Dock icon only exists while
/// Settings is open, so this just brings Settings to the front.
pub fn handle_reopen(app: &AppHandle) {
    run_main(app, |app| {
        if !IS_REGULAR.load(Ordering::SeqCst) {
            return;
        }
        if let Some(settings) = app.get_webview_window(SETTINGS_LABEL) {
            let _ = settings.show();
            let _ = settings.unminimize();
            let _ = settings.set_focus();
        }
        activate();
    });
}

const CLOSE_WINDOW_MENU_ID: &str = "close_window";

/// App menu with a custom Cmd-W "Close Window" that hides the Settings window
/// (hide instead of destroy, and the activation policy follows).
pub fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let handle = app.handle();
    let app_menu = Submenu::with_items(
        handle,
        "OpenUsage",
        true,
        &[&PredefinedMenuItem::quit(handle, None)?],
    )?;
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let close = MenuItem::with_id(
        handle,
        CLOSE_WINDOW_MENU_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[&PredefinedMenuItem::minimize(handle, None)?, &close],
    )?;
    let menu = Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu])?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        if event.id().as_ref() == CLOSE_WINDOW_MENU_ID {
            close_front_window(app);
        }
    });
    Ok(())
}

/// Cmd-W: closes (hides) the Settings window. The stats panel is closed by
/// click-outside / Escape / tray / shortcut instead.
fn close_front_window(app: &AppHandle) {
    run_main(app, |app| {
        let Some(settings) = app.get_webview_window(SETTINGS_LABEL) else {
            return;
        };
        let panel_open = app
            .get_webview_panel("main")
            .map(|panel| panel.is_visible())
            .unwrap_or(false);
        let settings_front = settings.is_visible().unwrap_or(false)
            && (!panel_open || settings.is_focused().unwrap_or(false));
        if settings_front {
            let _ = settings.hide();
            settings_hidden();
        }
    });
}
