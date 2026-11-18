//! Account metadata in `accounts.json`; secrets (token JSON) encrypted in
//! `accounts/<id>.bin`: DPAPI on Windows, AES-256-GCM on macOS with the key
//! kept in the Keychain. Credential Manager is not used on Windows: its 2.5 KB
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
    let plain = protect(&bytes, false)?;
    String::from_utf8(plain).map_err(|e| e.to_string())
}

pub fn write_secret(id: &str, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("credentials are not JSON: {e}"))?;
    let path = secret_path(id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, protect(json.as_bytes(), true)?).map_err(|e| format!("failed to write account secret: {e}"))
}

#[cfg(windows)]
fn protect(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
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

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "com.sunstory.openusage";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "accounts-master-key";
#[cfg(target_os = "macos")]
const NONCE_LEN: usize = 12;
/// errSecItemNotFound
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// Encrypts `plain` with AES-256-GCM; output is nonce (12 bytes) + ciphertext.
#[cfg(target_os = "macos")]
fn seal(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit, OsRng, rand_core::RngCore};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| "failed to encrypt account secret".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

#[cfg(target_os = "macos")]
fn open(key: &[u8; 32], sealed: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    if sealed.len() < NONCE_LEN {
        return Err("account secret is corrupted (too short)".to_string());
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "failed to decrypt account secret (wrong key or corrupted file)".to_string())
}

/// Master key from the Keychain (generated and stored on first use), cached
/// for the process so the Keychain is hit once.
#[cfg(target_os = "macos")]
fn master_key() -> Result<[u8; 32], String> {
    use aes_gcm::aead::{OsRng, rand_core::RngCore};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use security_framework::passwords::{get_generic_password, set_generic_password};

    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);
    let mut cached = KEY.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(key) = *cached {
        return Ok(key);
    }
    let key = match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(bytes) => {
            let decoded = STANDARD
                .decode(String::from_utf8_lossy(&bytes).trim())
                .map_err(|e| format!("accounts master key in Keychain is invalid: {e}"))?;
            <[u8; 32]>::try_from(decoded.as_slice())
                .map_err(|_| "accounts master key in Keychain has the wrong length".to_string())?
        }
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, STANDARD.encode(key).as_bytes())
                .map_err(|e| format!("failed to store accounts master key in Keychain: {e}"))?;
            key
        }
        Err(error) => return Err(format!("failed to read accounts master key from Keychain: {error}")),
    };
    *cached = Some(key);
    Ok(key)
}

#[cfg(target_os = "macos")]
fn protect(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    let key = master_key()?;
    if encrypt { seal(&key, data) } else { open(&key, data) }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn protect(_data: &[u8], _encrypt: bool) -> Result<Vec<u8>, String> {
    Err("in-app accounts are only supported on Windows and macOS".to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn seal_open_round_trip() {
        let key = [7u8; 32];
        let sealed = seal(&key, b"{\"token\":\"abc\"}").unwrap();
        assert!(sealed.len() > NONCE_LEN);
        assert_eq!(open(&key, &sealed).unwrap(), b"{\"token\":\"abc\"}");
    }

    #[test]
    fn tampered_or_short_data_fails() {
        let key = [7u8; 32];
        let mut sealed = seal(&key, b"secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xff;
        assert!(open(&key, &sealed).is_err());
        assert!(open(&key, &[0u8; 5]).is_err());
        assert!(open(&[8u8; 32], &seal(&key, b"secret").unwrap()).is_err());
    }
}
