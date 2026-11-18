//! Windows: the blur under the taskbar widget's background card.
//!
//! DWM cannot blur what lies behind a child window of the taskbar: its effects only apply to top-level
//! windows, and right behind the widget sits the taskbar itself. What the taskbar covers is the desktop
//! wallpaper, so this reads the wallpaper of the taskbar's monitor, lays it out the way Windows does (fill,
//! fit, stretch, tile, center, span), blurs the strip under the taskbar in software and lets the painter
//! draw it under the card, like the behind-window blur of the macOS menu bar.

use std::cell::RefCell;
use std::time::{Duration, Instant};
use windows::core::{IUnknown, Interface, PCWSTR};
use windows::Win32::Foundation::GENERIC_READ;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource, IWICImagingFactory, IWICPalette,
    WICBitmapDitherTypeNone, WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom,
    WICDecodeMetadataCacheOnDemand, WICRect,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    DesktopWallpaper, IDesktopWallpaper, DWPOS_CENTER, DWPOS_FILL, DWPOS_FIT, DWPOS_SPAN, DWPOS_STRETCH, DWPOS_TILE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// Blur radius at 96 dpi (three box passes of this radius come close to a gaussian).
const BLUR_RADIUS: i32 = 20;
/// Share (of 255) of the taskbar's theme gray mixed into the blurred wallpaper, so the card reads as a
/// frosted material and the widget's text stays legible over bright wallpapers.
const TINT: u32 = 110;
/// How often the wallpaper is read again without a settings-change message (slideshows change silently).
const RECHECK: Duration = Duration::from_secs(25);
/// Tiled wallpapers with more tiles than this under the taskbar are drawn as their background color.
const MAX_TILES: usize = 4096;

/// Screen rectangle in physical pixels (right and bottom exclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub l: i32,
    pub t: i32,
    pub r: i32,
    pub b: i32,
}

impl Rect {
    fn w(&self) -> i32 {
        self.r - self.l
    }

    fn h(&self) -> i32 {
        self.b - self.t
    }

    fn intersect(&self, o: &Rect) -> Option<Rect> {
        let r = Rect { l: self.l.max(o.l), t: self.t.max(o.t), r: self.r.min(o.r), b: self.b.min(o.b) };
        (r.l < r.r && r.t < r.b).then_some(r)
    }
}

/// What Windows shows on the taskbar's monitor.
#[derive(Debug, Clone, PartialEq)]
struct Source {
    /// Empty for a solid color background.
    path: String,
    /// `DESKTOP_WALLPAPER_POSITION` value.
    position: i32,
    /// Background color as a COLORREF (0x00BBGGRR).
    color: u32,
    monitor: Rect,
}

/// The blurred wallpaper under the taskbar: opaque 0x00RRGGBB pixels, `origin` in screen pixels.
pub struct Strip {
    origin: (i32, i32),
    w: i32,
    h: i32,
    px: Vec<u32>,
}

impl Strip {
    /// Pixel at screen point (x, y); points outside the strip take the nearest edge pixel.
    pub fn at(&self, x: i32, y: i32) -> u32 {
        let x = (x - self.origin.0).clamp(0, self.w - 1);
        let y = (y - self.origin.1).clamp(0, self.h - 1);
        self.px[(y * self.w + x) as usize]
    }
}

struct Cache {
    source: Source,
    bar: Rect,
    dpi: u32,
    light: bool,
    checked: Instant,
    strip: Strip,
}

thread_local! {
    static CACHE: RefCell<Option<Cache>> = const { RefCell::new(None) };
}

/// Drops the cached strip so the next paint reads the wallpaper again.
pub fn invalidate() {
    CACHE.with(|cell| *cell.borrow_mut() = None);
}

