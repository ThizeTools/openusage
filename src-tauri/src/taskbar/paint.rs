//! Software rendering of the taskbar widget into a premultiplied BGRA frame.
//! Text is drawn with GDI into a scratch DIB and used as a coverage mask.

use super::{TaskbarItem, TaskbarPayload};
use base64::Engine;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{HWND, POINT, SIZE};
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::UI::WindowsAndMessaging::{UpdateLayeredWindow, ULW_ALPHA};

const MASK_SIDE: usize = 64;
type Rgb = (u8, u8, u8);

pub struct Frame {
    pub w: i32,
    pub h: i32,
    px: Vec<u32>,
}

impl Frame {
    fn new(w: i32, h: i32) -> Self {
        // Alpha 1 everywhere so the whole strip receives mouse input.
        Self { w, h, px: vec![0x0100_0000; (w.max(1) * h.max(1)) as usize] }
    }

    fn blend(&mut self, x: i32, y: i32, (r, g, b): Rgb, a: u8) {
        if a == 0 || x < 0 || y < 0 || x >= self.w || y >= self.h {
            return;
        }
        let i = (y * self.w + x) as usize;
        let d = self.px[i];
        let (a, inv) = (a as u32, 255 - a as u32);
        let ch = |shift: u32, c: u8| (c as u32 * a + ((d >> shift) & 255) * inv) / 255;
        let na = a + ((d >> 24) & 255) * inv / 255;
        self.px[i] = (na << 24) | (ch(16, r) << 16) | (ch(8, g) << 8) | ch(0, b);
    }

    fn fill_round(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, r: i32, rgb: Rgb, a: u8) {
        for y in y0..y1 {
            for x in x0..x1 {
                let cx = x.clamp(x0 + r, x1 - r - 1);
                let cy = y.clamp(y0 + r, y1 - r - 1);
                let (dx, dy) = (x - cx, y - cy);
                if dx * dx + dy * dy <= r * r {
                    self.blend(x, y, rgb, a);
                }
            }
        }
    }

    /// Box-filters the 64x64 alpha mask down to `size` and tints it.
    fn draw_mask(&mut self, mask: &[u8], x: i32, y: i32, size: i32, rgb: Rgb) {
        let n = MASK_SIDE as i32;
        for ty in 0..size {
            let (sy0, sy1) = (ty * n / size, ((ty + 1) * n / size).max(ty * n / size + 1));
            for tx in 0..size {
                let (sx0, sx1) = (tx * n / size, ((tx + 1) * n / size).max(tx * n / size + 1));
                let (mut sum, mut count) = (0u32, 0u32);
                for sy in sy0..sy1.min(n) {
                    for sx in sx0..sx1.min(n) {
                        sum += mask[(sy * n + sx) as usize] as u32;
                        count += 1;
                    }
                }
                if count > 0 {
                    self.blend(x + tx, y + ty, rgb, (sum / count) as u8);
                }
            }
        }
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn wide_z(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

struct Gdi {
    dc: HDC,
    label: HFONT,
    value: HFONT,
}

impl Gdi {
    unsafe fn new(font_px: i32) -> Self {
        let dc = unsafe { CreateCompatibleDC(null_mut()) };
        let label = unsafe { make_font(dc, font_px, 400) };
        let value = unsafe { make_font(dc, font_px, 600) };
        Self { dc, label, value }
    }

    unsafe fn measure(&self, font: HFONT, text: &str) -> (i32, i32) {
        let w = wide(text);
        let mut sz = SIZE { cx: 0, cy: 0 };
        unsafe {
            let old = SelectObject(self.dc, font);
            GetTextExtentPoint32W(self.dc, w.as_ptr(), w.len() as i32, &mut sz);
            SelectObject(self.dc, old);
        }
        (sz.cx, sz.cy)
    }

    unsafe fn draw_text(&self, f: &mut Frame, font: HFONT, text: &str, x: i32, y: i32, rgb: Rgb, alpha: u8) {
        let (w, h) = unsafe { self.measure(font, text) };
        if w <= 0 || h <= 0 {
            return;
        }
        let Some((bmp, bits)) = (unsafe { dib(self.dc, w, h) }) else { return };
        let text_w = wide(text);
        unsafe {
            let old_bmp = SelectObject(self.dc, bmp);
            let old_font = SelectObject(self.dc, font);
            SetBkMode(self.dc, TRANSPARENT as i32);
            SetTextColor(self.dc, 0x00FF_FFFF);
            TextOutW(self.dc, 0, 0, text_w.as_ptr(), text_w.len() as i32);
            GdiFlush();
            let src = std::slice::from_raw_parts(bits, (w * h) as usize);
            for yy in 0..h {
                for xx in 0..w {
                    let p = src[(yy * w + xx) as usize];
                    let cov = (((p >> 16) & 255) + ((p >> 8) & 255) + (p & 255)) / 3;
                    if cov > 0 {
                        f.blend(x + xx, y + yy, rgb, (cov * alpha as u32 / 255) as u8);
                    }
                }
            }
            SelectObject(self.dc, old_font);
            SelectObject(self.dc, old_bmp);
            DeleteObject(bmp);
        }
    }
}

impl Drop for Gdi {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.label);
            DeleteObject(self.value);
            DeleteDC(self.dc);
        }
    }
}

