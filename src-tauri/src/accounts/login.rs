//! Sign-in flows. Each plugin declares one in `plugin.json` -> `auth`.
//! The flows only obtain tokens; plugins use and refresh them.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

fn d_localhost() -> String { "localhost".into() }
fn d_callback() -> String { "/callback".into() }
fn d_form() -> String { "form".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyField {
    pub name: String,
    pub label: String,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AuthSpec {
    /// Authorization code + PKCE with a loopback redirect.
    #[serde(rename_all = "camelCase")]
    OauthPkce {
        authorize_url: String,
        token_url: String,
        client_id: Option<String>,
        client_secret: Option<String>,
        #[serde(default)]
        scopes: String,
        #[serde(default = "d_localhost")]
        redirect_host: String,
        /// 0 = any free port.
        #[serde(default)]
        redirect_port: u16,
        #[serde(default = "d_callback")]
        redirect_path: String,
        #[serde(default)]
        authorize_params: BTreeMap<String, String>,
        /// "form" or "json".
        #[serde(default = "d_form")]
        token_encoding: String,
        /// Subset of grant_type, client_id, client_secret, code, state,
        /// redirect_uri, code_verifier. Default: all that are set except state.
        token_params: Option<Vec<String>>,
    },
    /// RFC 8628 device authorization.
    #[serde(rename_all = "camelCase")]
    Device {
        device_url: String,
        token_url: String,
        client_id: String,
        scope: Option<String>,
        #[serde(default = "d_form")]
        encoding: String,
        #[serde(default)]
        device_params: BTreeMap<String, String>,
        #[serde(default)]
        token_params: BTreeMap<String, String>,
        /// Overrides the page to open; `{user_code}` is replaced.
        verification_url: Option<String>,
    },
    /// Cursor CLI login (browser + polling).
    Cursor,
    /// Values typed by the user (API key, org name...).
    #[serde(rename_all = "camelCase")]
    ApiKey {
        key_url: Option<String>,
        #[serde(default)]
        fields: Vec<KeyField>,
    },
}

impl AuthSpec {
    pub fn kind(&self) -> &'static str {
        match self {
            AuthSpec::OauthPkce { .. } => "oauth",
            AuthSpec::Device { .. } => "device",
            AuthSpec::Cursor => "oauth",
            AuthSpec::ApiKey { .. } => "api-key",
        }
    }
}

/// What the UI shows while the user finishes signing in.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub verification_url: Option<String>,
    pub user_code: Option<String>,
}

/// Second half of a login, run on a worker thread. Returns credential JSON.
pub type Finish = Box<dyn FnOnce(Arc<AtomicBool>) -> Result<Value, String> + Send>;

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_token() -> String {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    b64url(&bytes)
}

fn challenge(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn encode_pairs<'a>(pairs: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut url = reqwest::Url::parse("http://x/").expect("static url");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_string()
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("OpenUsage")
        .build()
        .map_err(|e| e.to_string())
}

/// POST as form or JSON; returns (status, parsed JSON body).
fn post(url: &str, encoding: &str, params: &BTreeMap<String, String>) -> Result<(u16, Value), String> {
    let request = client()?.post(url).header("Accept", "application/json");
    let request = if encoding == "json" {
        request.header("Content-Type", "application/json").body(serde_json::to_string(params).map_err(|e| e.to_string())?)
    } else {
        request
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(encode_pairs(params.iter().map(|(k, v)| (k.as_str(), v.as_str()))))
    };
    let response = request.send().map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().map_err(|e| e.to_string())?;
    let body = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text));
    Ok((status, body))
}

fn error_text(body: &Value) -> String {
    let field = |k: &str| body.get(k).and_then(Value::as_str).map(str::to_string);
    field("error_description").or_else(|| field("error")).or_else(|| field("message")).unwrap_or_else(|| body.to_string())
}

/// Adds `expiresAt` (ms) / `obtainedAt` so plugins can refresh ahead of time.
fn with_timestamps(mut body: Value) -> Value {
    let now = time::OffsetDateTime::now_utc().unix_timestamp() * 1000;
    if let Some(obj) = body.as_object_mut() {
        if let Some(secs) = obj.get("expires_in").and_then(Value::as_i64) {
            obj.insert("expiresAt".into(), Value::from(now + secs * 1000));
        }
        obj.insert("obtainedAt".into(), Value::from(now));
    }
    body
}

