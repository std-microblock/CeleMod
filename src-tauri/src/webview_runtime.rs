/// Checks the platform webview before Tauri creates its first window.
///
/// This is especially important for the standalone Windows executable: a
/// machine without the WebView2 Runtime cannot render an in-app error page, so
/// the fallback must use native operating-system UI instead.
pub(crate) fn ensure_available() -> bool {
    match tauri::webview_version() {
        Ok(version) => {
            crate::logging::info(format_args!("System webview runtime: {version}"));
            true
        }
        Err(error) => {
            crate::logging::error(format_args!(
                "System webview runtime is unavailable: {error}"
            ));
            show_missing_runtime_prompt();
            false
        }
    }
}

#[cfg(target_os = "windows")]
fn show_missing_runtime_prompt() {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winuser::{IDYES, MB_ICONERROR, MB_SETFOREGROUND, MB_YESNO, MessageBoxW};

    const DOWNLOAD_URL: &str =
        "https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section";
    let title = wide("CeleMod - 缺少 WebView2 Runtime");
    let message = wide(
        "CeleMod 需要 Microsoft Edge WebView2 Runtime 才能运行。\n\n是否打开微软官方下载页面？安装完成后请重新启动 CeleMod。",
    );

    // SAFETY: Both strings are null-terminated and remain alive for the call.
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONERROR | MB_SETFOREGROUND,
        )
    };
    if result == IDYES
        && let Err(error) = open::that(DOWNLOAD_URL)
    {
        crate::logging::error(format_args!(
            "Failed to open the WebView2 download page: {error}"
        ));
    }

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}

#[cfg(target_os = "macos")]
fn show_missing_runtime_prompt() {
    const MESSAGE: &str = "CeleMod 无法初始化系统 WKWebView。请更新 macOS 后重试。";
    let status = std::process::Command::new("osascript")
        .args([
            "-e",
            &format!("display alert \"CeleMod 无法启动\" message \"{MESSAGE}\" as critical"),
        ])
        .status();
    if status.is_err() {
        crate::logging::error(format_args!("{MESSAGE}"));
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn show_missing_runtime_prompt() {
    const MESSAGE: &str = "CeleMod 无法初始化 WebKitGTK。请安装系统的 WebKitGTK 4.1 运行库后重试。";

    let shown = std::process::Command::new("zenity")
        .args([
            "--error",
            "--title=CeleMod 无法启动",
            &format!("--text={MESSAGE}"),
        ])
        .status()
        .is_ok();
    if !shown {
        let _ = std::process::Command::new("kdialog")
            .args(["--error", MESSAGE, "--title", "CeleMod 无法启动"])
            .status();
    }
    crate::logging::error(format_args!("{MESSAGE}"));
}

#[cfg(not(any(windows, unix)))]
fn show_missing_runtime_prompt() {
    crate::logging::error(format_args!(
        "CeleMod cannot initialize the system webview runtime."
    ));
}
