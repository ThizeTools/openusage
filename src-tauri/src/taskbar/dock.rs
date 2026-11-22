//! macOS Dock overlays. The frontend renders one transparent PNG per provider; this module puts each PNG
//! in a click-through window exactly over that provider's app icon in the Dock. The icons' positions come
//! from the Accessibility API (needs the Accessibility permission) and are re-read once a second, and at a
//! faster pace right after an app launches or quits (the Dock slides its icons around) until the icons stop
//! moving, because the Dock moves when apps open/close, when it is resized or hidden, and so on.

use super::DockOverlay;
use base64::Engine;
use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::bundle::CFBundle;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Why the loop was woken before its timeout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Wake {
    /// The payload changed: tick now, without speeding up the polling.
    Payload,
    /// An app launched or quit: the Dock is about to animate, so poll fast until it settles (see `Burst`).
    Burst,
}

/// Wakes the loop early (a payload update arrived, or an app launched/quit).
static WAKE: OnceLock<mpsc::Sender<Wake>> = OnceLock::new();

/// How often the Dock is re-read when nothing happens (catches the user resizing/moving/hiding the Dock,
/// reordering icons, and so on). The read is a handful of Accessibility calls and windows only move when
/// something changed.
const IDLE_TICK: Duration = Duration::from_secs(1);
/// How often the Dock is re-read while it is likely animating (right after an app launched or quit).
const BURST_TICK: Duration = Duration::from_millis(50);
/// A burst always reads fast for at least this long: the Dock may start its slide animation a little after
/// the launch/quit notification, so identical early reads must not end the burst.
const BURST_MIN: Duration = Duration::from_millis(400);
/// Hard cap on a burst, in case the Dock never looks settled (e.g. it keeps changing for another reason).
const BURST_MAX: Duration = Duration::from_secs(3);
/// Consecutive reads with unchanged positions that end a burst once `BURST_MIN` has passed.
const SETTLED_READS: u32 = 4;
const DOCK_BUNDLE_ID: &str = "com.apple.dock";

/// The icon tile is this much narrower than the Dock item frame (62 -> 58).
const TILE_WIDTH_TRIM: f64 = 4.0;
/// The overlay PNG has a 140-unit canvas around a 100-unit tile (tile at offset 20), so the window is
/// 1.4x the tile, with 0.2x of it on every side. Keep in sync with DOCK_OVERLAY_TILE / DOCK_OVERLAY_CANVAS
/// in src/lib/dock-overlay-image.ts.
const CANVAS_MARGIN: f64 = 0.2;
/// One above the Dock's window level (kCGDockWindowLevel = 20), so the overlay draws over the icons.
const WINDOW_LEVEL: isize = 21;

// ---- Accessibility / CoreGraphics FFI ----

const AX_VALUE_CG_POINT: u32 = 1;
const AX_VALUE_CG_SIZE: u32 = 2;

#[repr(C)]
#[derive(Default)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Default)]
struct CgSize {
    width: f64,
    height: f64,
}

#[repr(C)]
struct CgRect {
    origin: CgPoint,
    size: CgSize,
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFStringRef, value: *mut CFTypeRef) -> i32;
    fn AXValueGetValue(value: CFTypeRef, kind: u32, out: *mut c_void) -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGMainDisplayID() -> u32;
    fn CGDisplayBounds(display: u32) -> CgRect;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFBundleGetIdentifier(bundle: *const c_void) -> CFStringRef;
}

/// Height of the primary screen in pt (the origin of AX coordinates is its top-left corner).
fn primary_screen_height() -> f64 {
    // SAFETY: plain CoreGraphics getters, thread-safe.
    unsafe { CGDisplayBounds(CGMainDisplayID()).size.height }
}

/// Whether the app may use the Accessibility API. `prompt` makes macOS show its permission dialog.
fn is_trusted(prompt: bool) -> bool {
    // SAFETY: `kAXTrustedCheckOptionPrompt` is a constant CFString living for the whole process; the
    // options dictionary (or NULL) is valid for the duration of the call.
    unsafe {
        if prompt {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const c_void)
        } else {
            AXIsProcessTrustedWithOptions(std::ptr::null())
        }
    }
}