/// Prefers the Windows 11 taskbar font, falls back to Segoe UI.
unsafe fn make_font(dc: HDC, px: i32, weight: i32) -> HFONT {
    for face in ["Segoe UI Variable Text", "Segoe UI"] {
        let name = wide_z(face);
        let font = unsafe {
            CreateFontW(
                -px, 0, 0, 0, weight, 0, 0, 0,
                DEFAULT_CHARSET as u32, OUT_DEFAULT_PRECIS as u32, CLIP_DEFAULT_PRECIS as u32,
                CLEARTYPE_QUALITY as u32, (DEFAULT_PITCH | FF_DONTCARE) as u32, name.as_ptr(),
            )
        };
        let mut got = [0u16; 64];
        let len = unsafe {
            let old = SelectObject(dc, font);
            let len = GetTextFaceW(dc, got.len() as i32, got.as_mut_ptr());
            SelectObject(dc, old);
            len
        };
        let got = String::from_utf16_lossy(&got[..(len.max(1) - 1) as usize]);
        if got.eq_ignore_ascii_case(face) || face == "Segoe UI" {
            return font;
        }
        unsafe { DeleteObject(font) };
    }
    unreachable!()
}

/// Top-down 32bpp DIB, zero-filled.
unsafe fn dib(dc: HDC, w: i32, h: i32) -> Option<(HBITMAP, *mut u32)> {
    let mut bi: BITMAPINFO = unsafe { std::mem::zeroed() };
    bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bi.bmiHeader.biWidth = w;
    bi.bmiHeader.biHeight = -h;
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB;
    let mut bits: *mut core::ffi::c_void = null_mut();
    let bmp = unsafe { CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };
    if bmp.is_null() || bits.is_null() {
        log::warn!("taskbar: CreateDIBSection failed ({w}x{h})");
        return None;
    }
    unsafe { std::ptr::write_bytes(bits as *mut u32, 0, (w * h) as usize) };
    Some((bmp, bits as *mut u32))
}

fn tone_rgb(tone: &str, light: bool, fg: Rgb) -> Rgb {
    match (tone, light) {
        ("ahead", true) => (16, 124, 16),
        ("ahead", false) => (108, 203, 95),
        ("on-track", true) => (157, 93, 0),
        ("on-track", false) => (252, 225, 0),
        ("behind", true) => (196, 43, 28),
        ("behind", false) => (255, 153, 164),
        _ => fg,
    }
}

fn parse_hex(hex: &str) -> Option<Rgb> {
    let h = hex.trim().trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let c = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some((c(0)?, c(2)?, c(4)?))
}

