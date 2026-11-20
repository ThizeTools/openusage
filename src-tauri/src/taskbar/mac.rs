//! macOS equivalent of the taskbar widget. The frontend renders the widget
//! (brand icon + stacked label/value lines) to a PNG that becomes the tray
//! icon; without it we fall back to the values as plain tray title text.

use super::{TaskbarBackdrop, TaskbarPayload};
use base64::Engine;
use std::cell::RefCell;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static LAST_APPLIED: Mutex<Option<Display>> = Mutex::new(None);
/// Last menu bar appearance seen (`true` = dark); `None` until it could be read once.
static LAST_APPEARANCE: Mutex<Option<bool>> = Mutex::new(None);

/// Event carrying "dark" / "light" whenever the menu bar appearance changes.
const APPEARANCE_EVENT: &str = "menubar:appearance";
/// How often the (cheap) appearance check runs.
const APPEARANCE_POLL: Duration = Duration::from_secs(3);
/// Longest wait for the main thread when the frontend asks for the appearance.
const APPEARANCE_QUERY_TIMEOUT: Duration = Duration::from_millis(1500);

/// What the menu bar item should show.
#[derive(Debug, Clone, PartialEq)]
enum Display {
    /// Default gauge template icon, no title.
    Default,
    /// Pre-rendered widget PNG (not a template, keeps its colors), with an optional native blur under it.
    Image { png: Vec<u8>, backdrop: Option<Backdrop> },
    /// Default gauge template icon plus title text.
    Title(String),
}

pub fn start(app: AppHandle) {
    let _ = APP.set(app.clone());
    notify();
    start_appearance_timer(app);
}

/// Name of the appearance the menu bar uses, as the event/command payload.
fn appearance_label(dark: bool) -> &'static str {
    if dark {
        "dark"
    } else {
        "light"
    }
}

/// Pure mapping: the name `bestMatchFromAppearancesWithNames` picked → dark?
/// `None` when nothing matched (unknown).
fn is_dark_appearance_name(name: Option<&str>, dark_name: &str) -> Option<bool> {
    name.map(|name| name == dark_name)
}

/// Appearance of the status bar button (dark = menu bar drawn dark). Main thread only.
/// On recent macOS the menu bar look follows the wallpaper, not just the system theme,
/// and the button's `effectiveAppearance` reflects what the bar actually shows.
fn read_menu_bar_dark(app: &AppHandle) -> Option<bool> {
    use objc2::MainThreadMarker;

    let tray = app.tray_by_id("tray")?;
    tray.with_inner_tray_icon(|inner| {
        let mtm = MainThreadMarker::new()?;
        let item = inner.ns_status_item()?;
        let button = item.button(mtm)?;
        button_is_dark(&button)
    })
    .ok()
    .flatten()
}

/// Whether the status bar button is drawn with the dark appearance. Main thread only.
fn button_is_dark(button: &objc2_app_kit::NSStatusBarButton) -> Option<bool> {
    use objc2_app_kit::{NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua};
    use objc2_foundation::NSArray;

    let appearance = button.effectiveAppearance();
    // SAFETY: the appearance name statics are valid for the whole process lifetime.
    let (aqua, dark_aqua) = unsafe { (NSAppearanceNameAqua, NSAppearanceNameDarkAqua) };
    let names = NSArray::from_slice(&[aqua, dark_aqua]);
    let best = appearance.bestMatchFromAppearancesWithNames(&names);
    let best = best.map(|name| name.to_string());
    is_dark_appearance_name(best.as_deref(), &dark_aqua.to_string())
}

/// Reads the appearance and emits `menubar:appearance` when it differs from the cached one.
/// Main thread only.
fn check_appearance(app: &AppHandle) {
    let Some(dark) = read_menu_bar_dark(app) else { return };
    let changed = {
        let mut last = LAST_APPEARANCE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let changed = *last != Some(dark);
        *last = Some(dark);
        changed
    };
    if changed {
        if let Err(error) = app.emit(APPEARANCE_EVENT, appearance_label(dark)) {
            log::warn!("failed to emit menu bar appearance: {error}");
        }
    }
}

