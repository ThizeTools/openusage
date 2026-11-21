#[cfg(target_os = "macos")]
mod app_nap;
mod config;
#[cfg(target_os = "macos")]
mod macos_dock;
mod local_http_api;
mod log_path;
mod panel;
mod plugin_engine;
mod settings_window;
mod tray;
#[cfg(target_os = "macos")]
mod webkit_config;
mod accounts;
mod claude_desktop;
mod taskbar;
mod widget;

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_log::{Target, TargetKind};
use uuid::Uuid;

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const STATS_SHORTCUT_STORE_KEY: &str = "statsShortcut";
const DAILY_ACTIVE_TRACKED_DAY_KEY: &str = "analytics.daily_active_day";
const DAILY_ACTIVE_EVENT_NAME: &str = "app_started";
fn probe_worker_count(plugin_count: usize) -> usize {
    plugin_count
}

fn today_utc_ymd() -> String {
    let date = time::OffsetDateTime::now_utc().date();
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        date.month() as u8,
        date.day()
    )
}

fn should_track_daily_active(last_tracked_day: Option<&str>, today: &str) -> bool {
    match last_tracked_day {
        Some(day) => day != today,
        None => true,
    }
}

#[cfg(desktop)]
fn track_daily_active_if_needed(app_handle: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;

    let today = today_utc_ymd();

    let store = match app_handle.store("settings.json") {
        Ok(store) => store,
        Err(error) => {
            log::warn!(
                "Failed to access settings store for daily analytics gate: {}",
                error
            );
            return;
        }
    };

    let last_tracked_day = store
        .get(DAILY_ACTIVE_TRACKED_DAY_KEY)
        .and_then(|value| value.as_str().map(|value| value.to_string()));

    if !should_track_daily_active(last_tracked_day.as_deref(), &today) {
        return;
    }

    if let Err(error) = app_handle.track_event(DAILY_ACTIVE_EVENT_NAME, None) {
        log::warn!("Failed to track daily analytics event: {}", error);
        return;
    }

    store.set(
        DAILY_ACTIVE_TRACKED_DAY_KEY,
        serde_json::Value::String(today),
    );
    if let Err(error) = store.save() {
        log::warn!("Failed to save daily analytics tracked day: {}", error);
    }
}

#[cfg(not(desktop))]
fn track_daily_active_if_needed(app_handle: &tauri::AppHandle) {
    let _ = app_handle.track_event(DAILY_ACTIVE_EVENT_NAME, None);
}

#[cfg(desktop)]
fn seconds_until_next_utc_day(now: time::OffsetDateTime) -> u64 {
    let now_time = now.time();
    let seconds_since_midnight = u64::from(now_time.hour()) * 60 * 60
        + u64::from(now_time.minute()) * 60
        + u64::from(now_time.second());
    let seconds_until_next_day = 86_400_u64.saturating_sub(seconds_since_midnight);
    if seconds_until_next_day == 0 {
        86_400
    } else {
        seconds_until_next_day
    }
}

#[cfg(desktop)]
fn spawn_daily_active_rollover_tracker(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            let sleep_for = std::time::Duration::from_secs(seconds_until_next_utc_day(
                time::OffsetDateTime::now_utc(),
            ));
            std::thread::sleep(sleep_for);
            track_daily_active_if_needed(&app_handle);
        }
    });
}

#[cfg(desktop)]
fn managed_stats_shortcut_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Shortcut handler that toggles the stats popup (main window) when pressed.
#[cfg(desktop)]
fn handle_stats_shortcut(
    app: &tauri::AppHandle,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == ShortcutState::Pressed {
        log::debug!("Stats shortcut triggered");
        panel::toggle_panel(app);
    }
}