/// An Accessibility attribute of `element`, `None` when it does not exist or the read failed.
fn copy_attribute(element: &CFType, name: &str) -> Option<CFType> {
    let key = CFString::new(name);
    let mut out: CFTypeRef = std::ptr::null();
    // SAFETY: `element` and `key` are live CF objects; `out` is a valid out pointer. On success the value
    // is owned by us (Copy rule), so it is wrapped under the create rule.
    unsafe {
        let error = AXUIElementCopyAttributeValue(element.as_CFTypeRef(), key.as_concrete_TypeRef(), &mut out);
        if error != 0 || out.is_null() {
            return None;
        }
        Some(CFType::wrap_under_create_rule(out))
    }
}

fn string_attribute(element: &CFType, name: &str) -> Option<String> {
    copy_attribute(element, name)?.downcast_into::<CFString>().map(|s| s.to_string())
}

fn children(element: &CFType) -> Option<Vec<CFType>> {
    let value = copy_attribute(element, "AXChildren")?;
    if value.type_of() != CFArray::<CFType>::type_id() {
        return None;
    }
    // SAFETY: the type id was just checked, so the object really is a CFArray; the Get rule retains it.
    let array = unsafe { CFArray::<CFType>::wrap_under_get_rule(value.as_CFTypeRef() as CFArrayRef) };
    Some((0..array.len()).filter_map(|i| array.get(i).map(|item| item.clone())).collect())
}

/// Reads an AXValue holding a CGPoint / CGSize (`kind` 1 / 2) into `out`.
fn ax_value<T>(element: &CFType, name: &str, kind: u32, out: &mut T) -> bool {
    let Some(value) = copy_attribute(element, name) else { return false };
    // SAFETY: `value` is a live AXValue and `out` points to a #[repr(C)] struct of the size `kind` asks for.
    unsafe { AXValueGetValue(value.as_CFTypeRef(), kind, out as *mut T as *mut c_void) }
}

/// Bundle id of the app a Dock item points to (`None` for folders, separators, the Trash...).
fn item_bundle_id(item: &CFType) -> Option<String> {
    let url = copy_attribute(item, "AXURL")?.downcast_into::<CFURL>()?;
    let bundle = CFBundle::new(url)?;
    // SAFETY: `bundle` is a live CFBundle; the returned string follows the Get rule (not owned), so it is
    // retained by `wrap_under_get_rule`; NULL means "no identifier".
    let id = unsafe {
        let id = CFBundleGetIdentifier(bundle.as_concrete_TypeRef() as *const c_void);
        if id.is_null() {
            return None;
        }
        CFString::wrap_under_get_rule(id)
    };
    Some(id.to_string())
}

/// One app icon slot in the Dock, in AX coordinates (top-left origin of the primary screen, pt).
#[derive(Debug, Clone, PartialEq)]
struct DockItem {
    bundle_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    /// The tile's AX element: the same tile compares equal across reads (CFEqual).
    element: CFType,
    /// Whether the tile's app is running.
    running: bool,
    /// Claude account uuid of the process shown by this tile, when the app runs one copy per account.
    account: Option<String>,
}

/// Process id of the Dock, `None` when it is not running.
fn dock_pid() -> Option<i32> {
    use objc2_app_kit::NSRunningApplication;
    use objc2_foundation::NSString;

    let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(DOCK_BUNDLE_ID));
    apps.iter().next().map(|app| app.processIdentifier())
}