/// Re-checks the appearance on the main thread (cheap: compares against the cached value).
pub fn refresh_appearance() {
    let Some(app) = APP.get() else { return };
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || check_appearance(&handle)) {
        log::warn!("failed to dispatch menu bar appearance check: {error}");
    }
}

/// Wallpaper or system changes have no dependable notification for the status bar,
/// so a light timer re-checks every few seconds.
fn start_appearance_timer(app: AppHandle) {
    let spawned = std::thread::Builder::new().name("menubar-appearance".into()).spawn(move || loop {
        std::thread::sleep(APPEARANCE_POLL);
        let handle = app.clone();
        if app.run_on_main_thread(move || check_appearance(&handle)).is_err() {
            break;
        }
    });
    if let Err(error) = spawned {
        log::warn!("failed to start menu bar appearance timer: {error}");
    }
}

/// "dark" / "light" for the real menu bar, `None` when it cannot be read yet.
/// Reads on the main thread, so call it from an async command, never from the main thread.
pub fn query_appearance(app: &AppHandle) -> Option<&'static str> {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    let dispatched = app.run_on_main_thread(move || {
        check_appearance(&handle);
        let _ = tx.send(());
    });
    if dispatched.is_ok() {
        let _ = rx.recv_timeout(APPEARANCE_QUERY_TIMEOUT);
    }
    let cached = *LAST_APPEARANCE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    cached.map(appearance_label)
}

pub fn notify() {
    let Some(app) = APP.get() else { return };
    let display = {
        let state = super::lock_state();
        menu_bar_display(state.enabled, state.payload.as_ref())
    };
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || apply(&handle, display)) {
        log::warn!("failed to dispatch menu bar update: {error}");
    }
}

fn apply(app: &AppHandle, display: Display) {
    let mut last = LAST_APPLIED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if last.as_ref() == Some(&display) {
        drop(last);
        check_appearance(app);
        return;
    }
    let Some(tray) = app.tray_by_id("tray") else { return };
    let result = match &display {
        Display::Image { png, backdrop } => match tauri::image::Image::from_bytes(png) {
            Ok(image) => tray
                .set_icon_with_as_template(Some(image), false)
                .and_then(|_| tray.set_title(None::<&str>))
                .map(|_| {
                    resize_status_image(&tray, png);
                    sync_backdrop(&tray, backdrop.as_ref());
                }),
            Err(error) => {
                log::warn!("invalid menu bar image: {error}");
                return;
            }
        },
        Display::Title(title) => set_default_icon(app, &tray)
            .and_then(|_| tray.set_title(Some(title.as_str())))
            .map(|_| sync_backdrop(&tray, None)),
        Display::Default => set_default_icon(app, &tray)
            .and_then(|_| tray.set_title(None::<&str>))
            .map(|_| sync_backdrop(&tray, None)),
    };
    match result {
        Ok(()) => *last = Some(display),
        Err(error) => log::warn!("failed to update menu bar item: {error}"),
    }
    // The new image may sit on a different bar look than the previous one.
    drop(last);
    check_appearance(app);
}

/// Height (pt) the widget image is shown at. tray-icon forces 18pt, but the
/// status bar is 24pt tall, so we enlarge the image after it was set.
const MENU_BAR_IMAGE_HEIGHT: f64 = 22.0;

