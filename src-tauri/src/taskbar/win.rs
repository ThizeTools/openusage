//! Win32 side of the taskbar widget. Runs on its own thread with its own
//! message loop, so a busy Tauri main thread never stalls Explorer.

use super::{lock_state, paint};
use std::cell::RefCell;
use std::ptr::{null, null_mut};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicI8, AtomicIsize, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
use windows_sys::Win32::UI::Controls::*;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

const WM_APP_NOTIFY: u32 = WM_APP + 1;
const TICK_TIMER: usize = 1;
const CMD_SHOW: usize = 1;
const CMD_SETTINGS: usize = 2;
const CMD_HIDE: usize = 3;
const CMD_QUIT: usize = 4;

static APP: OnceLock<AppHandle> = OnceLock::new();
static HOST: AtomicIsize = AtomicIsize::new(0);
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
/// Last taskbar theme reported to the frontend: -1 unknown, 0 dark, 1 light.
static LAST_THEME: AtomicI8 = AtomicI8::new(-1);
const APPEARANCE_EVENT: &str = "menubar:appearance";

#[derive(Clone)]
struct Win {
    taskbar: HWND,
    widget: HWND,
    tooltip: HWND,
    tip_text: Vec<u16>,
    size: (i32, i32),
    pos: Option<i32>,
    dpi: u32,
    light: bool,
}

thread_local! {
    static WIN: RefCell<Option<Win>> = const { RefCell::new(None) };
}