/// Reads the Dock's items. `None` when the Dock could not be read (not running, restarted, no permission).
fn read_items(pid: i32) -> Option<Vec<DockItem>> {
    // SAFETY: creates an AX element for the process; owned by us (Create rule). Never NULL for a pid.
    let app = unsafe {
        let ptr = AXUIElementCreateApplication(pid);
        if ptr.is_null() {
            return None;
        }
        CFType::wrap_under_create_rule(ptr)
    };
    let list = children(&app)?
        .into_iter()
        .find(|child| string_attribute(child, "AXRole").as_deref() == Some("AXList"))?;
    let mut items = Vec::new();
    for item in children(&list)? {
        let Some(bundle_id) = item_bundle_id(&item) else { continue };
        let (mut position, mut size) = (CgPoint::default(), CgSize::default());
        if !ax_value(&item, "AXPosition", AX_VALUE_CG_POINT, &mut position)
            || !ax_value(&item, "AXSize", AX_VALUE_CG_SIZE, &mut size)
        {
            continue;
        }
        let running = copy_attribute(&item, "AXIsApplicationRunning")
            .and_then(|value| value.downcast_into::<CFBoolean>())
            .is_some_and(bool::from);
        items.push(DockItem {
            bundle_id,
            x: position.x,
            y: position.y,
            w: size.width,
            h: size.height,
            element: item.clone(),
            running,
            account: None,
        });
    }
    Some(items)
}

// ---- Geometry (pure) ----

/// `(x, y, side)`: the icon tile inside a Dock item frame, AX coordinates. The tile is 4pt narrower than the
/// frame, centered horizontally, and centered vertically too (measured on screen: tilesize 58 → item frame 62 x 78, tile 58 x 58).
fn icon_tile(x: f64, y: f64, w: f64, h: f64) -> (f64, f64, f64) {
    let side = w - TILE_WIDTH_TRIM;
    (x + (w - side) / 2.0, y + (h - side) / 2.0, side)
}

/// `(x, y, size)`: the overlay window around a tile (AX coordinates): the PNG canvas is 1.4x the tile.
fn overlay_frame(tile: (f64, f64, f64)) -> (f64, f64, f64) {
    let (x, y, side) = tile;
    let margin = side * CANVAS_MARGIN;
    (x - margin, y - margin, side * (1.0 + 2.0 * CANVAS_MARGIN))
}

/// AX y (top-left origin) to Cocoa y (bottom-left origin) of a rect `height` tall.
fn to_cocoa_y(ax_y: f64, height: f64, primary_screen_height: f64) -> f64 {
    primary_screen_height - ax_y - height
}

/// Which Dock tile an overlay goes on.
#[derive(Debug, Clone, PartialEq)]
enum Want {
    /// The first free tile of the app.
    AnyTile,
    /// Only the tile whose process is signed in to this Claude account uuid.
    Account(String),
    /// Nowhere (its account could not be resolved).
    Skip,
}

/// The first unused Dock item with a bundle id the overlay lists (and, for `account`, signed in to it).
fn first_free(items: &[DockItem], used: &[bool], overlay: &DockOverlay, account: Option<&str>) -> Option<usize> {
    items.iter().enumerate().find_map(|(i, item)| {
        let fits = !used[i]
            && overlay.bundle_ids.contains(&item.bundle_id)
            && account.is_none_or(|uuid| item.account.as_deref() == Some(uuid));
        fits.then_some(i)
    })
}

/// For each overlay, the Dock item it goes on (an item serves one overlay at most): `((x, y, size), overlay index)`
/// in AX coordinates. Overlays for an account go first, each on the tile signed in to it; then the others take
/// the first free tile of their app.
fn match_overlays(items: &[DockItem], overlays: &[DockOverlay], wants: &[Want]) -> Vec<((f64, f64, f64), usize)> {
    let mut used = vec![false; items.len()];
    let mut matched = Vec::new();
    // Pass 1: account overlays; pass 2: the others.
    for account_pass in [true, false] {
        for (index, (overlay, want)) in overlays.iter().zip(wants).enumerate() {
            let account = match want {
                Want::Account(uuid) if account_pass => Some(uuid.as_str()),
                Want::AnyTile if !account_pass => None,
                _ => continue,
            };
            if let Some(i) = first_free(items, &used, overlay, account) {
                used[i] = true;
                let item = &items[i];
                matched.push((overlay_frame(icon_tile(item.x, item.y, item.w, item.h)), index));
            }
        }
    }
    matched
}

/// Decodes a base64 PNG; empty (and a warning) when it is not valid base64.
fn decode_png(base64: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(base64.trim()).unwrap_or_else(|_| {
        log::warn!("dock overlay image is not valid base64");
        Vec::new()
    })
}

