//! In-app accounts: sign in inside the app (like robinebers/openusage),
//! several accounts per provider. Each account becomes a plugin instance
//! with id `<plugin>@<account>`, so the rest of the app is unchanged.

mod login;
mod store;

use crate::plugin_engine::manifest::LoadedPlugin;
use crate::AppState;
use login::{AuthSpec, KeyField};
use rquickjs::{Ctx, Function, Object};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

pub use store::{init, Account};

/// Claude account id (`account.uuid` from the OAuth token response) of an OpenUsage Claude account.
pub(crate) fn claude_account_uuid(account_id: &str) -> Result<String, String> {
    let account = store::find(account_id).ok_or("Account not found")?;
    if account.provider != "claude" {
        return Err("Not a Claude account".into());
    }
    let secret = store::read_secret(&account.id)?;
    serde_json::from_str::<serde_json::Value>(&secret)
        .ok()
        .and_then(|json| json.pointer("/account/uuid")?.as_str().map(str::to_string))
        .filter(|uuid| !uuid.is_empty())
        .ok_or_else(|| "Sign in to this account again".to_string())
}

static LOGINS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn auth_spec(plugin: &LoadedPlugin) -> Option<Result<AuthSpec, String>> {
    let raw = plugin.manifest.auth.as_ref()?;
    Some(serde_json::from_value(raw.clone()).map_err(|e| format!("{}: invalid auth spec: {e}", plugin.manifest.id)))
}

/// Plugins with an `auth` spec turn into one instance per account; plugins
/// without accounts are hidden. Other plugins pass through unchanged.
pub fn expand_plugins(plugins: &[LoadedPlugin]) -> Vec<LoadedPlugin> {
    let accounts = store::list();
    let mut out = Vec::new();
    for plugin in plugins {
        if plugin.manifest.auth.is_none() {
            out.push(plugin.clone());
            continue;
        }
        let mine: Vec<&Account> = accounts.iter().filter(|a| a.provider == plugin.manifest.id).collect();
        for account in &mine {
            let mut instance = plugin.clone();
            instance.manifest.id = format!("{}@{}", plugin.manifest.id, account.id);
            if mine.len() > 1 || account.custom_label {
                instance.manifest.name = format!("{} · {}", plugin.manifest.name, account.label);
            }
            out.push(instance);
        }
    }
    out
}