fn wide_z(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn win() -> Option<Win> {
    WIN.with(|w| w.borrow().clone())
}

fn set_win(value: Option<Win>) {
    WIN.with(|w| *w.borrow_mut() = value);
}

pub fn start(app: AppHandle) {
    if APP.set(app).is_err() {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("taskbar-widget".into())
        .spawn(|| unsafe { run() });
    if let Err(error) = spawned {
        log::error!("taskbar: failed to start widget thread: {error}");
    }
}

/// Wakes the widget thread to apply new state (payload / enabled).
pub fn notify() {
    let host = HOST.load(Ordering::SeqCst);
    if host != 0 {
        unsafe { PostMessageW(host as HWND, WM_APP_NOTIFY, 0, 0) };
    }
}

unsafe fn register_class(name: &[u16], proc_: WNDPROC) {
    let wc = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        lpfnWndProc: proc_,
        hInstance: unsafe { GetModuleHandleW(null()) },
        hCursor: unsafe { LoadCursorW(null_mut(), IDC_ARROW) },
        lpszClassName: name.as_ptr(),
        ..unsafe { std::mem::zeroed() }
    };
    unsafe { RegisterClassExW(&wc) };
}

unsafe fn run() {
    let host_class = wide_z("OpenUsageTaskbarHost");
    let widget_class = wide_z("OpenUsageTaskbarWidget");
    unsafe {
        let icc = INITCOMMONCONTROLSEX {
            dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
            dwICC: ICC_WIN95_CLASSES,
        };
        InitCommonControlsEx(&icc);
        register_class(&host_class, Some(host_proc));
        register_class(&widget_class, Some(widget_proc));
        let title = wide_z("OpenUsage Taskbar");
        let host = CreateWindowExW(
            WS_EX_TOOLWINDOW, host_class.as_ptr(), title.as_ptr(), WS_POPUP,
            0, 0, 0, 0, null_mut(), null_mut(), GetModuleHandleW(null()), null(),
        );
        if host.is_null() {
            log::error!("taskbar: failed to create host window");
            return;
        }
        HOST.store(host as isize, Ordering::SeqCst);
        log::info!("taskbar: widget thread started");
        TASKBAR_CREATED.store(RegisterWindowMessageW(wide_z("TaskbarCreated").as_ptr()), Ordering::SeqCst);
        SetTimer(host, TICK_TIMER, 1000, None);
        sync();
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

unsafe extern "system" fn host_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TIMER if wparam == TICK_TIMER => tick(),
            WM_APP_NOTIFY => sync(),
            m if m != 0 && m == TASKBAR_CREATED.load(Ordering::SeqCst) => {
                destroy();
                sync();
            }
            _ => return DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
    0
}

unsafe extern "system" fn widget_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_MOUSEMOVE => {
                let was_hover = std::mem::replace(&mut lock_state().hover, true);
                if !was_hover {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    TrackMouseEvent(&mut tme);
                    repaint();
                }
                0
            }
            WM_MOUSELEAVE => {
                lock_state().hover = false;
                repaint();
                0
            }
            WM_LBUTTONUP => {
                on_left_click(hwnd);
                0
            }
            WM_RBUTTONUP => {
                show_menu();
                0
            }
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

/// Applies `enabled` and repaints with the latest payload.
unsafe fn sync() {
    let enabled = lock_state().enabled;
    log::debug!("taskbar: sync enabled={enabled}");
    let alive = win().is_some_and(|w| unsafe { IsWindow(w.widget) != 0 });
    unsafe {
        if !enabled {
            destroy();
            return;
        }
        if !alive {
            destroy();
            create();
        }
        repaint();
        reposition(true);
    }
}

/// Once a second: recreate after Explorer restarts, follow tray width,
/// taskbar height, DPI and theme changes.
unsafe fn tick() {
    if !lock_state().enabled {
        return;
    }
    let Some(w) = win() else {
        unsafe { create() };
        return;
    };
    unsafe {
        if IsWindow(w.widget) == 0 || IsWindow(w.taskbar) == 0 {
            destroy();
            create();
            return;
        }
        let mut rc: RECT = std::mem::zeroed();
        GetClientRect(w.taskbar, &mut rc);
        if rc.bottom - rc.top != w.size.1 || dpi_of(w.taskbar) != w.dpi || read_light_taskbar() != w.light {
            repaint();
        }
        reposition(false);
    }
}

unsafe fn create() {
    unsafe {
        let taskbar = FindWindowW(wide_z("Shell_TrayWnd").as_ptr(), null());
        if taskbar.is_null() || FindWindowExW(taskbar, null_mut(), wide_z("TrayNotifyWnd").as_ptr(), null()).is_null() {
            log::debug!("taskbar: Shell_TrayWnd/TrayNotifyWnd not found");
            return;
        }
        let mut bar: RECT = std::mem::zeroed();
        GetWindowRect(taskbar, &mut bar);
        if bar.bottom - bar.top > bar.right - bar.left {
            return; // vertical taskbar: not supported, tray icon remains
        }
        let hinst = GetModuleHandleW(null());
        let widget_class = wide_z("OpenUsageTaskbarWidget");
        let widget = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_NOACTIVATE, widget_class.as_ptr(), null(), WS_CHILD | WS_CLIPSIBLINGS,
            0, 0, 1, 1, taskbar, null_mut(), hinst, null(),
        );
        if widget.is_null() {
            log::warn!("taskbar: failed to create widget window (error {})", GetLastError());
            return;
        }
        let host = HOST.load(Ordering::SeqCst) as HWND;
        let tooltip = CreateWindowExW(
            WS_EX_TOPMOST, wide_z("tooltips_class32").as_ptr(), null(), WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX,
            CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, host, null_mut(), hinst, null(),
        );
        let mut tip_text = wide_z("OpenUsage");
        if !tooltip.is_null() {
            let mut ti = tool_info(host, widget, &mut tip_text);
            SendMessageW(tooltip, TTM_ADDTOOLW, 0, &mut ti as *mut _ as LPARAM);
            SendMessageW(tooltip, TTM_SETMAXTIPWIDTH, 0, 600);
        }
        log::info!("taskbar: widget created");
        set_win(Some(Win { taskbar, widget, tooltip, tip_text, size: (0, 0), pos: None, dpi: 96, light: false }));
        repaint();
        reposition(true);
        ShowWindow(widget, SW_SHOWNOACTIVATE);
    }
}

unsafe fn destroy() {
    let Some(w) = win() else { return };
    set_win(None);
    lock_state().hover = false;
    unsafe {
        if !w.tooltip.is_null() && IsWindow(w.tooltip) != 0 {
            DestroyWindow(w.tooltip);
        }
        if IsWindow(w.widget) != 0 {
            DestroyWindow(w.widget);
        }
    }
}

fn tool_info(host: HWND, widget: HWND, text: &mut [u16]) -> TTTOOLINFOW {
    TTTOOLINFOW {
        cbSize: std::mem::size_of::<TTTOOLINFOW>() as u32,
        uFlags: TTF_IDISHWND | TTF_SUBCLASS,
        hwnd: host,
        uId: widget as usize,
        lpszText: text.as_mut_ptr(),
        ..Default::default()
    }
}

unsafe fn dpi_of(hwnd: HWND) -> u32 {
    match unsafe { GetDpiForWindow(hwnd) } {
        0 => 96,
        dpi => dpi,
    }
}

/// Whether the taskbar uses the light theme (it is separate from the apps' theme).
pub fn taskbar_is_light() -> bool {
    unsafe { read_light_taskbar() }
}

/// Tells the frontend when the taskbar theme changed so it re-renders the widget in matching colors.
fn report_theme(light: bool) {
    let value = i8::from(light);
    if LAST_THEME.swap(value, Ordering::SeqCst) == value {
        return;
    }
    if let Some(app) = APP.get() {
        if let Err(error) = app.emit(APPEARANCE_EVENT, if light { "light" } else { "dark" }) {
            log::warn!("taskbar: failed to emit appearance: {error}");
        }
    }
}

unsafe fn read_light_taskbar() -> bool {
    let key = wide_z(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let name = wide_z("SystemUsesLightTheme");
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD,
            null_mut(), &mut value as *mut u32 as *mut core::ffi::c_void, &mut size,
        )
    };
    status == ERROR_SUCCESS && value != 0
}