/// Width and height in pixels from a PNG's IHDR chunk.
fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if png.len() < 24 || png[..8] != SIGNATURE || &png[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(png[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(png[20..24].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

/// Point size of the widget image at `MENU_BAR_IMAGE_HEIGHT`, keeping the aspect ratio.
fn status_image_size(px_width: u32, px_height: u32) -> (f64, f64) {
    (px_width as f64 * MENU_BAR_IMAGE_HEIGHT / px_height as f64, MENU_BAR_IMAGE_HEIGHT)
}

/// Resizes the status item's NSImage (set by tray-icon at 18pt) to 22pt tall.
/// Must run on the main thread (`apply` does).
fn resize_status_image(tray: &tauri::tray::TrayIcon, png: &[u8]) {
    use objc2::MainThreadMarker;
    use objc2_foundation::NSSize;

    let Some((px_w, px_h)) = png_dimensions(png) else { return };
    let (width, height) = status_image_size(px_w, px_h);
    let result = tray.with_inner_tray_icon(move |inner| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(item) = inner.ns_status_item() else { return };
        let Some(button) = item.button(mtm) else { return };
        let Some(image) = button.image() else { return };
        image.setSize(NSSize::new(width, height));
    });
    if let Err(error) = result {
        log::warn!("failed to resize menu bar image: {error}");
    }
}

/// Native blur under the widget image, validated (see `backdrop_from_payload`).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Backdrop {
    /// 0 < blur <= 1: alpha of the blur view.
    blur: f64,
    /// Corner radius in pt (>= 0).
    radius: f64,
    /// Image size in pt (> 0).
    width: f64,
    height: f64,
}

/// Pure decision: a blur is only drawn for a strength above 0 and a usable image size.
/// Anything else (disabled background, blur 0, non-finite numbers) means "no blur view".
fn backdrop_from_payload(backdrop: Option<&TaskbarBackdrop>) -> Option<Backdrop> {
    let b = backdrop?;
    let finite = [b.blur, b.radius, b.width_pt, b.height_pt].iter().all(|v| v.is_finite());
    if !finite || b.blur <= 0.0 || b.width_pt <= 0.0 || b.height_pt <= 0.0 {
        return None;
    }
    Some(Backdrop {
        blur: b.blur.min(1.0),
        radius: b.radius.max(0.0),
        width: b.width_pt,
        height: b.height_pt,
    })
}

/// Frame `(x, y, width, height)` of the image inside the button: centered on both axes
/// (the button draws its image centered; extra width/height is padding).
fn centered_rect(container_width: f64, container_height: f64, width: f64, height: f64) -> (f64, f64, f64, f64) {
    ((container_width - width) / 2.0, (container_height - height) / 2.0, width, height)
}

/// Blur view and image view added to the status bar button for a backdrop.
struct BackdropViews {
    effect: objc2::rc::Retained<objc2_app_kit::NSVisualEffectView>,
    image: objc2::rc::Retained<objc2_app_kit::NSImageView>,
}

thread_local! {
    /// The views of the current backdrop. Only touched on the main thread (`apply` runs there),
    /// so later applies update them instead of adding duplicates.
    static BACKDROP_VIEWS: RefCell<Option<BackdropViews>> = const { RefCell::new(None) };
}

/// Shows the native blur under the widget image for `Some`, removes it for `None`.
/// Must run on the main thread, after the button got its image (`apply` does).
fn sync_backdrop(tray: &tauri::tray::TrayIcon, backdrop: Option<&Backdrop>) {
    use objc2::MainThreadMarker;

    let backdrop = backdrop.copied();
    let result = tray.with_inner_tray_icon(move |inner| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(item) = inner.ns_status_item() else { return };
        let Some(button) = item.button(mtm) else { return };
        BACKDROP_VIEWS.with(|cell| {
            let mut slot = cell.borrow_mut();
            match backdrop {
                Some(backdrop) => install_backdrop(mtm, &button, &mut slot, &backdrop),
                None => remove_backdrop(&mut slot),
            }
        });
    });
    if let Err(error) = result {
        log::warn!("failed to update menu bar backdrop: {error}");
    }
}

fn remove_backdrop(slot: &mut Option<BackdropViews>) {
    if let Some(views) = slot.take() {
        views.image.removeFromSuperview();
        views.effect.removeFromSuperview();
    }
}

/// Draws the widget as `[blur view][image view]` inside the button and blanks the button's own image
/// (same size, so the status item keeps its width). The button draws its image under every subview, so the
/// blur could not sit below it otherwise. Both views go under tray-icon's click target (the topmost subview),
/// which keeps receiving the mouse events.
fn install_backdrop(
    mtm: objc2::MainThreadMarker,
    button: &objc2_app_kit::NSStatusBarButton,
    slot: &mut Option<BackdropViews>,
    backdrop: &Backdrop,
) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2::runtime::Bool;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSImage, NSImageView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
    };
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let size = NSSize::new(backdrop.width, backdrop.height);
    // The image tray-icon set (already resized to the widget size); it moves into the image view.
    let real = button.image().filter(|image| image.size().width > 0.0 && image.size().height > 0.0);

    // Views left on a previous button (the status item was recreated) cannot be reused.
    let attached = slot.as_ref().is_some_and(|views| {
        // SAFETY: plain getter on a live view, main thread.
        let parent = unsafe { views.effect.superview() };
        parent.is_some_and(|parent| std::ptr::eq(&*parent, &**button as &objc2_app_kit::NSView))
    });
    if !attached {
        remove_backdrop(slot);
    }

    let bounds = button.bounds();
    let (x, y, w, h) = centered_rect(bounds.size.width, bounds.size.height, backdrop.width, backdrop.height);
    let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
    // Keeps the views centered (and at their size) if the button resizes later.
    let centered = NSAutoresizingMaskOptions::ViewMinXMargin
        | NSAutoresizingMaskOptions::ViewMaxXMargin
        | NSAutoresizingMaskOptions::ViewMinYMargin
        | NSAutoresizingMaskOptions::ViewMaxYMargin;

    if slot.is_none() {
        let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
        effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
        effect.setState(NSVisualEffectState::Active);
        effect.setWantsLayer(true);
        effect.setAutoresizingMask(centered);
        let image_view = NSImageView::initWithFrame(mtm.alloc(), frame);
        image_view.setEditable(false);
        image_view.setAutoresizingMask(centered);
        button.addSubview_positioned_relativeTo(&effect, NSWindowOrderingMode::Below, None);
        button.addSubview_positioned_relativeTo(&image_view, NSWindowOrderingMode::Above, Some(&effect));
        *slot = Some(BackdropViews { effect, image: image_view });
    }
    let Some(views) = slot.as_ref() else { return };

    let dark = button_is_dark(button).unwrap_or(true);
    views.effect.setMaterial(if dark { NSVisualEffectMaterial::HUDWindow } else { NSVisualEffectMaterial::Popover });
    views.effect.setFrame(frame);
    views.effect.setAlphaValue(backdrop.blur);
    views.image.setFrame(frame);
    // SAFETY: CALayer setters with the documented argument types (CGFloat, BOOL); the layer exists
    // because `setWantsLayer(true)` was called.
    unsafe {
        let layer: Option<objc2::rc::Retained<AnyObject>> = msg_send![&*views.effect, layer];
        if let Some(layer) = layer {
            let _: () = msg_send![&*layer, setCornerRadius: backdrop.radius];
            let _: () = msg_send![&*layer, setMasksToBounds: Bool::YES];
        }
    }

    if let Some(real) = real {
        real.setSize(size);
        views.image.setImage(Some(&real));
        // Blank placeholder of the same size: the button keeps its width but draws nothing.
        let blank = NSImage::initWithSize(NSImage::alloc(), size);
        button.setImage(Some(&blank));
    }
}