/// Registers/unregisters a managed global shortcut, keeping `slot` in sync with
/// the actual registration. Passing `None` disables it.
#[cfg(desktop)]
fn apply_managed_shortcut(
    app_handle: &tauri::AppHandle,
    slot: &'static Mutex<Option<String>>,
    shortcut: Option<String>,
    handler: fn(&tauri::AppHandle, tauri_plugin_global_shortcut::ShortcutEvent),
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    let normalized_shortcut = shortcut.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let mut managed_shortcut = slot
        .lock()
        .map_err(|e| format!("failed to lock managed shortcut state: {}", e))?;

    if *managed_shortcut == normalized_shortcut {
        log::debug!("Global shortcut unchanged");
        return Ok(());
    }

    let previous_shortcut = managed_shortcut.clone();
    if let Some(existing) = previous_shortcut.as_deref() {
        match global_shortcut.unregister(existing) {
            Ok(()) => {
                *managed_shortcut = None;
            }
            Err(e) => {
                log::warn!(
                    "Failed to unregister existing shortcut '{}': {}",
                    existing,
                    e
                );
            }
        }
    }

    if let Some(shortcut) = normalized_shortcut {
        log::info!("Registering global shortcut: {}", shortcut);
        global_shortcut
            .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
                handler(app, event);
            })
            .map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
        *managed_shortcut = Some(shortcut);
    } else {
        log::info!("Global shortcut disabled");
        *managed_shortcut = None;
    }

    Ok(())
}

/// Registers a stored shortcut at startup, recording it in `slot`.
#[cfg(desktop)]
fn register_initial_shortcut(
    app_handle: &tauri::AppHandle,
    store_key: &str,
    slot: &'static Mutex<Option<String>>,
    handler: fn(&tauri::AppHandle, tauri_plugin_global_shortcut::ShortcutEvent),
) {
    use tauri_plugin_store::StoreExt;

    let Ok(store) = app_handle.store("settings.json") else {
        return;
    };
    let Some(shortcut) = store
        .get(store_key)
        .and_then(|value| value.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
    else {
        return;
    };

    log::info!("Registering initial global shortcut: {}", shortcut);
    if let Err(e) =
        app_handle
            .global_shortcut()
            .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
                handler(app, event);
            })
    {
        log::warn!("Failed to register initial global shortcut: {}", e);
    } else if let Ok(mut managed_shortcut) = slot.lock() {
        *managed_shortcut = Some(shortcut);
    } else {
        log::warn!("Failed to store managed shortcut in memory");
    }
}