// ---- Background loop ----

/// One window to show, in Cocoa coordinates.
#[derive(Debug, Clone, PartialEq)]
struct Target {
    x: f64,
    y: f64,
    size: f64,
    png: Vec<u8>,
}

/// A fast-polling burst after an app launched or quit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Burst {
    started: Instant,
    /// Consecutive reads since the last one that differed from its predecessor.
    stable: u32,
}

/// The burst after a tick that read the Dock (`changed`: its item frames differ from the previous read):
/// `None` once it is over, i.e. at `BURST_MAX`, or once `BURST_MIN` has passed and the last `SETTLED_READS`
/// reads were identical.
fn burst_after_tick(burst: Burst, changed: bool, now: Instant) -> Option<Burst> {
    let stable = if changed { 0 } else { burst.stable + 1 };
    let elapsed = now.saturating_duration_since(burst.started);
    if elapsed >= BURST_MAX || (elapsed >= BURST_MIN && stable >= SETTLED_READS) {
        return None;
    }
    Some(Burst { stable, ..burst })
}

/// How long the loop waits for a wake before reading the Dock again: fast while a burst is running.
fn next_wait(burst: Option<&Burst>) -> Duration {
    if burst.is_some() {
        BURST_TICK
    } else {
        IDLE_TICK
    }
}

pub fn start(app: AppHandle) {
    let (tx, rx) = mpsc::channel();
    if WAKE.set(tx.clone()).is_err() {
        return;
    }
    let loop_app = app.clone();
    let spawned = std::thread::Builder::new().name("dock-overlay".into()).spawn(move || {
        let mut worker = Worker::default();
        let mut burst: Option<Burst> = None;
        loop {
            let changed = worker.tick(&loop_app);
            burst = burst.and_then(|b| burst_after_tick(b, changed, Instant::now()));
            match rx.recv_timeout(next_wait(burst.as_ref())) {
                Ok(Wake::Burst) => burst = Some(Burst { started: Instant::now(), stable: 0 }),
                Ok(Wake::Payload) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
    if let Err(error) = spawned {
        log::warn!("failed to start dock overlay thread: {error}");
        return;
    }
    if let Err(error) = app.run_on_main_thread(move || observe_app_launches(tx)) {
        log::warn!("failed to register dock launch/quit observers: {error}");
    }
}

/// The payload changed: re-evaluate now instead of at the next tick.
pub fn notify() {
    if let Some(tx) = WAKE.get() {
        let _ = tx.send(Wake::Payload);
    }
}

/// Starts a fast-polling burst whenever an app launches or quits (the Dock adds/removes/shifts icons then).
/// Main thread only.
fn observe_app_launches(tx: mpsc::Sender<Wake>) {
    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification,
    };
    use objc2_foundation::NSNotification;
    use std::ptr::NonNull;

    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: the notification names are constant NSStrings that live for the whole process.
    let names = unsafe { [NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification] };
    for name in names {
        let tx = tx.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let _ = tx.send(Wake::Burst);
        });
        // SAFETY: `name` is a valid notification name; no object filter and no queue means the block runs on
        // the posting thread (the main one for NSWorkspace). The center copies the block, and the block only
        // owns a Sender, which is Send.
        let token = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) };
        // The observer must outlive the app: leak the token instead of ever removing it.
        std::mem::forget(token);
    }
}

#[derive(Default)]
struct Worker {
    pid: Option<i32>,
    prompted: bool,
    warned_untrusted: bool,
    warned_unreadable: bool,
    /// Overlays seen last and their decoded PNGs (same order); decoding only repeats when they change.
    overlays: Vec<DockOverlay>,
    pngs: Vec<Vec<u8>>,
    /// Which tile each overlay goes on (same order as `overlays`).
    wants: Vec<Want>,
    /// OpenUsage account id -> Claude account uuid; looked up once per id (the keychain read is slow).
    account_uuids: HashMap<String, String>,
    /// Tile <-> process pairs of each app copy-per-account, by bundle id.
    owners: HashMap<String, super::dock_owners::Owners<CFType>>,
    /// What the main thread was last told to show (empty = nothing).
    last: Vec<Target>,
    /// Frames (x, y, size) of the targets of the previous successful read, to tell when the Dock moved.
    last_read: Option<Vec<(f64, f64, f64)>>,
}