/// Redraws with the latest payload and syncs the tooltip text.
unsafe fn repaint() {
    let Some(mut w) = win() else { return };
    let (payload, hover) = {
        let state = lock_state();
        (state.payload.clone(), state.hover)
    };
    unsafe {
        let mut rc: RECT = std::mem::zeroed();
        GetClientRect(w.taskbar, &mut rc);
        let height = (rc.bottom - rc.top).max(1);
        w.dpi = dpi_of(w.taskbar);
        w.light = read_light_taskbar();
        report_theme(w.light);
        let frame = paint::render(payload.as_ref(), height, w.dpi, w.light, hover);
        paint::present(w.widget, &frame);
        w.size = (frame.w, frame.h);

        let tip = payload.map(|p| p.tooltip).filter(|t| !t.is_empty()).unwrap_or_else(|| "OpenUsage".into());
        let tip_text = wide_z(&tip);
        if tip_text != w.tip_text && !w.tooltip.is_null() {
            w.tip_text = tip_text;
            let host = HOST.load(Ordering::SeqCst) as HWND;
            let mut ti = tool_info(host, w.widget, &mut w.tip_text);
            SendMessageW(w.tooltip, TTM_UPDATETIPTEXTW, 0, &mut ti as *mut _ as LPARAM);
        }
    }
    let size_changed = win().is_some_and(|old| old.size != w.size);
    set_win(Some(w));
    if size_changed {
        unsafe { reposition(true) };
    }
}

/// Left edge of the stack of other apps' taskbar widgets (child windows of
/// the taskbar owned by other processes, e.g. Wireless Battery Monitor) that
/// sit left of the tray, so ours goes beside them instead of on top.
unsafe fn stacked_edge(taskbar: HWND, own: HWND, tray_left: i32, slack: i32) -> i32 {
    let mut explorer_pid = 0u32;
    unsafe { GetWindowThreadProcessId(taskbar, &mut explorer_pid) };
    let own_pid = std::process::id();
    let mut rects: Vec<RECT> = Vec::new();
    let mut child = unsafe { GetWindow(taskbar, GW_CHILD) };
    while !child.is_null() {
        unsafe {
            if child != own && IsWindowVisible(child) != 0 {
                let mut pid = 0u32;
                GetWindowThreadProcessId(child, &mut pid);
                if pid != explorer_pid && pid != own_pid {
                    let mut r: RECT = std::mem::zeroed();
                    GetWindowRect(child, &mut r);
                    if r.right > r.left {
                        rects.push(r);
                    }
                }
            }
            child = GetWindow(child, GW_HWNDNEXT);
        }
    }
    let mut edge = tray_left;
    // Each step moves the edge strictly left, so this ends.
    while let Some(r) = rects.iter().find(|r| r.left < edge && r.right >= edge - slack) {
        edge = r.left;
    }
    edge
}

