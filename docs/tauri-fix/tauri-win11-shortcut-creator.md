# Tauri v2 + Win11 Shortcut Creator - Win-Key Hotkeys

## Problem

A shortcut recorder in a Tauri/WebView settings screen can fail for Windows-key
chords such as:

- `Win+Space`
- `Win+A`
- `Win+Z`
- modifier-only chords such as `Ctrl+Win`

Observed behavior in MIA:

- Recording a new shortcut with the old shortcut still active can start dictation
  while the user is trying to record the replacement.
- `KeyboardEvent` in the WebView is not reliable for `Win` chords. Windows can
  intercept the key sequence before Chromium reports a complete chord.
- `tauri-plugin-global-shortcut` cannot reliably register every `Win` chord or
  modifier-only chord through the normal plugin path.
- A shortcut creator that commits on the first detected key can save an incomplete
  chord before the user finishes pressing the combination.

## Root Cause

There are two separate shortcut paths:

1. Normal global shortcut registration through `tauri-plugin-global-shortcut`.
2. Windows native polling through `GetAsyncKeyState` for `Win` and
   modifier-only chords.

The WebView shortcut recorder originally used `keydown` / `keyup` events:

```ts
window.addEventListener("keydown", onRecordKeyDown, true);
window.addEventListener("keyup", onRecordKeyUp, true);
```

That is enough for common chords such as `Ctrl+Space`, but not for Windows-key
chords. For example, `Win+Space` is a Windows language/input switch shortcut, so
the WebView may not see a useful event sequence.

The global runtime also needs to be suspended while recording. Otherwise the
existing shortcut can fire while the user is creating the new one.

## Final Fix

### 1. Suspend the active runtime shortcut while recording

`unregister_hotkey` must do more than unregister a plugin shortcut. It must also
suspend the runtime so both shortcut delivery paths are muted:

```rust
pub struct HotkeyRuntime {
    cfg: Mutex<HotkeyConfig>,
    edge: Mutex<EdgeState>,
    suspended: AtomicBool,
    generation: AtomicU64,
}
```

When suspending:

```rust
rt.suspended.store(true, Ordering::SeqCst);
*rt.edge.lock().map_err(|_| "hotkey state poisoned".to_string())? = EdgeState::default();
```

When registering a new shortcut:

```rust
rt.suspended.store(false, Ordering::SeqCst);
```

Both runtime entry points must respect that flag:

```rust
pub fn on_shortcut_event(app: &AppHandle, pressed: bool) {
    let Some(rt) = app.try_state::<HotkeyRuntime>() else {
        return;
    };
    if rt.suspended.load(Ordering::SeqCst) {
        return;
    }
    // ...
}
```

```rust
if rt.suspended.load(Ordering::SeqCst) {
    active = false;
    blocked_until_release = false;
    continue;
}
```

### 2. Do not rely on WebView keyboard events for recording

Use a native Rust command that samples the keyboard state with
`GetAsyncKeyState`:

```rust
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct HotkeyRecordSample {
    pub accelerator: Option<String>,
    pub released: bool,
    pub cancelled: bool,
}

#[tauri::command]
pub fn sample_hotkey_recording() -> HotkeyRecordSample {
    platform_record_sample()
}
```

On Windows, sample modifiers and the first supported non-modifier key:

```rust
#[cfg(windows)]
fn current_mods_pressed() -> Mods {
    Mods {
        ctrl: any_pressed(&[VK_LCONTROL as i32, VK_RCONTROL as i32]),
        alt: any_pressed(&[VK_LMENU as i32, VK_RMENU as i32]),
        shift: any_pressed(&[VK_LSHIFT as i32, VK_RSHIFT as i32]),
        sup: any_pressed(&[VK_LWIN as i32, VK_RWIN as i32]),
    }
}
```

The sampler should return:

- `accelerator`: current complete chord candidate.
- `released`: true when all keys are up.
- `cancelled`: true for `Escape` alone.