pub struct AppState {
    pub plugins: Vec<plugin_engine::manifest::LoadedPlugin>,
    pub app_data_dir: PathBuf,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub icon_url: String,
    pub brand_color: Option<String>,
    pub lines: Vec<ManifestLineDto>,
    pub links: Vec<PluginLinkDto>,
    /// Ordered list of primary metric candidates (sorted by primaryOrder).
    /// Frontend picks the first one that exists in runtime data.
    pub primary_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestLineDto {
    #[serde(rename = "type")]
    pub line_type: String,
    pub label: String,
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginLinkDto {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchStarted {
    pub batch_id: String,
    pub plugin_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub batch_id: String,
    pub output: plugin_engine::runtime::PluginOutput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchComplete {
    pub batch_id: String,
}

#[tauri::command]
fn init_panel(app_handle: tauri::AppHandle) {
    panel::init(&app_handle).expect("Failed to initialize panel");
}

#[tauri::command]
fn hide_panel(app_handle: tauri::AppHandle) {
    panel::hide_panel(&app_handle);
}

#[tauri::command]
fn toggle_panel(app_handle: tauri::AppHandle) {
    panel::toggle_panel(&app_handle);
}

#[tauri::command]
fn reposition_panel(app_handle: tauri::AppHandle) {
    panel::reposition_panel(&app_handle);
}

#[tauri::command]
fn toggle_widget(app_handle: tauri::AppHandle) -> bool {
    widget::toggle_widget(&app_handle)
}

#[tauri::command]
fn set_widget_visible(app_handle: tauri::AppHandle, visible: bool) {
    widget::set_widget_visible(&app_handle, visible);
}

#[tauri::command]
fn open_devtools(#[allow(unused)] app_handle: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window.open_devtools();
        }
    }
}

#[tauri::command]
async fn start_probe_batch(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    batch_id: Option<String>,
    plugin_ids: Option<Vec<String>>,
) -> Result<ProbeBatchStarted, String> {
    let batch_id = batch_id
        .and_then(|id| {
            let trimmed = id.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let (plugins, app_data_dir, app_version) = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        (
            accounts::expand_plugins(&locked.plugins),
            locked.app_data_dir.clone(),
            locked.app_version.clone(),
        )
    };

    let selected_plugins = match plugin_ids {
        Some(ids) => {
            let mut by_id: HashMap<String, plugin_engine::manifest::LoadedPlugin> = plugins
                .into_iter()
                .map(|plugin| (plugin.manifest.id.clone(), plugin))
                .collect();
            let mut seen = HashSet::new();
            ids.into_iter()
                .filter_map(|id| {
                    if !seen.insert(id.clone()) {
                        return None;
                    }
                    by_id.remove(&id)
                })
                .collect()
        }
        None => plugins,
    };

    let response_plugin_ids: Vec<String> = selected_plugins
        .iter()
        .map(|plugin| plugin.manifest.id.clone())
        .collect();

    log::info!(
        "probe batch {} starting: {:?}",
        batch_id,
        response_plugin_ids
    );

    if selected_plugins.is_empty() {
        let _ = app_handle.emit(
            "probe:batch-complete",
            ProbeBatchComplete {
                batch_id: batch_id.clone(),
            },
        );
        return Ok(ProbeBatchStarted {
            batch_id,
            plugin_ids: response_plugin_ids,
        });
    }

    let selected_count = selected_plugins.len();
    let worker_count = probe_worker_count(selected_count);
    let remaining = Arc::new(AtomicUsize::new(selected_count));
    let probe_queue = Arc::new(Mutex::new(
        selected_plugins.into_iter().collect::<VecDeque<_>>(),
    ));

    for _ in 0..worker_count {
        let handle = app_handle.clone();
        let completion_handle = app_handle.clone();
        let bid = batch_id.clone();
        let completion_bid = batch_id.clone();
        let data_dir = app_data_dir.clone();
        let version = app_version.clone();
        let counter = Arc::clone(&remaining);
        let queue = Arc::clone(&probe_queue);

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let plugin = {
                    let mut queue = queue
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    queue.pop_front()
                };

                let Some(plugin) = plugin else {
                    break;
                };

                let plugin_id = plugin.manifest.id.clone();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    plugin_engine::runtime::run_probe(&plugin, &data_dir, &version)
                }));

                match result {
                    Ok(output) => {
                        let has_error = output.lines.iter().any(|line| {
                            matches!(line, plugin_engine::runtime::MetricLine::Badge { label, .. } if label == "Error")
                        });
                        if has_error || output.failure.is_some() {
                            log::warn!("probe {} completed with error", plugin_id);
                        } else {
                            log::info!(
                                "probe {} completed ok ({} lines)",
                                plugin_id,
                                output.lines.len()
                            );
                            local_http_api::cache_successful_output(&output);
                        }
                        let _ = handle.emit(
                            "probe:result",
                            ProbeResult {
                                batch_id: bid.clone(),
                                output,
                            },
                        );
                    }
                    Err(_) => {
                        log::error!("probe {} panicked", plugin_id);
                    }
                }

                if counter.fetch_sub(1, Ordering::SeqCst) == 1 {
                    log::info!("probe batch {} complete", completion_bid);
                    let _ = completion_handle.emit(
                        "probe:batch-complete",
                        ProbeBatchComplete {
                            batch_id: completion_bid.clone(),
                        },
                    );
                }
            }
        });
    }

    Ok(ProbeBatchStarted {
        batch_id,
        plugin_ids: response_plugin_ids,
    })
}

#[tauri::command]
fn get_log_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    log_path::for_app(&app_handle).map(|path| path.to_string_lossy().to_string())
}

/// Update the shortcut that toggles the stats popup. `null` disables it.
#[cfg(desktop)]
#[tauri::command]
fn update_stats_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<(), String> {
    apply_managed_shortcut(
        &app_handle,
        managed_stats_shortcut_slot(),
        shortcut,
        handle_stats_shortcut,
    )
}

/// Shows (or reveals) the dedicated Settings window.
#[tauri::command]
fn open_settings_window(app_handle: tauri::AppHandle) {
    settings_window::open(&app_handle);
}