/// Keeps the widget just left of the notification area (and of other apps'
/// widgets docked there).
unsafe fn reposition(force: bool) {
    let Some(mut w) = win() else { return };
    unsafe {
        let tray = FindWindowExW(w.taskbar, null_mut(), wide_z("TrayNotifyWnd").as_ptr(), null());
        if tray.is_null() {
            return;
        }
        let (mut tray_rc, mut bar_rc): (RECT, RECT) = (std::mem::zeroed(), std::mem::zeroed());
        GetWindowRect(tray, &mut tray_rc);
        GetWindowRect(w.taskbar, &mut bar_rc);
        let edge = stacked_edge(w.taskbar, w.widget, tray_rc.left, w.dpi as i32 * 8 / 96);
        let mut p = POINT { x: edge, y: bar_rc.top };
        ScreenToClient(w.taskbar, &mut p);
        let left = p.x - w.size.0 - w.dpi as i32 * 2 / 96;
        let covered = !GetWindow(w.widget, GW_HWNDPREV).is_null();
        if force || covered || w.pos != Some(left) {
            SetWindowPos(w.widget, HWND_TOP, left, 0, w.size.0, w.size.1, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            w.pos = Some(left);
            WIN.with(|cell| {
                if let Some(cur) = cell.borrow_mut().as_mut() {
                    cur.pos = w.pos;
                }
            });
        }
    }
}

unsafe fn on_left_click(widget: HWND) {
    let mut r: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetWindowRect(widget, &mut r) };
    run_on_main(move |app| {
        crate::panel::toggle_panel_at_anchor(app, r.left, r.top, r.right - r.left, r.bottom - r.top)
    });
}

unsafe fn show_menu() {
    let host = HOST.load(Ordering::SeqCst) as HWND;
    let anchor = win().map(|w| {
        let mut r: RECT = unsafe { std::mem::zeroed() };
        unsafe { GetWindowRect(w.widget, &mut r) };
        r
    });
    unsafe {
        let menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, CMD_SHOW, wide_z("Show Stats").as_ptr());
        AppendMenuW(menu, MF_STRING, CMD_SETTINGS, wide_z("Settings").as_ptr());
        AppendMenuW(menu, MF_STRING, CMD_HIDE, wide_z("Hide Taskbar Widget").as_ptr());
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        AppendMenuW(menu, MF_STRING, CMD_QUIT, wide_z("Quit").as_ptr());
        SetForegroundWindow(host);
        let mut pt = POINT { x: 0, y: 0 };
        GetCursorPos(&mut pt);
        let cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, pt.x, pt.y, 0, host, null());
        DestroyMenu(menu);
        PostMessageW(host, WM_NULL, 0, 0);
        match cmd as usize {
            CMD_SHOW => run_on_main(move |app| match anchor {
                Some(r) => crate::panel::show_panel_at_anchor(app, r.left, r.top, r.right - r.left, r.bottom - r.top),
                None => crate::panel::show_panel(app),
            }),
            CMD_SETTINGS => run_on_main(|app| crate::settings_window::open(app)),
            CMD_HIDE => run_on_main(|app| crate::widget::set_widget_visible(app, false)),
            CMD_QUIT => run_on_main(|app| app.exit(0)),
            _ => {}
        }
    }
}

fn run_on_main(f: impl FnOnce(&AppHandle) + Send + 'static) {
    let Some(app) = APP.get() else { return };
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || f(&handle)) {
        log::error!("taskbar: failed to dispatch to main thread: {error}");
    }
}