impl Worker {
    /// Re-reads the Dock and updates the overlay windows. Returns whether the Dock item frames read now differ
    /// from the previous read; an unreadable Dock counts as changed (so a burst does not end on errors), and
    /// with no overlays nothing is read, so nothing changed.
    fn tick(&mut self, app: &AppHandle) -> bool {
        let overlays = super::lock_state()
            .payload
            .as_ref()
            .and_then(|payload| payload.dock_overlays.clone())
            .unwrap_or_default();
        let (targets, changed) = if overlays.is_empty() {
            self.last_read = None;
            (Vec::new(), false)
        } else {
            self.sync_pngs(overlays);
            let Some(targets) = self.read_targets() else {
                self.last_read = None;
                return true;
            };
            let frames: Vec<_> = targets.iter().map(|t| (t.x, t.y, t.size)).collect();
            let changed = self.last_read.as_ref() != Some(&frames);
            self.last_read = Some(frames);
            (targets, changed)
        };
        if targets != self.last {
            self.last = targets.clone();
            if let Err(error) = app.run_on_main_thread(move || apply(&targets)) {
                log::warn!("failed to dispatch dock overlay update: {error}");
            }
        }
        changed
    }

    fn sync_pngs(&mut self, overlays: Vec<DockOverlay>) {
        if overlays == self.overlays {
            return;
        }
        self.pngs = overlays.iter().map(|overlay| decode_png(&overlay.png)).collect();
        for id in overlays.iter().filter_map(|overlay| overlay.account_id.as_ref()) {
            if self.account_uuids.contains_key(id) {
                continue;
            }
            // Failures are not cached: retried when the overlays change (e.g. after signing in again).
            match crate::accounts::claude_account_uuid(id) {
                Ok(uuid) => {
                    self.account_uuids.insert(id.clone(), uuid);
                }
                Err(error) => log::warn!("dock overlay: no Claude account for {id}: {error}"),
            }
        }
        self.wants = overlays
            .iter()
            .map(|overlay| match &overlay.account_id {
                None => Want::AnyTile,
                Some(id) => self.account_uuids.get(id).map_or(Want::Skip, |uuid| Want::Account(uuid.clone())),
            })
            .collect();
        self.overlays = overlays;
    }

    /// Fills `account` of the tiles of apps that have overlays for an account: pairs the running tiles with the
    /// app's processes and reads each process's signed-in Claude account.
    fn resolve_accounts(&mut self, items: &mut [DockItem]) {
        let mut bundles: Vec<&str> = Vec::new();
        for (overlay, want) in self.overlays.iter().zip(&self.wants) {
            if matches!(want, Want::Account(_)) {
                bundles.extend(overlay.bundle_ids.iter().map(String::as_str));
            }
        }
        bundles.sort_unstable();
        bundles.dedup();
        for bundle in bundles {
            let indices: Vec<usize> = (0..items.len())
                .filter(|&i| items[i].bundle_id == bundle && items[i].running)
                .collect();
            let tiles: Vec<CFType> = indices.iter().map(|&i| items[i].element.clone()).collect();
            let pids = super::dock_owners::app_pids(bundle);
            let owners = self.owners.entry(bundle.to_string()).or_default().update(&tiles, &pids);
            for (&i, pid) in indices.iter().zip(owners) {
                items[i].account = pid.and_then(super::dock_owners::process_account);
            }
        }
    }