#[tauri::command]
fn list_plugins(state: tauri::State<'_, Mutex<AppState>>) -> Vec<PluginMeta> {
    let plugins = {
        let locked = state.lock().expect("plugin state poisoned");
        accounts::expand_plugins(&locked.plugins)
    };
    log::debug!("list_plugins: {} plugins", plugins.len());

    plugins
        .into_iter()
        .map(|plugin| {
            // Extract primary candidates: progress lines with primary_order, sorted by order
            let mut candidates: Vec<_> = plugin
                .manifest
                .lines
                .iter()
                .filter(|line| line.line_type == "progress" && line.primary_order.is_some())
                .collect();
            candidates.sort_by_key(|line| line.primary_order.unwrap());
            let primary_candidates: Vec<String> =
                candidates.iter().map(|line| line.label.clone()).collect();

            PluginMeta {
                id: plugin.manifest.id,
                name: plugin.manifest.name,
                icon_url: plugin.icon_data_url,
                brand_color: plugin.manifest.brand_color,
                lines: plugin
                    .manifest
                    .lines
                    .iter()
                    .map(|line| ManifestLineDto {
                        line_type: line.line_type.clone(),
                        label: line.label.clone(),
                        scope: line.scope.clone(),
                    })
                    .collect(),
                links: plugin
                    .manifest
                    .links
                    .iter()
                    .map(|link| PluginLinkDto {
                        label: link.label.clone(),
                        url: link.url.clone(),
                    })
                    .collect(),
                primary_candidates,
            }
        })
        .collect()
}

