# Tauri v2 + Win11 Frameless Window — Black Top Line + Rounded Corners Fix

## Problem

Frameless Tauri window (`decorations: false`) on Windows 11 shows:
- 1px black line at top of window (DWM artifact, Tauri issue #5170).
- Sharp 90° outer corners (no native rounding).

## Root cause

- `decorations: false` + `shadow: true` → DWM paints a 1px border line at top.
- Disabling `shadow` removes line BUT also kills DWM-applied rounded corners and native shadow.
- WebView default `color-scheme: light` paints opaque white canvas behind transparent HTML.
- DWM rounded corners on undecorated popup windows need explicit `DwmSetWindowAttribute` call — they are NOT auto-applied to all popup windows.

## Final fix

### 1. `tauri.conf.json` — main window

```json
{
  "label": "main",
  ...
  "decorations": false,
  "transparent": true,
  "shadow": false,
  "backgroundColor": "#00000000"
}
```

- `transparent: true` + `backgroundColor: #00000000` → window has no opaque chrome.
- `shadow: false` → kills the 1px black top line.

### 2. `src/app.css` — global CSS reset

Remove `color-scheme: light` from `:root` (it forces opaque white WebView canvas).

```css
html {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
    color: var(--color-graphite-text);
}

body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    overflow: hidden;
    /* keep your page background here, e.g. gradient */
    background: <your gradient or solid>;
}
```

- Do NOT put `border-radius` on `html`, `body`, titlebar, or window-control
  buttons when native DWM rounded corners are active. Let the native window mask
  do the clipping.
- `html` background MUST be `transparent` so window transparency works.
- Body fills viewport (no margin) so content reaches window edges; rounded corners reveal the desktop in the 4 corner arcs.
- Close/minimize/maximize hover rectangles should stay square. If the close
  hover has its own radius, the red hover state gets clipped inside the window
  corner and exposes the titlebar/body background.
- Use CSS `border-radius` on `html/body` only as a fallback when DWM rounding is
  not available and you intentionally accept CSS-only clipping.

### 3. Force native rounded corners via Win32 DWM API

`shadow: false` removes DWM auto-rounding. Re-apply rounded corners manually with `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)`.

#### `src-tauri/Cargo.toml`

If the project does not already have a Win32 binding crate, add `windows`:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_Graphics_Dwm", "Win32_Foundation"] }
```

If the project already uses `windows-sys`, prefer reusing it instead of adding
`windows` only for this fix:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_Foundation",
    "Win32_Graphics_Dwm",
] }
```

#### `src-tauri/src/lib.rs`

```rust
#[cfg(target_os = "windows")]
fn apply_main_window_rounded_corners<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(handle) = win.hwnd() else {
        return;
    };
    let pref = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &pref as *const _ as *const _,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_main_window_rounded_corners<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {}
```

Equivalent `windows-sys` version:

```rust
#[cfg(windows)]
fn apply_main_window_rounded_corners(app: &tauri::AppHandle) {
    use std::ffi::c_void;

    use tauri::Manager;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let corner_preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner_preference as *const _ as *const c_void,
            std::mem::size_of_val(&corner_preference) as u32,
        );
    }
}

#[cfg(not(windows))]
fn apply_main_window_rounded_corners(_app: &tauri::AppHandle) {}
```

Placement rule: if the app already centralizes Win32 FFI in a file such as
`src-tauri/src/win32.rs`, put the helper there and re-export it. Keep `lib.rs`
focused on calling the helper from setup. This avoids scattering native FFI
across the Tauri bootstrap.

Call it inside `.setup(|app| { ... })`:

```rust
.setup(|app| {
    apply_main_window_rounded_corners(app.handle());
    // ...rest of setup...
    Ok(())
})
```

## Checklist when porting fix to another Tauri app

1. [ ] Set `transparent: true`, `shadow: false`, `backgroundColor: "#00000000"` on the frameless window in `tauri.conf.json`.
2. [ ] Remove `color-scheme: light` (or any opaque scheme) from CSS `:root`.
3. [ ] Set `html { background: transparent; overflow: hidden; }` with no `border-radius` when DWM rounding is active.
4. [ ] Set `body { margin: 0; overflow: hidden; }` and put page bg on body, also with no `border-radius` when DWM rounding is active.
5. [ ] Add a Win32 DWM binding if needed: use `windows`, or reuse existing `windows-sys`.
6. [ ] Add `apply_main_window_rounded_corners` helper, preferably in the app's existing Win32/native module if it has one.
7. [ ] Call the helper in `.setup()` before or near the rest of window initialization.
8. [ ] Keep custom titlebar/window-control hover backgrounds square. Do not add radius to the close button hover.
9. [ ] Full rebuild (`bun run tauri dev` / `cargo clean` if Rust dep cache acts up). HMR alone won't pick up `tauri.conf.json` or Rust changes.

## Caveats

- DWM rounded corners require Win11 (build 22000+). Win10 falls back to CSS-only rounding (the 4-corner arcs).
- Native floating shadow is gone (because `shadow: false`). To restore, would need a custom CSS shadow drawn around content with extra transparent margin around body — trade-off vs the black line bug.
- The transparent area at the 4 rounded corners shows the desktop wallpaper underneath. That's the intended "rounded window" effect.

## References

- Tauri black-top-line bug: https://github.com/tauri-apps/tauri/issues/5170
- DWM corner preference: https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_window_corner_preference