/// Same rule as the app's getIconColor: keep brand logos legible.
fn icon_rgb(brand: Option<&str>, light: bool, fg: Rgb) -> Rgb {
    let Some(rgb) = brand.and_then(parse_hex) else { return fg };
    let lin = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    let lum = 0.2126 * lin(rgb.0) + 0.7152 * lin(rgb.1) + 0.0722 * lin(rgb.2);
    if !light && lum < 0.15 {
        return (255, 255, 255);
    }
    if light && lum > 0.85 {
        return fg;
    }
    rgb
}

struct Cell<'a> {
    item: &'a TaskbarItem,
    label_w: i32,
    value_w: i32,
}

/// Lays out and draws the whole strip. `height` is the taskbar client height.
pub unsafe fn render(payload: Option<&TaskbarPayload>, height: i32, dpi: u32, light: bool, hover: bool) -> Frame {
    let px = |v: i32| v * dpi as i32 / 96;
    let fg: Rgb = if light { (0, 0, 0) } else { (255, 255, 255) };
    let gdi = unsafe { Gdi::new(px(12)) };
    let line_h = unsafe { gdi.measure(gdi.value, "Ag").1 };
    let (pad, icon, icon_gap, label_gap, col_gap, prov_gap) = (px(8), px(16), px(6), px(4), px(10), px(14));

    let providers = payload.map(|p| p.providers.as_slice()).unwrap_or(&[]);
    if providers.is_empty() {
        let text = "OpenUsage";
        let w = unsafe { gdi.measure(gdi.label, text).0 } + pad * 2;
        let mut f = Frame::new(w, height);
        if hover {
            f.fill_round(px(2), px(4), w - px(2), height - px(4), px(4), fg, if light { 20 } else { 26 });
        }
        unsafe { gdi.draw_text(&mut f, gdi.label, text, pad, (height - line_h) / 2, fg, 170) };
        return f;
    }

    // Measure pass: columns of up to two stacked lines per provider.
    let mut blocks: Vec<(Option<Vec<u8>>, Rgb, Vec<Vec<Cell>>)> = Vec::new();
    let mut width = pad;
    for (index, provider) in providers.iter().enumerate() {
        let mask = provider
            .icon_mask
            .as_deref()
            .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
            .filter(|m| m.len() == MASK_SIDE * MASK_SIDE);
        let mut cols: Vec<Vec<Cell>> = Vec::new();
        for pair in provider.items.chunks(2) {
            cols.push(
                pair.iter()
                    .map(|item| Cell {
                        item,
                        label_w: if item.label.is_empty() { 0 } else { (unsafe { gdi.measure(gdi.label, &item.label).0 }) + label_gap },
                        value_w: unsafe { gdi.measure(gdi.value, &item.value).0 },
                    })
                    .collect(),
            );
        }
        if index > 0 {
            width += prov_gap;
        }
        if mask.is_some() {
            width += icon + icon_gap;
        }
        for (ci, col) in cols.iter().enumerate() {
            width += col.iter().map(|c| c.label_w + c.value_w).max().unwrap_or(0);
            if ci + 1 < cols.len() {
                width += col_gap;
            }
        }
        blocks.push((mask, icon_rgb(provider.brand_color.as_deref(), light, fg), cols));
    }
    width += pad;

    let mut f = Frame::new(width, height);
    if hover {
        f.fill_round(px(2), px(4), width - px(2), height - px(4), px(4), fg, if light { 20 } else { 26 });
    }
    let mut x = pad;
    for (index, (mask, tint, cols)) in blocks.iter().enumerate() {
        if index > 0 {
            x += prov_gap;
        }
        if let Some(mask) = mask {
            f.draw_mask(mask, x, (height - icon) / 2, icon, *tint);
            x += icon + icon_gap;
        }
        for (ci, col) in cols.iter().enumerate() {
            let top = (height - line_h * col.len() as i32) / 2;
            for (row, cell) in col.iter().enumerate() {
                let y = top + row as i32 * line_h;
                if cell.label_w > 0 {
                    unsafe { gdi.draw_text(&mut f, gdi.label, &cell.item.label, x, y, fg, 170) };
                }
                let tone = tone_rgb(&cell.item.tone, light, fg);
                unsafe { gdi.draw_text(&mut f, gdi.value, &cell.item.value, x + cell.label_w, y, tone, 255) };
            }
            x += col.iter().map(|c| c.label_w + c.value_w).max().unwrap_or(0);
            if ci + 1 < cols.len() {
                x += col_gap;
            }
        }
    }
    f
}