/// Runs `f` with the blurred wallpaper under the taskbar at `bar` (screen pixels). Skips `f` when the
/// wallpaper's layout cannot be read.
pub fn with_strip(bar: Rect, dpi: u32, light: bool, f: impl FnOnce(&Strip)) {
    CACHE.with(|cell| {
        let mut cache = cell.borrow_mut();
        let same_place = |c: &Cache| c.bar == bar && c.dpi == dpi && c.light == light;
        if !cache.as_ref().is_some_and(|c| same_place(c) && c.checked.elapsed() < RECHECK) {
            let Some(source) = (unsafe { query_source(bar) }) else {
                log::debug!("taskbar: desktop wallpaper unavailable, no blur");
                *cache = None;
                return;
            };
            let reuse = cache.as_ref().is_some_and(|c| same_place(c) && c.source == source);
            if reuse {
                if let Some(c) = cache.as_mut() {
                    c.checked = Instant::now();
                }
            } else {
                *cache = build_strip(&source, bar, dpi, light).map(|strip| Cache {
                    source,
                    bar,
                    dpi,
                    light,
                    checked: Instant::now(),
                    strip,
                });
            }
        }
        if let Some(c) = cache.as_ref() {
            f(&c.strip);
        }
    });
}

/// Wallpaper, layout and background color of the monitor under the middle of `bar`.
unsafe fn query_source(bar: Rect) -> Option<Source> {
    unsafe {
        let wallpaper: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None::<&IUnknown>, CLSCTX_ALL).ok()?;
        let (cx, cy) = ((bar.l + bar.r) / 2, (bar.t + bar.b) / 2);
        let mut found = None;
        for index in 0..wallpaper.GetMonitorDevicePathCount().ok()? {
            let Ok(id) = wallpaper.GetMonitorDevicePathAt(index) else { continue };
            if let Ok(r) = wallpaper.GetMonitorRECT(PCWSTR(id.0 as *const u16)) {
                if cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom {
                    let path = match wallpaper.GetWallpaper(PCWSTR(id.0 as *const u16)) {
                        Ok(p) => {
                            let text = p.to_string().unwrap_or_default();
                            CoTaskMemFree(Some(p.0 as *const _));
                            text
                        }
                        Err(_) => String::new(),
                    };
                    found = Some((path, Rect { l: r.left, t: r.top, r: r.right, b: r.bottom }));
                }
            }
            CoTaskMemFree(Some(id.0 as *const _));
            if found.is_some() {
                break;
            }
        }
        let (path, monitor) = found?;
        Some(Source {
            path,
            position: wallpaper.GetPosition().map(|p| p.0).unwrap_or(DWPOS_FILL.0),
            color: wallpaper.GetBackgroundColor().map(|c| c.0).unwrap_or(0),
            monitor,
        })
    }
}

/// Lays out, blurs and tints the wallpaper under `bar`. The blur reads a margin around the taskbar so its
/// edges blend with the wallpaper above (or below) it.
fn build_strip(source: &Source, bar: Rect, dpi: u32, light: bool) -> Option<Strip> {
    let radius = (BLUR_RADIUS * dpi as i32 / 96).max(1);
    let margin = radius * 3;
    let region = Rect { l: bar.l, t: bar.t - margin, r: bar.r, b: bar.b + margin }.intersect(&source.monitor)?;
    let inner = bar.intersect(&region)?;
    let (rw, rh) = (region.w(), region.h());
    let mut px = vec![colorref_rgb(source.color); (rw * rh) as usize];
    if !source.path.is_empty() {
        if let Err(error) = unsafe { draw_wallpaper(&mut px, region, source) } {
            log::debug!("taskbar: wallpaper not readable ({error}), blurring its background color");
        }
    }
    blur(&mut px, rw, rh, radius);
    let gray = if light { 243 } else { 28 };
    let mut out = Vec::with_capacity((inner.w() * inner.h()) as usize);
    for y in inner.t..inner.b {
        for x in inner.l..inner.r {
            out.push(mix(px[((y - region.t) * rw + (x - region.l)) as usize], gray, TINT));
        }
    }
    Some(Strip { origin: (inner.l, inner.t), w: inner.w(), h: inner.h(), px: out })
}