fn wait_or_cancel(cancel: &AtomicBool, duration: Duration) -> Result<(), String> {
    let until = Instant::now() + duration;
    while Instant::now() < until {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(())
}

/// Starts a login: returns what to show plus the blocking second half.
/// `open` opens a URL in the user's browser.
pub fn begin(spec: &AuthSpec, open: &dyn Fn(&str)) -> Result<(Started, Finish), String> {
    match spec.clone() {
        AuthSpec::OauthPkce {
            authorize_url, token_url, client_id, client_secret, scopes, redirect_host,
            redirect_port, redirect_path, authorize_params, token_encoding, token_params,
        } => {
            let listener = TcpListener::bind(("127.0.0.1", redirect_port))
                .map_err(|e| format!("cannot listen on port {redirect_port}: {e}"))?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let redirect_uri = format!("http://{redirect_host}:{port}{redirect_path}");
            let (verifier, state) = (random_token(), random_token());
            let mut params: Vec<(String, String)> = vec![
                ("response_type".into(), "code".into()),
                ("redirect_uri".into(), redirect_uri.clone()),
                ("state".into(), state.clone()),
                ("code_challenge".into(), challenge(&verifier)),
                ("code_challenge_method".into(), "S256".into()),
            ];
            if let Some(id) = &client_id {
                params.push(("client_id".into(), id.clone()));
            }
            if !scopes.is_empty() {
                params.push(("scope".into(), scopes.clone()));
            }
            params.extend(authorize_params);
            let url = reqwest::Url::parse_with_params(&authorize_url, &params).map_err(|e| e.to_string())?;
            open(url.as_str());
            let started = Started { verification_url: Some(url.to_string()), user_code: None };
            let finish: Finish = Box::new(move |cancel| {
                let code = wait_for_callback(&listener, &redirect_path, &state, &cancel)?;
                let mut all = BTreeMap::new();
                all.insert("grant_type".to_string(), "authorization_code".to_string());
                if let Some(id) = client_id { all.insert("client_id".into(), id); }
                if let Some(secret) = client_secret { all.insert("client_secret".into(), secret); }
                all.insert("code".into(), code);
                all.insert("state".into(), state);
                all.insert("redirect_uri".into(), redirect_uri);
                all.insert("code_verifier".into(), verifier);
                let wanted = token_params.unwrap_or_else(|| all.keys().filter(|k| *k != "state").cloned().collect());
                all.retain(|k, _| wanted.contains(k));
                let (status, body) = post(&token_url, &token_encoding, &all)?;
                if !(200..300).contains(&status) {
                    return Err(format!("token exchange failed ({status}): {}", error_text(&body)));
                }
                Ok(with_timestamps(body))
            });
            Ok((started, finish))
        }
        AuthSpec::Device { device_url, token_url, client_id, scope, encoding, device_params, token_params, verification_url } => {
            let mut params = device_params;
            params.insert("client_id".into(), client_id.clone());
            if let Some(scope) = scope { params.insert("scope".into(), scope); }
            let (status, body) = post(&device_url, &encoding, &params)?;
            let field = |k: &str| body.get(k).and_then(Value::as_str).map(str::to_string);
            let device_code = field("device_code").ok_or_else(|| format!("device code request failed ({status}): {}", error_text(&body)))?;
            let user_code = field("user_code").unwrap_or_default();
            let page = verification_url
                .map(|u| u.replace("{user_code}", &user_code))
                .or_else(|| field("verification_uri_complete"))
                .or_else(|| field("verification_uri"))
                .or_else(|| field("verification_url"))
                .ok_or("device response has no verification URL")?;
            let mut interval = body.get("interval").and_then(Value::as_u64).unwrap_or(5).max(1);
            open(&page);
            let started = Started { verification_url: Some(page), user_code: Some(user_code) };
            let finish: Finish = Box::new(move |cancel| {
                let deadline = Instant::now() + LOGIN_TIMEOUT;
                let mut poll = token_params;
                poll.insert("grant_type".into(), DEVICE_GRANT.into());
                poll.insert("device_code".into(), device_code);
                poll.insert("client_id".into(), client_id);
                while Instant::now() < deadline {
                    wait_or_cancel(&cancel, Duration::from_secs(interval))?;
                    let (status, body) = post(&token_url, &encoding, &poll)?;
                    if body.get("access_token").is_some() {
                        return Ok(with_timestamps(body));
                    }
                    match body.get("error").and_then(Value::as_str) {
                        Some("authorization_pending") => {}
                        Some("slow_down") => interval += 5,
                        _ if status == 202 || status == 428 => {}
                        _ => return Err(format!("sign-in failed ({status}): {}", error_text(&body))),
                    }
                }
                Err("sign-in timed out".into())
            });
            Ok((started, finish))
        }
        AuthSpec::Cursor => {
            let (verifier, uuid) = (random_token(), uuid::Uuid::new_v4().to_string());
            let url = format!(
                "https://cursor.com/loginDeepControl?challenge={}&uuid={uuid}&mode=login&redirectTarget=cli",
                challenge(&verifier)
            );
            open(&url);
            let finish: Finish = Box::new(move |cancel| {
                let poll_url = format!("https://api2.cursor.sh/auth/poll?uuid={uuid}&verifier={verifier}");
                let deadline = Instant::now() + Duration::from_secs(300);
                while Instant::now() < deadline {
                    wait_or_cancel(&cancel, Duration::from_secs(2))?;
                    let response = client()?.get(&poll_url).send().map_err(|e| e.to_string())?;
                    let status = response.status().as_u16();
                    if status == 202 || status == 404 {
                        continue;
                    }
                    let text = response.text().map_err(|e| e.to_string())?;
                    let body: Value = serde_json::from_str(&text).map_err(|_| format!("unexpected Cursor reply ({status})"))?;
                    if body.get("accessToken").is_some() {
                        return Ok(with_timestamps(body));
                    }
                    return Err(format!("Cursor sign-in failed ({status}): {}", error_text(&body)));
                }
                Err("sign-in timed out".into())
            });
            Ok((Started { verification_url: Some(url), user_code: None }, finish))
        }
        AuthSpec::ApiKey { .. } => Err("API key providers are added with values, not a login".into()),
    }
}

/// Accepts loopback requests until the redirect path arrives with a code.
fn wait_for_callback(listener: &TcpListener, path: &str, state: &str, cancel: &AtomicBool) -> Result<String, String> {
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    while Instant::now() < deadline {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = vec![0u8; 16 * 1024];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let url = reqwest::Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
        if url.path() != path {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        let query: Map<String, Value> = url.query_pairs().map(|(k, v)| (k.into_owned(), Value::from(v.into_owned()))).collect();
        let ok = query.contains_key("code") && query.get("state").and_then(Value::as_str) == Some(state);
        let message = if ok { "Signed in. You can close this tab and return to OpenUsage." } else { "Sign-in failed. Return to OpenUsage and try again." };
        let html = format!("<!doctype html><meta charset=utf-8><title>OpenUsage</title><body style=\"font-family:system-ui;padding:40px\">{message}</body>");
        let _ = stream.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len()).as_bytes(),
        );
        if let Some(error) = query.get("error").and_then(Value::as_str) {
            return Err(format!("sign-in denied: {error}"));
        }
        if !ok {
            return Err("sign-in failed: missing code or state mismatch".into());
        }
        return Ok(query["code"].as_str().unwrap_or_default().to_string());
    }
    Err("sign-in timed out".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every bundled plugin's `auth` must parse, or the provider silently
    /// disappears from Settings → Accounts.
    #[test]
    fn plugin_auth_specs_parse() {
        let mut checked = 0;
        for entry in std::fs::read_dir("../plugins").unwrap() {
            let path = entry.unwrap().path().join("plugin.json");
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let json: Value = serde_json::from_str(&text).unwrap();
            if let Some(auth) = json.get("auth") {
                serde_json::from_value::<AuthSpec>(auth.clone())
                    .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                checked += 1;
            }
        }
        assert!(checked >= 13, "only {checked} auth specs found");
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