/// Pushes the frame to the layered window (size comes from the frame).
pub unsafe fn present(hwnd: HWND, f: &Frame) {
    unsafe {
        let screen = GetDC(null_mut());
        let mem = CreateCompatibleDC(screen);
        if let Some((bmp, bits)) = dib(mem, f.w, f.h) {
            std::ptr::copy_nonoverlapping(f.px.as_ptr(), bits, f.px.len());
            let old = SelectObject(mem, bmp);
            let size = SIZE { cx: f.w, cy: f.h };
            let src = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };
            if UpdateLayeredWindow(hwnd, screen, null(), &size, mem, &src, 0, &blend, ULW_ALPHA) == 0 {
                log::warn!("taskbar: UpdateLayeredWindow failed");
            }
            SelectObject(mem, old);
            DeleteObject(bmp);
        }
        DeleteDC(mem);
        ReleaseDC(null_mut(), screen);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::taskbar::{TaskbarItem, TaskbarProvider};

    /// Writes target/taskbar-preview-{dark,light}.bmp with sample data.
    /// Run: cargo test taskbar_preview -- --ignored
    #[test]
    #[ignore]
    fn taskbar_preview() {
        let item = |l: &str, v: &str, t: &str| TaskbarItem { label: l.into(), value: v.into(), tone: t.into() };
        let mask: Vec<u8> = (0..64 * 64)
            .map(|i: i32| {
                let (x, y) = (i % 64 - 32, i / 64 - 32);
                if x * x + y * y < 900 { 255 } else { 0 }
            })
            .collect();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&mask);
        let payload = TaskbarPayload {
            tooltip: String::new(),
            providers: vec![
                TaskbarProvider {
                    brand_color: Some("#DE7356".into()),
                    icon_mask: Some(b64.clone()),
                    items: vec![item("Session", "42/55%", "ahead"), item("Weekly", "30/40%", "on-track")],
                },
                TaskbarProvider {
                    brand_color: Some("#000000".into()),
                    icon_mask: Some(b64),
                    items: vec![item("Session", "90/50%", "behind"), item("Weekly", "12/40%", "ahead"), item("Spark", "5%", "neutral")],
                },
            ],
        };
        for (light, name) in [(false, "dark"), (true, "light")] {
            let f = unsafe { render(Some(&payload), 48, 96, light, true) };
            let bg = if light { 243u32 } else { 32u32 };
            let row = ((f.w * 3 + 3) / 4 * 4) as usize;
            let mut out = Vec::new();
            let size = 54 + row * f.h as usize;
            out.extend_from_slice(b"BM");
            out.extend_from_slice(&(size as u32).to_le_bytes());
            out.extend_from_slice(&[0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0]);
            out.extend_from_slice(&f.w.to_le_bytes());
            out.extend_from_slice(&f.h.to_le_bytes());
            out.extend_from_slice(&[1, 0, 24, 0, 0, 0, 0, 0]);
            out.extend_from_slice(&((row * f.h as usize) as u32).to_le_bytes());
            out.extend_from_slice(&[0; 16]);
            for y in (0..f.h).rev() {
                let start = out.len();
                for x in 0..f.w {
                    let p = f.px[(y * f.w + x) as usize];
                    let a = (p >> 24) & 255;
                    for shift in [0, 8, 16] {
                        out.push((((p >> shift) & 255) + bg * (255 - a) / 255).min(255) as u8);
                    }
                }
                out.resize(start + row, 0);
            }
            std::fs::write(format!("target/taskbar-preview-{name}.bmp"), out).unwrap();
        }
    }
}