/// Draws the wallpaper file over `px` (the pixels of `region`, already filled with the background color).
unsafe fn draw_wallpaper(px: &mut [u32], region: Rect, source: &Source) -> windows::core::Result<()> {
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None::<&IUnknown>, CLSCTX_INPROC_SERVER)?;
        let path: Vec<u16> = source.path.encode_utf16().chain(Some(0)).collect();
        let decoder =
            factory.CreateDecoderFromFilename(PCWSTR(path.as_ptr()), None, GENERIC_READ, WICDecodeMetadataCacheOnDemand)?;
        let frame: IWICBitmapSource = decoder.GetFrame(0)?.cast()?;
        let (mut iw, mut ih) = (0u32, 0u32);
        frame.GetSize(&mut iw, &mut ih)?;
        if iw == 0 || ih == 0 {
            return Ok(());
        }
        let area = if source.position == DWPOS_SPAN.0 { virtual_screen() } else { source.monitor };
        let (size, origins) = layout(source.position, area, iw as i32, ih as i32, region);
        let scaled: IWICBitmapSource = if size == (iw as i32, ih as i32) {
            frame
        } else {
            let scaler = factory.CreateBitmapScaler()?;
            scaler.Initialize(&frame, size.0 as u32, size.1 as u32, WICBitmapInterpolationModeFant)?;
            scaler.cast()?
        };
        let converter = factory.CreateFormatConverter()?;
        converter.Initialize(
            &scaled,
            &GUID_WICPixelFormat32bppBGRA,
            WICBitmapDitherTypeNone,
            None::<&IWICPalette>,
            0.0,
            WICBitmapPaletteTypeCustom,
        )?;
        let rw = region.w();
        for (ox, oy) in origins {
            let Some(part) = (Rect { l: ox, t: oy, r: ox + size.0, b: oy + size.1 }).intersect(&region) else {
                continue;
            };
            let (pw, ph) = (part.w(), part.h());
            let mut bytes = vec![0u8; (pw * ph * 4) as usize];
            let rect = WICRect { X: part.l - ox, Y: part.t - oy, Width: pw, Height: ph };
            converter.CopyPixels(&rect, (pw * 4) as u32, &mut bytes)?;
            for y in 0..ph {
                let row = ((part.t - region.t + y) * rw + (part.l - region.l)) as usize;
                for x in 0..pw {
                    let i = ((y * pw + x) * 4) as usize;
                    px[row + x as usize] =
                        ((bytes[i + 2] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i] as u32;
                }
            }
        }
        Ok(())
    }
}

/// Bounding box of every monitor (where a "span" wallpaper is laid out).
fn virtual_screen() -> Rect {
    let (l, t, w, h) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    Rect { l, t, r: l + w, b: t + h }
}

/// Size the wallpaper is drawn at and the top-left corners (screen pixels) it is drawn at, the way Windows
/// lays it out over `area` (the monitor, or every monitor for "span"). Tiles only cover `region`.
fn layout(position: i32, area: Rect, iw: i32, ih: i32, region: Rect) -> ((i32, i32), Vec<(i32, i32)>) {
    let (aw, ah) = (area.w().max(1), area.h().max(1));
    let scaled = |s: f64| (((iw as f64 * s).round() as i32).max(1), ((ih as f64 * s).round() as i32).max(1));
    let (sx, sy) = (aw as f64 / iw as f64, ah as f64 / ih as f64);
    let size = if position == DWPOS_STRETCH.0 {
        (aw, ah)
    } else if position == DWPOS_FIT.0 {
        scaled(sx.min(sy))
    } else if position == DWPOS_CENTER.0 || position == DWPOS_TILE.0 {
        (iw, ih)
    } else {
        scaled(sx.max(sy)) // fill, span
    };
    if position != DWPOS_TILE.0 {
        return (size, vec![(area.l + (aw - size.0) / 2, area.t + (ah - size.1) / 2)]);
    }
    let mut origins = Vec::new();
    let mut y = area.t + (region.t - area.t).div_euclid(size.1) * size.1;
    while y < region.b {
        let mut x = area.l + (region.l - area.l).div_euclid(size.0) * size.0;
        while x < region.r {
            origins.push((x, y));
            if origins.len() > MAX_TILES {
                return (size, Vec::new());
            }
            x += size.0;
        }
        y += size.1;
    }
    (size, origins)
}