    /// Windows to show now; `None` to leave the current ones untouched (no permission, Dock unreadable).
    fn read_targets(&mut self) -> Option<Vec<Target>> {
        // The first time overlays exist, macOS asks for the Accessibility permission.
        let trusted = is_trusted(!self.prompted);
        self.prompted = true;
        if !trusted {
            if !self.warned_untrusted {
                log::warn!("dock overlays need the Accessibility permission (System Settings > Privacy & Security)");
                self.warned_untrusted = true;
            }
            return None;
        }
        self.warned_untrusted = false;

        let items = self.pid.or_else(dock_pid).and_then(|pid| {
            self.pid = Some(pid);
            read_items(pid)
        });
        let Some(mut items) = items else {
            self.pid = None; // the Dock restarted or is gone: look it up again next time
            if !self.warned_unreadable {
                log::warn!("could not read the Dock items");
                self.warned_unreadable = true;
            }
            return None;
        };
        self.warned_unreadable = false;

        let screen_height = primary_screen_height();
        self.resolve_accounts(&mut items);
        let targets = match_overlays(&items, &self.overlays, &self.wants)
            .into_iter()
            .filter(|(_, index)| !self.pngs[*index].is_empty())
            .map(|((x, y, size), index)| Target {
                x,
                y: to_cocoa_y(y, size, screen_height),
                size,
                png: self.pngs[index].clone(),
            })
            .collect();
        Some(targets)
    }
}

// ---- Windows (main thread only) ----

struct OverlayWindow {
    panel: objc2::rc::Retained<objc2_app_kit::NSPanel>,
    view: objc2::rc::Retained<objc2_app_kit::NSImageView>,
}

thread_local! {
    /// The overlay windows, reused across applies. Only touched on the main thread (`apply` runs there).
    static WINDOWS: RefCell<Vec<OverlayWindow>> = const { RefCell::new(Vec::new()) };
}

/// Shows one window per target and hides the rest. Main thread only.
fn apply(targets: &[Target]) {
    use objc2::MainThreadMarker;

    let Some(mtm) = MainThreadMarker::new() else { return };
    WINDOWS.with(|cell| {
        let mut windows = cell.borrow_mut();
        while windows.len() < targets.len() {
            windows.push(new_window(mtm));
        }
        for extra in windows.drain(targets.len()..) {
            extra.panel.orderOut(None);
        }
        for (window, target) in windows.iter().zip(targets) {
            show(window, target);
        }
    });
}

fn show(window: &OverlayWindow, target: &Target) {
    use objc2::AnyThread;
    use objc2_app_kit::NSImage;
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize};

    let data = NSData::with_bytes(&target.png);
    match NSImage::initWithData(NSImage::alloc(), &data) {
        Some(image) => window.view.setImage(Some(&image)),
        None => {
            log::warn!("invalid dock overlay image");
            window.panel.orderOut(None);
            return;
        }
    }
    let frame = NSRect::new(NSPoint::new(target.x, target.y), NSSize::new(target.size, target.size));
    window.panel.setFrame_display(frame, true);
    window.panel.orderFrontRegardless();
}

