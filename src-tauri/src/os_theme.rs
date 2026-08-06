/// Colour macOS paints the window chrome with, so the app's own top and bottom
/// bars can match it instead of approximating with a theme value.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn os_window_background() -> Option<String> {
    use objc2_app_kit::{NSColor, NSColorSpace};

    let color = unsafe { NSColor::windowBackgroundColor() };
    let srgb = unsafe { color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) }?;
    let (r, g, b) = unsafe {
        (
            srgb.redComponent(),
            srgb.greenComponent(),
            srgb.blueComponent(),
        )
    };
    Some(format!(
        "rgb({}, {}, {})",
        (r * 255.0).round() as u8,
        (g * 255.0).round() as u8,
        (b * 255.0).round() as u8
    ))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn os_window_background() -> Option<String> {
    None
}