#[tauri::command]
fn get_cached_probe_outputs(
    state: tauri::State<'_, Mutex<AppState>>,
) -> Vec<local_http_api::CachedProbeOutput> {
    let icon_urls: HashMap<String, String> = {
        let locked = state.lock().expect("plugin state poisoned");
        accounts::expand_plugins(&locked.plugins)
            .iter()
            .map(|plugin| (plugin.manifest.id.clone(), plugin.icon_data_url.clone()))
            .collect()
    };

    local_http_api::cached_snapshots()
        .into_iter()
        .map(|snapshot| {
            let icon_url = icon_urls
                .get(&snapshot.provider_id)
                .cloned()
                .unwrap_or_default();
            local_http_api::snapshot_to_cached_output(snapshot, icon_url)
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runtime = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
    let _guard = runtime.enter();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_aptabase::Builder::new("A-US-6435241436").build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(10_000_000) // 10 MB
                .level(log::LevelFilter::Trace) // Allow all levels; runtime filter via tray menu
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Info)
                .level_for("tauri_plugin_updater", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            init_panel,
            hide_panel,
            toggle_panel,
            reposition_panel,
            toggle_widget,
            set_widget_visible,
            taskbar::taskbar_widget_update,
            taskbar::menu_bar_appearance,
            accounts::list_accounts,
            accounts::list_account_providers,
            accounts::start_account_login,
            accounts::cancel_account_login,
            accounts::add_api_key_account,
            accounts::remove_account,
            accounts::rename_account,
            claude_desktop::open_claude_desktop,
            open_devtools,
            open_settings_window,
            start_probe_batch,
            list_plugins,
            get_cached_probe_outputs,
            get_log_path,
            update_stats_shortcut
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                macos_dock::install_menu(app)?;
            }

            #[cfg(target_os = "macos")]
            {
                app_nap::disable_app_nap();
                webkit_config::disable_webview_suspension(app.handle());
            }

            use tauri::Manager;

            let version = app.package_info().version.to_string();
            log::info!("OpenUsage v{} starting", version);

            // Load config early (lazy init via OnceLock, zero-cost after)
            let _proxy = config::get_resolved_proxy();

            track_daily_active_if_needed(app.handle());
            #[cfg(desktop)]
            spawn_daily_active_rollover_tracker(app.handle().clone());

            let app_data_dir = app.path().app_data_dir().expect("no app data dir");
            let resource_dir = app.path().resource_dir().expect("no resource dir");
            let app_data_dir_tail = app_data_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown");
            let redacted_app_data_dir =
                plugin_engine::host_api::redact_log_message(&app_data_dir.display().to_string());
            log::debug!(
                "app_data_dir: tail={}, path={}",
                app_data_dir_tail,
                redacted_app_data_dir
            );

            let (_, plugins) = plugin_engine::initialize_plugins(&app_data_dir, &resource_dir);
            accounts::init(&app_data_dir);
            let known_plugin_ids: Vec<String> =
                plugins.iter().map(|p| p.manifest.id.clone()).collect();
            app.manage(Mutex::new(AppState {
                plugins,
                app_data_dir: app_data_dir.clone(),
                app_version: app.package_info().version.to_string(),
            }));

            local_http_api::init(&app_data_dir, known_plugin_ids);
            local_http_api::start_server();

            tray::create(app.handle())?;

            // Taskbar widget: own thread; visible unless turned off.
            taskbar::init(app.handle());
            widget::restore_on_startup(app.handle());

            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // Register the global shortcut (toggles the stats panel) from stored settings.
            #[cfg(desktop)]
            {
                register_initial_shortcut(
                    app.handle(),
                    STATS_SHORTCUT_STORE_KEY,
                    managed_stats_shortcut_slot(),
                    handle_stats_shortcut,
                );
            }

            // Keep the Settings window alive across closes: hide instead of destroy.
            if let Some(settings) = app.get_webview_window(settings_window::SETTINGS_LABEL) {
                // macOS: native title bar (traffic lights) instead of the custom
                // Windows-style one the frontend draws on other platforms.
                #[cfg(target_os = "macos")]
                let _ = settings.set_decorations(true);
                let handle = settings.clone();
                settings.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = handle.hide();
                        // Back to a menu-bar-only app (no Dock icon / Cmd-Tab entry).
                        #[cfg(target_os = "macos")]
                        macos_dock::settings_hidden();
                    }
                });
            }

            // On Windows/Linux the main window is a frameless tray popup (macOS uses
            // an NSPanel). Hide it on focus loss (click-outside-to-close) and never
            // destroy it on close so the tray can always reopen it.
            #[cfg(not(target_os = "macos"))]
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Focused(false) => {
                        panel::schedule_blur_hide(&app_handle);
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        panel::hide_panel(&app_handle);
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            // Dock icon click (only present while Settings is open): bring Settings forward.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => macos_dock::handle_reopen(_app_handle),
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                local_http_api::flush_cache();
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::{
        probe_worker_count, seconds_until_next_utc_day, should_track_daily_active,
        DAILY_ACTIVE_TRACKED_DAY_KEY,
    };
    use time::{Date, Month, PrimitiveDateTime, Time};

    #[test]
    fn should_track_when_no_previous_day() {
        assert!(should_track_daily_active(None, "2026-02-12"));
    }

    #[test]
    fn should_not_track_when_same_day() {
        assert!(!should_track_daily_active(Some("2026-02-12"), "2026-02-12"));
    }

    #[test]
    fn should_track_when_day_changes() {
        assert!(should_track_daily_active(Some("2026-02-11"), "2026-02-12"));
    }

    #[test]
    fn daily_active_key_is_not_version_scoped() {
        assert_eq!(DAILY_ACTIVE_TRACKED_DAY_KEY, "analytics.daily_active_day");
        assert!(!DAILY_ACTIVE_TRACKED_DAY_KEY.contains("0.6.2"));
        assert!(!DAILY_ACTIVE_TRACKED_DAY_KEY.contains("0.6.3"));
    }

    #[test]
    fn rollover_sleep_waits_for_next_utc_day_boundary() {
        let now = PrimitiveDateTime::new(
            Date::from_calendar_date(2026, Month::February, 12).unwrap(),
            Time::from_hms(23, 59, 50).unwrap(),
        )
        .assume_utc();

        assert_eq!(seconds_until_next_utc_day(now), 10);
    }

    #[test]
    fn probe_worker_count_keeps_providers_independent() {
        assert_eq!(probe_worker_count(0), 0);
        assert_eq!(probe_worker_count(1), 1);
        assert_eq!(probe_worker_count(17), 17);
    }
}
