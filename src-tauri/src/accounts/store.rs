//! Account metadata in `accounts.json`; secrets (token JSON) encrypted with
//! DPAPI in `accounts/<id>.bin`. Credential Manager is not used: its 2.5 KB
//! blob limit is too small for OAuth responses with JWTs.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// Plugin id, e.g. "claude".
    pub provider: String,
    pub label: String,
    /// True once the user renamed it; plugins then stop overwriting the label.
    #[serde(default)]
    pub custom_label: bool,
    pub created_at: String,
}

static DIR: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

pub fn init(app_data_dir: &std::path::Path) {
    let _ = DIR.set(app_data_dir.to_path_buf());
}

fn dir() -> Result<&'static PathBuf, String> {
    DIR.get().ok_or_else(|| "accounts store not initialized".to_string())
}

fn index_path() -> Result<PathBuf, String> {
    Ok(dir()?.join("accounts.json"))
}

fn secret_path(id: &str) -> Result<PathBuf, String> {
    Ok(dir()?.join("accounts").join(format!("{id}.bin")))
}

fn read_index() -> Vec<Account> {
    let Ok(path) = index_path() else { return Vec::new() };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            log::error!("accounts.json is invalid: {error}");
            Vec::new()
        }),
        Err(_) => Vec::new(),
    }
}

fn write_index(accounts: &[Account]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(index_path()?, text).map_err(|e| format!("failed to write accounts.json: {e}"))
}

pub fn list() -> Vec<Account> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read_index()
}

pub fn find(id: &str) -> Option<Account> {
    list().into_iter().find(|a| a.id == id)
}

pub fn add(provider: &str, label: &str, credentials_json: &str) -> Result<Account, String> {
    let id = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    write_secret(&id, credentials_json)?;
    let account = Account {
        id,
        provider: provider.to_string(),
        label: label.to_string(),
        custom_label: false,
        created_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    };
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut accounts = read_index();
    accounts.push(account.clone());
    write_index(&accounts)?;
    Ok(account)
}

pub fn remove(id: &str) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut accounts = read_index();
    accounts.retain(|a| a.id != id);
    write_index(&accounts)?;
    let path = secret_path(id)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("failed to delete account secret: {e}"))?;
    }
    Ok(())
}

/// `by_user`: a manual rename sticks; plugin renames are ignored after it.
pub fn rename(id: &str, label: &str, by_user: bool) -> Result<bool, String> {
    let label = label.trim();
    if label.is_empty() {
        return Ok(false);
    }
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut accounts = read_index();
    let Some(account) = accounts.iter_mut().find(|a| a.id == id) else {
        return Err(format!("account {id} not found"));
    };
    if (!by_user && account.custom_label) || account.label == label {
        return Ok(false);
    }
    account.label = label.to_string();
    account.custom_label |= by_user;
    write_index(&accounts)?;
    Ok(true)
}

pub fn read_secret(id: &str) -> Result<String, String> {
    let bytes = std::fs::read(secret_path(id)?).map_err(|e| format!("account secret missing: {e}"))?;
    let plain = dpapi(&bytes, false)?;
    String::from_utf8(plain).map_err(|e| e.to_string())
}

pub fn write_secret(id: &str, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("credentials are not JSON: {e}"))?;
    let path = secret_path(id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, dpapi(json.as_bytes(), true)?).map_err(|e| format!("failed to write account secret: {e}"))
}

#[cfg(windows)]
fn dpapi(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    unsafe {
        let ok = if encrypt {
            CryptProtectData(&input, null(), null(), null(), null(), 0, &mut output)
        } else {
            CryptUnprotectData(&input, null_mut(), null(), null(), null(), 0, &mut output)
        };
        if ok == 0 {
            return Err(format!("DPAPI failed (error {})", GetLastError()));
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Ok(result)
    }
}

#[cfg(not(windows))]
fn dpapi(_data: &[u8], _encrypt: bool) -> Result<Vec<u8>, String> {
    Err("in-app accounts are only supported on Windows".to_string())
}