/// A transparent, borderless, click-through panel above the Dock with an image view as content.
fn new_window(mtm: objc2::MainThreadMarker) -> OverlayWindow {
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSBackingStoreType, NSColor, NSImageScaling, NSImageView, NSPanel,
        NSWindowCollectionBehavior, NSWindowStyleMask,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        mtm.alloc(),
        rect,
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    // SAFETY: plain setter; the window stays owned by `WINDOWS` (we release it ourselves, not on close).
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setLevel(WINDOW_LEVEL);
    // Not FullScreenAuxiliary: in full-screen apps the Dock is hidden, so the overlay must not show there.
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenNone,
    );

    let view = NSImageView::initWithFrame(mtm.alloc(), rect);
    view.setEditable(false);
    view.setImageScaling(NSImageScaling::ScaleProportionallyUpOrDown);
    view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    panel.setContentView(Some(&view));
    OverlayWindow { panel, view }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(bundle_id: &str, x: f64) -> DockItem {
        DockItem {
            bundle_id: bundle_id.into(),
            x,
            y: 800.0,
            w: 62.0,
            h: 78.0,
            element: CFString::new(&format!("{bundle_id}@{x}")).as_CFType(),
            running: true,
            account: None,
        }
    }

    fn account_item(bundle_id: &str, x: f64, account: &str) -> DockItem {
        DockItem { account: Some(account.into()), ..item(bundle_id, x) }
    }

    fn overlay(ids: &[&str]) -> DockOverlay {
        DockOverlay { bundle_ids: ids.iter().map(|id| id.to_string()).collect(), png: String::new(), account_id: None }
    }

    fn any(count: usize) -> Vec<Want> {
        vec![Want::AnyTile; count]
    }

    fn account(uuid: &str) -> Want {
        Want::Account(uuid.into())
    }

    /// `(overlay index, frame x)` of the placed overlays, sorted by overlay index.
    fn placed(matched: &[((f64, f64, f64), usize)]) -> Vec<(usize, f64)> {
        let mut out: Vec<_> = matched.iter().map(|((x, _, _), index)| (*index, *x)).collect();
        out.sort_by_key(|(index, _)| *index);
        out
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn tile_is_4pt_narrower_and_centered() {
        assert_eq!(icon_tile(100.0, 800.0, 62.0, 78.0), (102.0, 810.0, 58.0));
    }

    #[test]
    fn overlay_frame_expands_by_a_fifth_of_the_tile_per_side() {
        let (x, y, size) = overlay_frame((102.0, 804.0, 100.0));
        assert!(close(x, 82.0) && close(y, 784.0) && close(size, 140.0));
    }

    #[test]
    fn cocoa_y_flips_around_the_primary_screen() {
        assert_eq!(to_cocoa_y(0.0, 100.0, 900.0), 800.0);
        assert_eq!(to_cocoa_y(800.0, 100.0, 900.0), 0.0);
    }

    #[test]
    fn overlays_match_the_first_listed_item() {
        let items = [item("a", 0.0), item("b", 100.0), item("b2", 200.0)];
        let overlays = [overlay(&["b2", "b"]), overlay(&["a"])];
        let matched = match_overlays(&items, &overlays, &any(2));
        assert_eq!(matched.len(), 2);
        assert_eq!(matched[0].1, 0);
        assert!(close(matched[0].0.0, overlay_frame(icon_tile(100.0, 800.0, 62.0, 78.0)).0));
        assert_eq!(matched[1].1, 1);
        assert!(close(matched[1].0.0, overlay_frame(icon_tile(0.0, 800.0, 62.0, 78.0)).0));
    }

    #[test]
    fn an_item_serves_one_overlay_only() {
        let items = [item("a", 0.0), item("a", 100.0)];
        let overlays = [overlay(&["a"]), overlay(&["a"]), overlay(&["a"])];
        let matched = match_overlays(&items, &overlays, &any(3));
        assert_eq!(matched.iter().map(|m| m.1).collect::<Vec<_>>(), vec![0, 1]);
    }

    #[test]
    fn unmatched_overlays_are_skipped() {
        assert!(match_overlays(&[item("a", 0.0)], &[overlay(&["zzz"])], &any(1)).is_empty());
        assert!(match_overlays(&[], &[overlay(&["a"])], &any(1)).is_empty());
    }

    /// x of the overlay frame for a tile placed at item x `x`.
    fn frame_x(x: f64) -> f64 {
        overlay_frame(icon_tile(x, 800.0, 62.0, 78.0)).0
    }

    #[test]
    fn account_overlays_go_on_the_tile_signed_in_to_the_account() {
        let items = [account_item("c", 0.0, "u2"), account_item("c", 100.0, "u1")];
        let overlays = [overlay(&["c"]), overlay(&["c"])];
        let matched = match_overlays(&items, &overlays, &[account("u1"), account("u2")]);
        let by_index = placed(&matched);
        assert_eq!(by_index.len(), 2);
        assert!(close(by_index[0].1, frame_x(100.0)));
        assert!(close(by_index[1].1, frame_x(0.0)));
    }

    #[test]
    fn an_account_overlay_without_a_tile_of_that_account_is_not_placed() {
        let items = [account_item("c", 0.0, "u2"), item("c", 100.0)];
        assert!(match_overlays(&items, &[overlay(&["c"])], &[account("u1")]).is_empty());
    }

    #[test]
    fn skipped_overlays_are_not_placed() {
        assert!(match_overlays(&[item("a", 0.0)], &[overlay(&["a"])], &[Want::Skip]).is_empty());
    }

    #[test]
    fn an_account_overlay_listed_after_an_any_overlay_still_gets_its_tile() {
        let items = [account_item("c", 0.0, "u1"), account_item("c", 100.0, "u2")];
        let overlays = [overlay(&["c"]), overlay(&["c"])];
        let matched = match_overlays(&items, &overlays, &[Want::AnyTile, account("u1")]);
        let by_index = placed(&matched);
        assert_eq!(by_index.len(), 2);
        assert!(close(by_index[0].1, frame_x(100.0)));
        assert!(close(by_index[1].1, frame_x(0.0)));
    }

    fn burst_at(started: Instant) -> Burst {
        Burst { started, stable: 0 }
    }

    /// Feeds `changed` flags to a burst, one tick every `BURST_TICK`; returns the tick count it ended on.
    fn run(started: Instant, changes: impl Fn(u32) -> bool, max_ticks: u32) -> Option<u32> {
        let mut burst = burst_at(started);
        for n in 1..=max_ticks {
            let now = started + BURST_TICK * n;
            match burst_after_tick(burst, changes(n), now) {
                Some(next) => burst = next,
                None => return Some(n),
            }
        }
        None
    }

    #[test]
    fn polls_slowly_when_idle() {
        assert_eq!(next_wait(None), IDLE_TICK);
    }

    #[test]
    fn polls_fast_during_a_burst() {
        assert_eq!(next_wait(Some(&burst_at(Instant::now()))), BURST_TICK);
    }

    #[test]
    fn burst_stays_fast_before_the_minimum_even_when_stable() {
        let start = Instant::now();
        let mut burst = Burst { started: start, stable: SETTLED_READS + 10 };
        burst = burst_after_tick(burst, false, start + BURST_MIN - Duration::from_millis(1)).expect("still running");
        assert_eq!(burst.stable, SETTLED_READS + 11);
        assert!(burst_after_tick(burst, false, start + BURST_MIN).is_none());
    }

    #[test]
    fn burst_ends_after_enough_stable_reads_past_the_minimum() {
        let start = Instant::now();
        // Already stable for a while when the minimum passes: the next unchanged read ends it.
        let burst = Burst { started: start, stable: SETTLED_READS - 1 };
        assert!(burst_after_tick(burst, false, start + BURST_MIN).is_none());
        // One short of SETTLED_READS stable reads keeps going.
        let burst = Burst { started: start, stable: SETTLED_READS - 2 };
        let burst = burst_after_tick(burst, false, start + BURST_MIN).expect("still running");
        assert_eq!(burst.stable, SETTLED_READS - 1);
        // Never-changing reads from the start end at the first tick past BURST_MIN with enough stable reads.
        let ended = run(start, |_| false, 1000).expect("ends");
        assert!(BURST_TICK * ended >= BURST_MIN);
        assert!(BURST_TICK * (ended - 1) < BURST_MIN);
    }

    #[test]
    fn burst_keeps_going_while_positions_change_and_restarts_the_count() {
        let start = Instant::now();
        // Changes until 1s, stable afterwards: ends SETTLED_READS ticks after the last change.
        let last_change = (Duration::from_secs(1).as_millis() / BURST_TICK.as_millis()) as u32;
        let ended = run(start, |n| n <= last_change, 1000).expect("ends");
        assert_eq!(ended, last_change + SETTLED_READS);
        // A change resets the counter.
        let burst = Burst { started: start, stable: SETTLED_READS - 1 };
        let burst = burst_after_tick(burst, true, start + BURST_MIN * 2).expect("still running");
        assert_eq!(burst.stable, 0);
    }

    #[test]
    fn burst_ends_at_the_cap_even_if_positions_keep_changing() {
        let start = Instant::now();
        let burst = Burst { started: start, stable: 0 };
        assert!(burst_after_tick(burst, true, start + BURST_MAX - Duration::from_millis(1)).is_some());
        assert!(burst_after_tick(burst, true, start + BURST_MAX).is_none());
        let ended = run(start, |_| true, 1000).expect("ends");
        assert_eq!(BURST_TICK * ended, BURST_MAX);
    }
}