### 3. Poll the native sampler from the UI

The UI records by polling Rust, not by listening to browser key events:

```ts
recordingPoll = window.setInterval(() => void pollHotkeyRecording(), 30);
void pollHotkeyRecording();
```

```ts
async function pollHotkeyRecording() {
  if (!recording) return;
  const sample = await sampleHotkeyRecording();
  if (!recording) return;

  if (sample.cancelled) {
    await cancelRecording();
    return;
  }
  if (sample.accelerator) pendingHotkey = sample.accelerator;
  if (sample.released && pendingHotkey) {
    await commitHotkey(pendingHotkey);
  }
}
```

This lets `Win+Space` and similar chords be detected at the same native layer
used by the global polling runtime.

### 4. Auto-confirm on release

The shortcut creator should not commit on first detection. It should keep
updating the pending chord while keys are down, then commit when all keys are
released:

```ts
if (sample.accelerator) pendingHotkey = sample.accelerator;
if (sample.released && pendingHotkey) {
  await commitHotkey(pendingHotkey);
}
```

This avoids saving partial chords while the user is still pressing keys.

### 5. Restore the old shortcut on cancel or failure

If recording is cancelled or saving the new chord fails, re-register the previous
runtime shortcut:

```ts
async function restoreCurrentHotkeyRuntime() {
  if (!hotkeySuspended || !hotkey) return;
  try {
    await updateHotkey(hotkey);
  } finally {
    hotkeySuspended = false;
  }
}
```

## Files to Check

- `app/src-tauri/src/hotkey.rs`
- `app/src-tauri/src/lib.rs`
- `app/src/lib/hotkey.ts`
- `app/src/lib/components/views/DictationView.svelte`

## Verification

Run:

```powershell
rtk bun run check
rtk cargo test hotkey
```

Then manually verify on Windows:

1. Open the Hub.
2. Go to the dictation shortcut recorder.
3. Click `Gravar atalho`.
4. Confirm the old shortcut no longer starts dictation while recording.
5. Press and release `Win+Space`.
6. Confirm the UI records and auto-confirms the chord.
7. Repeat with `Win+A`, `Win+Z`, and `Ctrl+Win`.
8. Press `Escape` alone and confirm recording cancels.
9. Try an invalid/reserved chord and confirm the previous shortcut is restored.

Optional grep checks:

```powershell
rtk rg -n "sample_hotkey_recording|HotkeyRecordSample|GetAsyncKeyState|suspended" app/src-tauri/src/hotkey.rs
rtk rg -n "sampleHotkeyRecording|recordingPoll|unregisterHotkey|updateHotkey" app/src/lib
```

Expected result:

- `hotkey.rs` exposes `sample_hotkey_recording`.
- `hotkey.rs` has a `suspended` runtime flag.
- Global shortcut handling and Windows polling both check `suspended`.
- The Svelte recorder polls `sampleHotkeyRecording`.
- The recorder auto-confirms on release instead of requiring a separate confirm
  click.

## Caveats

- Some `Win` chords are OS-owned. Even if the app can record them, Windows may
  still perform its own action. Treat real-device testing as required.
- `Win+L`, `Win+Tab`, `Win+D`, and `Ctrl+Alt+Delete` should stay blocked as
  reserved chords.
- Browser keyboard events are still useful for ordinary UI shortcuts, but not as
  the source of truth for a system-wide shortcut creator.
- The native sampler is Windows-specific. Non-Windows platforms should return a
  harmless no-op sample or implement their own native key-state sampler.

## Commit Reference

In this repo, the shortcut creator work was placed in:

```text
5b6cf8b fix: support Windows-key dictation hotkeys
```

That commit combines:

- Windows-key polling for global dictation shortcuts.
- Runtime suspension while recording a replacement shortcut.
- Native shortcut sampling for the recorder.
- Auto-confirm on key release.
