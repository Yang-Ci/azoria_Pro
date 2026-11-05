//! X11 pointer location and input shape for the transparent island window.
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use eframe::egui;
use std::ffi::{c_char, c_int, c_uint, c_ulong, c_void};

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct Rectangle { x: i16, y: i16, width: u16, height: u16 }

#[link(name = "X11")]
unsafe extern "C" {
    fn XOpenDisplay(name: *const c_char) -> *mut c_void;
    fn XCloseDisplay(display: *mut c_void) -> c_int;
    fn XDefaultRootWindow(display: *mut c_void) -> c_ulong;
    fn XQueryPointer(display: *mut c_void, window: c_ulong, root: *mut c_ulong,
        child: *mut c_ulong, root_x: *mut c_int, root_y: *mut c_int,
        win_x: *mut c_int, win_y: *mut c_int, mask: *mut c_uint) -> c_int;
    fn XFlush(display: *mut c_void) -> c_int;
    fn XInternAtom(display: *mut c_void, name: *const c_char, only_if_exists: c_int) -> c_ulong;
    fn XChangeProperty(display: *mut c_void, window: c_ulong, property: c_ulong, kind: c_ulong,
        format: c_int, mode: c_int, data: *const u8, count: c_int) -> c_int;
}
#[link(name = "Xext")]
unsafe extern "C" {
    fn XShapeCombineRectangles(display: *mut c_void, window: c_ulong, kind: c_int,
        x: c_int, y: c_int, rects: *mut Rectangle, count: c_int, op: c_int, ordering: c_int);
}

pub struct Window { display: *mut c_void, window: c_ulong, last: Vec<Rectangle> }
impl Window {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Option<Self> {
        let window = match cc.window_handle().ok()?.as_raw() {
            RawWindowHandle::Xlib(handle) => handle.window,
            RawWindowHandle::Xcb(handle) => handle.window.get() as c_ulong,
            _ => return None,
        };
        let display = unsafe { XOpenDisplay(std::ptr::null()) };
        if display.is_null() { return None; }
        // egui-winit currently applies `with_taskbar(false)` only on Windows.
        // Set the X11 EWMH hints before mapping so GNOME does not add another dock entry.
        unsafe {
            let state = XInternAtom(display, c"_NET_WM_STATE".as_ptr(), 0);
            let hints = [XInternAtom(display, c"_NET_WM_STATE_SKIP_TASKBAR".as_ptr(), 0),
                XInternAtom(display, c"_NET_WM_STATE_SKIP_PAGER".as_ptr(), 0),
                XInternAtom(display, c"_NET_WM_STATE_ABOVE".as_ptr(), 0)];
            XChangeProperty(display, window, state, 4, 32, 2, hints.as_ptr().cast(), hints.len() as c_int);
            XFlush(display);
        }
        Some(Self { display, window, last: Vec::new() })
    }
    pub fn cursor(&self, scale: f32) -> Option<(f32, f32)> {
        let (mut root, mut child, mut x, mut y, mut wx, mut wy, mut mask) = (0, 0, 0, 0, 0, 0, 0);
        let ok = unsafe { XQueryPointer(self.display, XDefaultRootWindow(self.display), &mut root,
            &mut child, &mut x, &mut y, &mut wx, &mut wy, &mut mask) };
        (ok != 0).then_some((x as f32 / scale, y as f32 / scale))
    }
    pub fn update(&mut self, hit: egui::Rect, notice: Option<egui::Rect>, scale: f32) {
        let rect = |r: egui::Rect| Rectangle {
            x: (r.left() * scale).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16,
            y: (r.top() * scale).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16,
            width: (r.width() * scale).round().clamp(0.0, u16::MAX as f32) as u16,
            height: (r.height() * scale).round().clamp(0.0, u16::MAX as f32) as u16,
        };
        let mut rects = vec![rect(hit)];
        if let Some(notice) = notice { rects.push(rect(notice)); }
        if self.last != rects {
            unsafe { XShapeCombineRectangles(self.display, self.window, 2, 0, 0,
                rects.as_mut_ptr(), rects.len() as c_int, 0, 0); XFlush(self.display); }
            self.last = rects;
        }
    }
}
impl Drop for Window { fn drop(&mut self) { unsafe { XCloseDisplay(self.display); } } }