/// Sets `ctx.account` for account instances: `{ id, label, credentials,
/// saveCredentials(json), setLabel(label) }`.
pub(crate) fn inject_account<'js>(ctx: &Ctx<'js>, probe_ctx: &Object<'js>, instance_id: &str) -> rquickjs::Result<()> {
    let Some((_, account_id)) = instance_id.split_once('@') else { return Ok(()) };
    let Some(account) = store::find(account_id) else {
        log::error!("account {account_id} not found for {instance_id}");
        return Ok(());
    };
    let text = store::read_secret(&account.id).unwrap_or_else(|error| {
        log::error!("cannot read credentials for account {}: {error}", account.id);
        "{}".into()
    });
    let obj = Object::new(ctx.clone())?;
    obj.set("id", account.id.clone())?;
    obj.set("label", account.label.clone())?;
    obj.set("credentials", ctx.json_parse(text)?)?;
    let id = account.id.clone();
    obj.set(
        "saveCredentials",
        Function::new(ctx.clone(), move |json: String| -> bool {
            store::write_secret(&id, &json)
                .map_err(|error| log::error!("cannot save credentials for account {id}: {error}"))
                .is_ok()
        })?,
    )?;
    let id = account.id.clone();
    obj.set(
        "setLabel",
        Function::new(ctx.clone(), move |label: String| {
            if let Err(error) = store::rename(&id, &label, false) {
                log::error!("cannot rename account {id}: {error}");
            }
        })?,
    )?;
    probe_ctx.set("account", obj)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProvider {
    id: String,
    name: String,
    icon_url: String,
    brand_color: Option<String>,
    /// "oauth" | "device" | "api-key"
    kind: String,
    key_url: Option<String>,
    fields: Vec<KeyField>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStarted {
    login_id: String,
    verification_url: Option<String>,
    user_code: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginFinished {
    login_id: String,
    ok: bool,
    account_id: Option<String>,
    error: Option<String>,
}

fn find_spec(state: &tauri::State<'_, Mutex<AppState>>, provider: &str) -> Result<(String, AuthSpec), String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let plugin = state.plugins.iter().find(|p| p.manifest.id == provider).ok_or(format!("unknown provider {provider}"))?;
    let spec = auth_spec(plugin).ok_or(format!("{provider} does not support sign-in"))??;
    Ok((plugin.manifest.name.clone(), spec))
}

fn changed(app: &AppHandle) {
    let _ = app.emit("accounts:changed", ());
}

#[tauri::command]
pub fn list_accounts() -> Vec<Account> {
    store::list()
}

#[tauri::command]
pub fn list_account_providers(state: tauri::State<'_, Mutex<AppState>>) -> Vec<AccountProvider> {
    let Ok(state) = state.lock() else { return Vec::new() };
    state
        .plugins
        .iter()
        .filter_map(|plugin| match auth_spec(plugin)? {
            Ok(spec) => Some((plugin, spec)),
            Err(error) => {
                log::error!("{error}");
                None
            }
        })
        .map(|(plugin, spec)| {
            let (key_url, fields) = match &spec {
                AuthSpec::ApiKey { key_url, fields } => (key_url.clone(), fields.clone()),
                _ => (None, Vec::new()),
            };
            AccountProvider {
                id: plugin.manifest.id.clone(),
                name: plugin.manifest.name.clone(),
                icon_url: plugin.icon_data_url.clone(),
                brand_color: plugin.manifest.brand_color.clone(),
                kind: spec.kind().to_string(),
                key_url,
                fields,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn start_account_login(
    app_handle: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    provider_id: String,
) -> Result<LoginStarted, String> {
    let (name, spec) = find_spec(&state, &provider_id)?;
    let opener = app_handle.clone();
    let (started, finish) = tauri::async_runtime::spawn_blocking(move || {
        login::begin(&spec, &|url: &str| {
            if let Err(error) = opener.opener().open_url(url, None::<&str>) {
                log::error!("cannot open browser: {error}");
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let login_id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    LOGINS.lock().map_err(|e| e.to_string())?.get_or_insert_with(HashMap::new).insert(login_id.clone(), cancel.clone());

    let (app, id) = (app_handle.clone(), login_id.clone());
    std::thread::spawn(move || {
        let result = finish(cancel).and_then(|credentials| store::add(&provider_id, &name, &credentials.to_string()));
        if let Ok(mut logins) = LOGINS.lock() {
            logins.get_or_insert_with(HashMap::new).remove(&id);
        }
        let payload = match result {
            Ok(account) => {
                log::info!("signed in to {} (account {})", provider_id, account.id);
                changed(&app);
                LoginFinished { login_id: id, ok: true, account_id: Some(account.id), error: None }
            }
            Err(error) => {
                if error != "cancelled" {
                    log::error!("sign-in to {provider_id} failed: {error}");
                }
                LoginFinished { login_id: id, ok: false, account_id: None, error: Some(error) }
            }
        };
        let _ = app.emit("accounts:login-finished", payload);
    });

    Ok(LoginStarted { login_id, verification_url: started.verification_url, user_code: started.user_code })
}

#[tauri::command]
pub fn cancel_account_login(login_id: String) {
    if let Ok(mut logins) = LOGINS.lock() {
        if let Some(flag) = logins.get_or_insert_with(HashMap::new).get(&login_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Adds an account from typed values (API key etc.). `label` is optional.
#[tauri::command]
pub fn add_api_key_account(
    app_handle: AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    provider_id: String,
    values: HashMap<String, String>,
    label: Option<String>,
) -> Result<Account, String> {
    let (name, spec) = find_spec(&state, &provider_id)?;
    let AuthSpec::ApiKey { fields, .. } = spec else {
        return Err(format!("{provider_id} uses a browser sign-in"));
    };
    let mut credentials = serde_json::Map::new();
    let fields = if fields.is_empty() {
        vec![KeyField { name: "apiKey".into(), label: "API key".into(), secret: true }]
    } else {
        fields
    };
    for field in fields {
        let value = values.get(&field.name).map(|v| v.trim()).unwrap_or_default();
        if value.is_empty() {
            return Err(format!("{} is required", field.label));
        }
        credentials.insert(field.name, value.into());
    }
    let label = label.filter(|l| !l.trim().is_empty()).unwrap_or(name);
    let account = store::add(&provider_id, label.trim(), &serde_json::Value::Object(credentials).to_string())?;
    changed(&app_handle);
    Ok(account)
}

#[tauri::command]
pub fn remove_account(app_handle: AppHandle, id: String) -> Result<(), String> {
    store::remove(&id)?;
    changed(&app_handle);
    Ok(())
}

#[tauri::command]
pub fn rename_account(app_handle: AppHandle, id: String, label: String) -> Result<(), String> {
    store::rename(&id, &label, true)?;
    changed(&app_handle);
    Ok(())
}