fn colorref_rgb(c: u32) -> u32 {
    ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)
}

fn mix(rgb: u32, gray: u32, amount: u32) -> u32 {
    let ch = |shift: u32| (((rgb >> shift) & 255) * (255 - amount) + gray * amount) / 255;
    (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/// Three box blurs of `radius` per direction (close to a gaussian); pixels past the edges repeat the edge.
fn blur(px: &mut [u32], w: i32, h: i32, radius: i32) {
    let mut tmp = vec![0u32; px.len()];
    for _ in 0..3 {
        box_pass(px, &mut tmp, w, h, radius, true);
        box_pass(&tmp, px, w, h, radius, false);
    }
}

fn box_pass(src: &[u32], dst: &mut [u32], w: i32, h: i32, radius: i32, horizontal: bool) {
    let (lines, len) = if horizontal { (h, w) } else { (w, h) };
    let index = |line: i32, i: i32| -> usize {
        let i = i.clamp(0, len - 1);
        (if horizontal { line * w + i } else { i * w + line }) as usize
    };
    let n = (2 * radius + 1) as u32;
    let channels = |p: u32| [(p >> 16) & 255, (p >> 8) & 255, p & 255];
    for line in 0..lines {
        let mut sum = [0u32; 3];
        for i in -radius..=radius {
            let c = channels(src[index(line, i)]);
            for k in 0..3 {
                sum[k] += c[k];
            }
        }
        for i in 0..len {
            dst[index(line, i)] = ((sum[0] / n) << 16) | ((sum[1] / n) << 8) | (sum[2] / n);
            let add = channels(src[index(line, i + radius + 1)]);
            let sub = channels(src[index(line, i - radius)]);
            for k in 0..3 {
                sum[k] = sum[k] + add[k] - sub[k];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(l: i32, t: i32, r: i32, b: i32) -> Rect {
        Rect { l, t, r, b }
    }

    #[test]
    fn fill_covers_the_monitor_and_centers_the_overflow() {
        let area = rect(0, 0, 1000, 500);
        let (size, origins) = layout(DWPOS_FILL.0, area, 100, 100, area);
        assert_eq!(size, (1000, 1000));
        assert_eq!(origins, vec![(0, -250)]);
    }

    #[test]
    fn fit_keeps_the_whole_image_inside() {
        let area = rect(0, 0, 1000, 500);
        let (size, origins) = layout(DWPOS_FIT.0, area, 100, 100, area);
        assert_eq!(size, (500, 500));
        assert_eq!(origins, vec![(250, 0)]);
    }

    #[test]
    fn tiles_cover_only_the_region() {
        let area = rect(0, 0, 1000, 500);
        let (size, origins) = layout(DWPOS_TILE.0, area, 300, 300, rect(0, 450, 1000, 500));
        assert_eq!(size, (300, 300));
        assert_eq!(origins, vec![(0, 300), (300, 300), (600, 300), (900, 300)]);
    }

    #[test]
    fn blur_keeps_a_flat_color_and_softens_an_edge() {
        let (w, h) = (20, 4);
        let mut flat = vec![0x0033_6699; (w * h) as usize];
        blur(&mut flat, w, h, 3);
        assert!(flat.iter().all(|&p| p == 0x0033_6699));
        let mut edge: Vec<u32> = (0..w * h).map(|i| if i % w < 10 { 0 } else { 0x00FF_FFFF }).collect();
        blur(&mut edge, w, h, 3);
        let mid = edge[10] & 255;
        assert!(mid > 0 && mid < 255);
    }

    #[test]
    fn colorref_becomes_rgb() {
        assert_eq!(colorref_rgb(0x0033_2211), 0x0011_2233);
    }
}
