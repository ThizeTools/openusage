//! macOS: several copies of one app (e.g. Claude Desktop, one per account) share a bundle id, so the Dock shows
//! one tile per copy and no tile says which process it belongs to. This module pairs tiles with processes and
//! tells each process's Claude account.

use objc2_app_kit::NSRunningApplication;
use objc2_foundation::NSString;
use std::ffi::c_void;
use std::path::PathBuf;

/// Pairs an app's running Dock tiles with its processes. A tile keeps its process while both live; tiles without one
/// take the processes no tile has, oldest first (the Dock adds tiles in launch order).
pub(super) struct Owners<T> {
    pairs: Vec<(T, i32)>,
}

// Manual: `T` (a CF object) has no `Default`.
impl<T> Default for Owners<T> {
    fn default() -> Self {
        Self { pairs: Vec::new() }
    }
}

impl<T: PartialEq + Clone> Owners<T> {
    /// `tiles`: the app's running tiles in Dock order; `pids`: its processes, oldest first. Each tile's process.
    pub(super) fn update(&mut self, tiles: &[T], pids: &[i32]) -> Vec<Option<i32>> {
        self.pairs.retain(|(tile, pid)| tiles.contains(tile) && pids.contains(pid));
        let free: Vec<i32> = pids
            .iter()
            .copied()
            .filter(|pid| !self.pairs.iter().any(|(_, p)| p == pid))
            .collect();
        let mut free = free.into_iter();
        tiles
            .iter()
            .map(|tile| {
                if let Some((_, pid)) = self.pairs.iter().find(|(t, _)| t == tile) {
                    return Some(*pid);
                }
                let pid = free.next()?;
                self.pairs.push((tile.clone(), pid));
                Some(pid)
            })
            .collect()
    }
}

/// Running processes of the app with this bundle id, oldest first.
pub(super) fn app_pids(bundle_id: &str) -> Vec<i32> {
    let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle_id));
    let mut pids: Vec<i32> = apps
        .iter()
        .filter(|app| !app.isTerminated())
        .map(|app| app.processIdentifier())
        .collect();
    pids.sort_by_key(|pid| (start_time(*pid).unwrap_or(u64::MAX), *pid));
    pids
}

/// When the process started, in microseconds since the epoch.
fn start_time(pid: i32) -> Option<u64> {
    // SAFETY: `info` is a zeroed plain-data struct and the size passed is its size, so the kernel writes
    // only inside it; the call fully succeeded only when it returns exactly that size.
    unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        let read = libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut c_void, size);
        (read == size).then(|| info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec)
    }
}

/// The process's argv (`None` when it cannot be read, e.g. the process is gone).
fn process_args(pid: i32) -> Option<Vec<String>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size: libc::size_t = 0;
    // SAFETY: `mib` has 3 entries; a null buffer only asks for the size, written to `size`.
    let status = unsafe {
        libc::sysctl(mib.as_mut_ptr(), 3, std::ptr::null_mut(), &mut size, std::ptr::null_mut(), 0)
    };
    if status != 0 || size == 0 {
        return None;
    }
    let mut buf = vec![0u8; size];
    // SAFETY: `buf` is `size` bytes long and `size` tells the kernel so; it writes at most that many bytes.
    let status = unsafe {
        libc::sysctl(mib.as_mut_ptr(), 3, buf.as_mut_ptr() as *mut c_void, &mut size, std::ptr::null_mut(), 0)
    };
    if status != 0 {
        return None;
    }
    buf.truncate(size);
    parse_procargs(&buf)
}

/// Parses a `KERN_PROCARGS2` buffer: `argc` (native-endian i32), the exec path, NUL padding, then `argc`
/// NUL-terminated argv strings (the environment after them is ignored). `None` when the buffer is cut short.
fn parse_procargs(buf: &[u8]) -> Option<Vec<String>> {
    let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?);
    let mut pos = 4 + buf.get(4..)?.iter().position(|b| *b == 0)? + 1;
    while buf.get(pos) == Some(&0) {
        pos += 1;
    }
    let mut args = Vec::new();
    for _ in 0..argc.max(0) {
        let len = buf.get(pos..)?.iter().position(|b| *b == 0)?;
        args.push(String::from_utf8_lossy(&buf[pos..pos + len]).into_owned());
        pos += len + 1;
    }
    Some(args)
}

/// The `--user-data-dir=` folder the process was started with.
fn user_data_dir(args: &[String]) -> Option<PathBuf> {
    args.iter().find_map(|arg| arg.strip_prefix("--user-data-dir=")).map(PathBuf::from)
}

/// Claude account uuid signed in to this Claude Desktop process (its data folder's `config.json`).
/// Unreadable argv gives `None`, never the default folder.
pub(super) fn process_account(pid: i32) -> Option<String> {
    let args = process_args(pid)?;
    crate::claude_desktop::signed_in_account(user_data_dir(&args).as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_pairs_tiles_with_processes_in_order() {
        let mut owners = Owners::default();
        assert_eq!(owners.update(&["a", "b"], &[10, 20]), vec![Some(10), Some(20)]);
    }

    #[test]
    fn a_new_launch_adds_a_tile_and_keeps_old_pairs() {
        let mut owners = Owners::default();
        owners.update(&["a", "b"], &[10, 20]);
        assert_eq!(owners.update(&["a", "b", "c"], &[10, 20, 30]), vec![Some(10), Some(20), Some(30)]);
    }

    #[test]
    fn a_pinned_tile_taken_by_a_new_copy_keeps_the_other_pairing() {
        let mut owners = Owners::default();
        owners.update(&["pinned", "x"], &[10, 20]);
        // 10 quits: the pinned tile stops running and drops out of the running tiles.
        assert_eq!(owners.update(&["x"], &[20]), vec![Some(20)]);
        // A new copy (30) takes the pinned tile; launch order alone would say pinned = 20.
        assert_eq!(owners.update(&["pinned", "x"], &[20, 30]), vec![Some(30), Some(20)]);
    }

    #[test]
    fn a_tile_without_a_free_process_has_no_owner() {
        let mut owners = Owners::default();
        assert_eq!(owners.update(&["a", "b"], &[10]), vec![Some(10), None]);
    }

    /// `argc`, the exec path, three NUL padding bytes, argv, then one environment string.
    fn procargs() -> Vec<u8> {
        let mut buf = 2i32.to_ne_bytes().to_vec();
        buf.extend_from_slice(b"/A/Claude\0\0\0\0/A/Claude\0--user-data-dir=/x/y\0PATH=/bin\0");
        buf
    }

    #[test]
    fn parses_argv_after_the_exec_path_and_padding() {
        assert_eq!(
            parse_procargs(&procargs()),
            Some(vec!["/A/Claude".to_string(), "--user-data-dir=/x/y".to_string()])
        );
    }

    #[test]
    fn a_cut_or_empty_buffer_has_no_argv() {
        let mut buf = procargs();
        // Cut inside the second argv string (no terminator).
        buf.truncate(4 + b"/A/Claude\0\0\0\0/A/Claude\0--user-data".len());
        assert_eq!(parse_procargs(&buf), None);
        assert_eq!(parse_procargs(&[]), None);
    }

    #[test]
    fn finds_the_user_data_dir_flag() {
        let args = vec!["/A/Claude".to_string(), "--user-data-dir=/x/y".to_string()];
        assert_eq!(user_data_dir(&args), Some(PathBuf::from("/x/y")));
        assert_eq!(user_data_dir(&["/A/Claude".to_string()]), None);
    }
}
