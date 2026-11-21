//! Claude Desktop (Windows): open the app signed in as a given OpenUsage Claude account,
//! side by side with other accounts. The app's default data folder holds the main sign-in;
//! each extra account runs from its own folder under `~/Claude-Contas` (`--user-data-dir`).
//! Claude Desktop records the signed-in account in each folder's `config.json`
//! (`lastKnownAccountUuid`), which is how a folder is matched to an account.

use std::path::{Path, PathBuf};

/// Folder in the user's home holding one data folder per extra account.
const PROFILES_DIR: &str = "Claude-Contas";

#[derive(Debug, PartialEq)]
enum Target {
    Main,
    Folder(PathBuf),
}

/// Account signed in to a Claude Desktop data folder, if any.
fn signed_in_uuid(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("config.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("lastKnownAccountUuid")?
        .as_str()
        .filter(|uuid| !uuid.is_empty())
        .map(str::to_string)
}

/// The app's default data folder (MSIX install): `%LOCALAPPDATA%\Claude-Data\claude_<package id>`.
fn main_dir() -> Option<PathBuf> {
    let root = dirs::data_local_dir()?.join("Claude-Data");
    std::fs::read_dir(root)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .find(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("claude_"))
        })
}

/// Extra data folders, sorted by name, with the account signed in to each.
fn extra_dirs(root: &Path) -> Vec<(PathBuf, Option<String>)> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs.into_iter()
        .map(|dir| {
            let uuid = signed_in_uuid(&dir);
            (dir, uuid)
        })
        .collect()
}

/// Where `uuid` opens: the folder already signed in as it; else a folder not signed in yet
/// (main first); else a new folder for the account.
fn pick(
    uuid: &str,
    main_uuid: Option<&str>,
    extras: &[(PathBuf, Option<String>)],
    new_dir: PathBuf,
) -> Target {
    if main_uuid == Some(uuid) {
        return Target::Main;
    }
    if let Some((dir, _)) = extras.iter().find(|(_, signed_in)| signed_in.as_deref() == Some(uuid)) {
        return Target::Folder(dir.clone());
    }
    if main_uuid.is_none() {
        return Target::Main;
    }
    if let Some((dir, _)) = extras.iter().find(|(_, signed_in)| signed_in.is_none()) {
        return Target::Folder(dir.clone());
    }
    Target::Folder(new_dir)
}

/// The app's execution alias; it stays valid across Claude Desktop updates.
fn app_path() -> Result<PathBuf, String> {
    let path = dirs::data_local_dir()
        .map(|dir| dir.join("Microsoft").join("WindowsApps").join("claude-desktop.exe"))
        .ok_or_else(|| "Cannot find the local app data folder".to_string())?;
    // The alias is a reparse point that cannot be followed, so check the link itself.
    if std::fs::symlink_metadata(&path).is_err() {
        return Err("Claude Desktop is not installed".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn open_claude_desktop(account_id: String) -> Result<(), String> {
    let uuid = crate::accounts::claude_account_uuid(&account_id)?;
    let app = app_path()?;
    let root = dirs::home_dir().ok_or("Cannot find the home folder")?.join(PROFILES_DIR);
    let main_uuid = main_dir().and_then(|dir| signed_in_uuid(&dir));
    let target = pick(&uuid, main_uuid.as_deref(), &extra_dirs(&root), root.join(&account_id));
    let mut command = std::process::Command::new(app);
    if let Target::Folder(dir) = target {
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("Cannot create {}: {error}", dir.display()))?;
        command.arg(format!("--user-data-dir={}", dir.display()));
    }
    command
        .spawn()
        .map(drop)
        .map_err(|error| format!("Cannot open Claude Desktop: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{extra_dirs, pick, signed_in_uuid, Target};
    use std::path::PathBuf;

    fn temp_root() -> PathBuf {
        let id = uuid::Uuid::new_v4().simple().to_string();
        std::env::temp_dir().join(format!("openusage-claude-desktop-{id}"))
    }

    fn extras(list: &[(&str, Option<&str>)]) -> Vec<(PathBuf, Option<String>)> {
        list.iter()
            .map(|(dir, uuid)| (PathBuf::from(dir), uuid.map(str::to_string)))
            .collect()
    }

    #[test]
    fn main_wins_when_signed_in_as_the_account() {
        assert_eq!(pick("a", Some("a"), &extras(&[("x", Some("a"))]), "new".into()), Target::Main);
    }

    #[test]
    fn folder_signed_in_as_the_account_wins() {
        let found = pick("b", Some("a"), &extras(&[("x", None), ("y", Some("b"))]), "new".into());
        assert_eq!(found, Target::Folder("y".into()));
    }

    #[test]
    fn main_not_signed_in_is_used_next() {
        assert_eq!(pick("b", None, &extras(&[("x", None)]), "new".into()), Target::Main);
    }

    #[test]
    fn then_a_folder_not_signed_in_yet() {
        let found = pick("b", Some("a"), &extras(&[("x", Some("c")), ("y", None)]), "new".into());
        assert_eq!(found, Target::Folder("y".into()));
    }

    #[test]
    fn else_a_new_folder() {
        let found = pick("b", Some("a"), &extras(&[("x", Some("c"))]), "new".into());
        assert_eq!(found, Target::Folder("new".into()));
    }

    #[test]
    fn reads_signed_in_account_and_lists_folders() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("Work")).unwrap();
        std::fs::write(
            root.join("Work").join("config.json"),
            r#"{"lastKnownAccountUuid":"u-1","locale":"pt-BR"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("Fresh")).unwrap();
        std::fs::write(root.join("Fresh").join("config.json"), r#"{"locale":"pt-BR"}"#).unwrap();
        std::fs::write(root.join("notes.txt"), "x").unwrap();
        assert_eq!(signed_in_uuid(&root.join("Work")).as_deref(), Some("u-1"));
        assert_eq!(
            extra_dirs(&root),
            vec![(root.join("Fresh"), None), (root.join("Work"), Some("u-1".to_string()))]
        );
        assert!(extra_dirs(&root.join("missing")).is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
