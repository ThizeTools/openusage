# Tauri v2 + Win11 Frameless Window - Titlebar Drag Teleport Fix

## Problem

Frameless Tauri window (`decorations: false`) on Windows 11 can jump or
"teleport" outside the visible screen when the user drags the app by the custom
top bar.

Observed behavior in MIA:

- Dragging by the custom top bar sends the Hub window outside the user's view.
- Moving the same window with AltSnap works.
- Opening from the tray can bring the window back, but that does not fix the
  titlebar drag path.

## Relation to `tauri-win11-frameless-fix.md`

`docs/tauri-win11-frameless-fix.md` documents a visual workaround for:

- 1px black top line on a frameless Windows 11 window.
- Sharp corners on an undecorated window.

That workaround uses:

- `transparent: true`
- `shadow: false`
- `backgroundColor: "#00000000"`
- transparent `html`
- manual DWM rounded corners

That is not the fix for the teleport bug. For MIA's main Hub window, that
transparent/no-shadow recipe made window behavior more fragile and was reverted.
Keep that recipe limited to cases where the visual tradeoff is worth testing.

The actual drag teleport bug was in the custom titlebar event wiring.

## Root Cause

The titlebar used two drag mechanisms at the same time:

1. Native Tauri drag region:

```svelte
<header data-tauri-drag-region>
```

2. Manual JS drag call on `mousedown`:

```svelte
function startDrag(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void win.startDragging();
}

<header data-tauri-drag-region onmousedown={startDrag}>
```

Both paths try to start native window dragging from the same mouse down. On
Windows, that can produce a bad drag delta and move the window far away from the
cursor. AltSnap works because it moves the native window externally and bypasses
the app's titlebar event handler.

## Final Fix

### 1. Use only Tauri's native drag region

Keep `data-tauri-drag-region` on the non-interactive titlebar area:

```svelte
<header
  class="window-titlebar"
  role="presentation"
  data-tauri-drag-region
  ondblclick={toggleMaximize}
>
  <div class="window-title" data-tauri-drag-region>
    <img src="/logo.png" alt="" class="window-title-logo" data-tauri-drag-region />
    <span data-tauri-drag-region>MIA</span>
  </div>
</header>
```

### 2. Remove manual `startDragging()`

Delete this function:

```svelte
function startDrag(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void win.startDragging();
}
```

Delete this handler from the titlebar:

```svelte
onmousedown={startDrag}
```

### 3. Keep buttons out of the drag path

Window controls should stop mouse events so minimize/maximize/close do not become
drag starts:

```svelte
function stopControlEvent(event: MouseEvent) {
  event.stopPropagation();
}
```

```svelte
<button
  type="button"
  class="window-control"
  aria-label="Minimizar"
  onmousedown={stopControlEvent}
  ondblclick={stopControlEvent}
  onclick={minimize}
>
```

### 4. Keep the main window stable

For MIA's main Hub window, prefer an opaque frameless window with native shadow:

```json
{
  "label": "main",
  "decorations": false,
  "shadow": true,
  "theme": "Light",
  "visible": true
}
```

Do not use these on the main Hub window unless you are deliberately testing the
visual black-line workaround again:

```json
{
  "transparent": true,
  "shadow": false,
  "backgroundColor": "#00000000"
}
```

The HUD window can stay transparent because it is a separate overlay and does not
use the custom titlebar drag path.

### 5. Remove manual DWM rounded corners from the main window

For this fix, remove the helper and setup call:

```rust
apply_main_window_rounded_corners(app.handle());
```

The DWM helper belongs to the visual frameless/corner workaround, not to the
titlebar drag fix.

## Files to Check

- `app/src/lib/components/WindowTitleBar.svelte`
- `app/src-tauri/tauri.conf.json`
- `app/src-tauri/src/lib.rs`
- `app/src/styles.css`

## Verification

Run:

```powershell
rtk proxy bun run check
rtk proxy cargo test
```

Then manually verify on Windows:

1. Start the app.
2. Drag the main Hub window by the custom top bar.
3. Drag slowly and quickly.
4. Drag after minimizing and restoring from the tray.
5. Confirm AltSnap and titlebar drag both keep the window under the cursor.

Optional grep checks:

```powershell
rtk proxy powershell -NoProfile -Command "Select-String -LiteralPath 'app/src/lib/components/WindowTitleBar.svelte' -Pattern 'startDragging|startDrag|data-tauri-drag-region|onmousedown'"
rtk proxy powershell -NoProfile -Command "Select-String -LiteralPath 'app/src-tauri/tauri.conf.json' -Pattern 'label|transparent|shadow|backgroundColor'"
```

Expected result:

- `WindowTitleBar.svelte` has `data-tauri-drag-region`.
- `WindowTitleBar.svelte` does not call `startDragging()`.
- The titlebar header does not have `onmousedown={startDrag}`.
- Control buttons may still use `onmousedown={stopControlEvent}`.
- The main window has `"shadow": true`.
- Only the HUD window has `"transparent": true`.

## Commit Reference

In this repo, the fix was placed in:

```text
9c39307 fix: keep restored hub on screen
```

That commit combines:

- Reverting the fragile transparent/no-shadow main window setup.
- Removing the duplicate JS titlebar drag start.
- Keeping the tray restore clamp as a recovery path for offscreen windows.
