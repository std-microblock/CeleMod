//! Native operating-system dialogs.
//!
//! Startup failures happen before (or instead of) the first window, so the
//! fallback must not depend on the webview: an in-app error page cannot be
//! rendered when the webview runtime, a plugin or the window creation itself
//! failed. All messages are also written to the log file.

/// Shows a blocking error dialog. Returns `true` when the user picked "是/Yes".
pub(crate) fn confirm(title: &str, message: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winuser::{IDYES, MB_ICONERROR, MB_SETFOREGROUND, MB_YESNO};

        return windows_message_box(title, message, MB_YESNO | MB_ICONERROR | MB_SETFOREGROUND)
            == IDYES;
    }
    #[cfg(not(target_os = "windows"))]
    {
        error(title, message);
        false
    }
}

/// Shows a blocking error dialog with a single "确定/OK" button.
pub(crate) fn error(title: &str, message: &str) {
    #[cfg(target_os = "windows")]
    {
        use winapi::um::winuser::{MB_ICONERROR, MB_OK, MB_SETFOREGROUND};

        windows_message_box(title, message, MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display alert \"{}\" message \"{}\" as critical",
            escape_applescript(title),
            escape_applescript(message)
        );
        if let Err(error) = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()
        {
            crate::logging::error(format_args!("{title}: {message} (osascript: {error})"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let shown = std::process::Command::new("zenity")
            .args([
                "--error",
                &format!("--title={title}"),
                &format!("--text={message}"),
            ])
            .status()
            .is_ok();
        if !shown {
            let _ = std::process::Command::new("kdialog")
                .args(["--error", message, "--title", title])
                .status();
        }
        crate::logging::error(format_args!("{title}: {message}"));
    }
    #[cfg(not(any(windows, unix)))]
    {
        crate::logging::error(format_args!("{title}: {message}"));
    }
}

#[cfg(target_os = "windows")]
fn windows_message_box(title: &str, message: &str, flags: u32) -> i32 {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winuser::MessageBoxW;

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let message = wide(message);
    let title = wide(title);
    // SAFETY: both strings are null-terminated and remain alive for the call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            flags,
        )
    }
}

#[cfg(target_os = "macos")]
fn escape_applescript(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}