fn set_default_icon(app: &AppHandle, tray: &tauri::tray::TrayIcon) -> tauri::Result<()> {
    let icon = crate::tray::tray_icon(app)?;
    tray.set_icon_with_as_template(Some(icon), true)
}

/// Pure decision: widget image (with its native blur, when it asked for one) if the
/// frontend sent a valid one, else the plain text title, else the default icon.
fn menu_bar_display(enabled: bool, payload: Option<&TaskbarPayload>) -> Display {
    if !enabled {
        return Display::Default;
    }
    if let Some(image) = payload.and_then(|p| p.menu_bar_image.as_deref()) {
        match base64::engine::general_purpose::STANDARD.decode(image.trim()) {
            Ok(png) if !png.is_empty() => {
                let backdrop = payload.and_then(|p| backdrop_from_payload(p.menu_bar_backdrop.as_ref()));
                return Display::Image { png, backdrop };
            }
            _ => log::warn!("menu bar image is not valid base64"),
        }
    }
    match menu_bar_title(enabled, payload) {
        Some(title) => Display::Title(title),
        None => Display::Default,
    }
}

/// Values only (no labels, menu bar space is scarce): items joined with
/// " · " inside a provider, providers joined with two spaces.
fn menu_bar_title(enabled: bool, payload: Option<&TaskbarPayload>) -> Option<String> {
    if !enabled {
        return None;
    }
    let title = payload?
        .providers
        .iter()
        .map(|provider| {
            provider
                .items
                .iter()
                .map(|item| item.value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(" · ")
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("  ");
    (!title.is_empty()).then_some(title)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::taskbar::{TaskbarItem, TaskbarProvider};

    fn item(value: &str) -> TaskbarItem {
        TaskbarItem { label: "Label".into(), value: value.into(), tone: "neutral".into() }
    }

    fn provider(values: &[&str]) -> TaskbarProvider {
        TaskbarProvider { brand_color: None, icon_mask: None, items: values.iter().map(|v| item(v)).collect() }
    }

    fn payload(providers: Vec<TaskbarProvider>) -> TaskbarPayload {
        TaskbarPayload { providers, tooltip: String::new(), menu_bar_image: None, menu_bar_backdrop: None, widget_image: None, dock_overlays: None }
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png
    }

    #[test]
    fn appearance_name_maps_to_dark_or_light() {
        assert_eq!(is_dark_appearance_name(Some("NSAppearanceNameDarkAqua"), "NSAppearanceNameDarkAqua"), Some(true));
        assert_eq!(is_dark_appearance_name(Some("NSAppearanceNameAqua"), "NSAppearanceNameDarkAqua"), Some(false));
        assert_eq!(is_dark_appearance_name(None, "NSAppearanceNameDarkAqua"), None);
    }

    #[test]
    fn appearance_label_is_dark_or_light() {
        assert_eq!(appearance_label(true), "dark");
        assert_eq!(appearance_label(false), "light");
    }

    #[test]
    fn png_dimensions_reads_ihdr() {
        assert_eq!(png_dimensions(&png_header(300, 66)), Some((300, 66)));
    }

    #[test]
    fn png_dimensions_rejects_garbage() {
        assert_eq!(png_dimensions(&[1, 2, 3]), None);
        assert_eq!(png_dimensions(&png_header(0, 66)), None);
        let mut bad = png_header(10, 10);
        bad[0] = 0;
        assert_eq!(png_dimensions(&bad), None);
    }

    #[test]
    fn status_image_size_is_22pt_tall() {
        assert_eq!(status_image_size(300, 66), (100.0, 22.0));
        assert_eq!(status_image_size(66, 66), (22.0, 22.0));
    }

    #[test]
    fn disabled_is_none() {
        assert_eq!(menu_bar_title(false, Some(&payload(vec![provider(&["42%"])]))), None);
    }

    #[test]
    fn one_provider_two_items() {
        let p = payload(vec![provider(&["42%", "13%"])]);
        assert_eq!(menu_bar_title(true, Some(&p)).as_deref(), Some("42% · 13%"));
    }

    #[test]
    fn two_providers() {
        let p = payload(vec![provider(&["42%"]), provider(&["7%"])]);
        assert_eq!(menu_bar_title(true, Some(&p)).as_deref(), Some("42%  7%"));
    }

    #[test]
    fn empty_payload_is_none() {
        assert_eq!(menu_bar_title(true, None), None);
        assert_eq!(menu_bar_title(true, Some(&payload(vec![]))), None);
        assert_eq!(menu_bar_title(true, Some(&payload(vec![provider(&[""])]))), None);
    }

    fn with_image(image: &str, providers: Vec<TaskbarProvider>) -> TaskbarPayload {
        TaskbarPayload { menu_bar_image: Some(image.into()), ..payload(providers) }
    }

    #[test]
    fn display_disabled_is_default() {
        let p = with_image("AQID", vec![provider(&["42%"])]);
        assert_eq!(menu_bar_display(false, Some(&p)), Display::Default);
    }

    #[test]
    fn display_image_present() {
        let p = with_image("AQID", vec![provider(&["42%"])]);
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Image { png: vec![1, 2, 3], backdrop: None });
    }

    fn backdrop(blur: f64) -> TaskbarBackdrop {
        TaskbarBackdrop { blur, radius: 7.0, width_pt: 120.0, height_pt: 22.0 }
    }

    #[test]
    fn display_image_carries_the_backdrop_when_blur_is_on() {
        let p = TaskbarPayload { menu_bar_backdrop: Some(backdrop(0.5)), ..with_image("AQID", vec![provider(&["42%"])]) };
        assert_eq!(
            menu_bar_display(true, Some(&p)),
            Display::Image {
                png: vec![1, 2, 3],
                backdrop: Some(Backdrop { blur: 0.5, radius: 7.0, width: 120.0, height: 22.0 })
            }
        );
    }

    #[test]
    fn display_image_has_no_backdrop_when_blur_is_zero_or_missing() {
        let p = TaskbarPayload { menu_bar_backdrop: Some(backdrop(0.0)), ..with_image("AQID", vec![provider(&["42%"])]) };
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Image { png: vec![1, 2, 3], backdrop: None });
        let p = TaskbarPayload { menu_bar_backdrop: None, ..with_image("AQID", vec![provider(&["42%"])]) };
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Image { png: vec![1, 2, 3], backdrop: None });
    }

    #[test]
    fn display_without_image_ignores_the_backdrop() {
        let p = TaskbarPayload { menu_bar_backdrop: Some(backdrop(1.0)), ..payload(vec![provider(&["42%"])]) };
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Title("42%".into()));
    }

    #[test]
    fn backdrop_is_validated() {
        assert_eq!(
            backdrop_from_payload(Some(&backdrop(0.5))),
            Some(Backdrop { blur: 0.5, radius: 7.0, width: 120.0, height: 22.0 })
        );
        assert_eq!(backdrop_from_payload(None), None);
        assert_eq!(backdrop_from_payload(Some(&backdrop(0.0))), None);
        assert_eq!(backdrop_from_payload(Some(&backdrop(-0.2))), None);
        assert_eq!(backdrop_from_payload(Some(&backdrop(f64::NAN))), None);
        assert_eq!(backdrop_from_payload(Some(&TaskbarBackdrop { width_pt: 0.0, ..backdrop(0.5) })), None);
        assert_eq!(backdrop_from_payload(Some(&TaskbarBackdrop { height_pt: f64::INFINITY, ..backdrop(0.5) })), None);
    }

    #[test]
    fn backdrop_clamps_blur_and_radius() {
        let clamped = backdrop_from_payload(Some(&TaskbarBackdrop { radius: -3.0, ..backdrop(4.0) })).unwrap();
        assert_eq!((clamped.blur, clamped.radius), (1.0, 0.0));
    }

    #[test]
    fn centered_rect_centers_the_image_in_the_button() {
        assert_eq!(centered_rect(140.0, 24.0, 120.0, 22.0), (10.0, 1.0, 120.0, 22.0));
        assert_eq!(centered_rect(120.0, 22.0, 120.0, 22.0), (0.0, 0.0, 120.0, 22.0));
    }

    #[test]
    fn payload_deserializes_the_backdrop() {
        let json = r#"{"providers":[],"tooltip":"","menuBarBackdrop":{"blur":0.5,"radius":7,"widthPt":100.5,"heightPt":22}}"#;
        let payload: TaskbarPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.menu_bar_backdrop, Some(TaskbarBackdrop { blur: 0.5, radius: 7.0, width_pt: 100.5, height_pt: 22.0 }));
        let none: TaskbarPayload = serde_json::from_str(r#"{"providers":[],"tooltip":"","menuBarBackdrop":null}"#).unwrap();
        assert_eq!(none.menu_bar_backdrop, None);
        let missing: TaskbarPayload = serde_json::from_str(r#"{"providers":[],"tooltip":""}"#).unwrap();
        assert_eq!(missing.menu_bar_backdrop, None);
    }

    #[test]
    fn display_bad_base64_falls_back_to_title() {
        let p = with_image("not base64!!", vec![provider(&["42%"])]);
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Title("42%".into()));
    }

    #[test]
    fn display_no_image_uses_title() {
        let p = payload(vec![provider(&["42%", "13%"])]);
        assert_eq!(menu_bar_display(true, Some(&p)), Display::Title("42% · 13%".into()));
    }

    #[test]
    fn display_no_data_is_default() {
        assert_eq!(menu_bar_display(true, None), Display::Default);
        assert_eq!(menu_bar_display(true, Some(&payload(vec![]))), Display::Default);
    }
}
