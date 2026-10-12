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

/// Evergreen Bootstrapper (~2 MB) of the WebView2 Runtime.
///
/// The download section page only lists the installers, so users tend to grab
/// the wrong one; this link downloads the bootstrapper directly.
#[cfg(target_os = "windows")]
const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

#[cfg(target_os = "windows")]
fn show_missing_runtime_prompt() {
    use crate::native_dialog;

    const TITLE: &str = "CeleMod - 缺少 WebView2 Runtime";
    let message = format!(
        "CeleMod 需要 Microsoft Edge WebView2 Runtime 才能运行。\n\n\
         点「是」自动下载并安装微软官方安装包（约 2 MB，需要联网），\n\
         装完再重新打开 CeleMod 即可。\n\n\
         日志：{}",
        crate::logging::path().display()
    );

    if !native_dialog::confirm(TITLE, &message) {
        return;
    }
    if let Err(error) = install_missing_runtime() {
        crate::logging::error(format_args!(
            "Failed to start the WebView2 installer: {error}"
        ));
        native_dialog::error(
            TITLE,
            "没能自动下载安装包，已为你打开微软官方下载页面。安装完成后请重新启动 CeleMod。",
        );
    }
}

/// Downloads the official bootstrapper and starts it; falls back to opening the
/// download link in the browser when anything in between fails.
#[cfg(target_os = "windows")]
fn install_missing_runtime() -> Result<(), String> {
    use std::io::Write as _;

    let setup = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    let download = || -> Result<(), String> {
        let response = ::ureq::get(WEBVIEW2_BOOTSTRAPPER_URL)
            .timeout(std::time::Duration::from_secs(120))
            .call()
            .map_err(|error| error.to_string())?;
        let mut file = std::fs::File::create(&setup).map_err(|error| error.to_string())?;
        std::io::copy(&mut response.into_reader(), &mut file).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        Ok(())
    };
    let start = || {
        std::process::Command::new(&setup)
            .args(["/silent", "/install"])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    };

    match download().and_then(|()| start()) {
        Ok(()) => {
            crate::logging::info(format_args!(
                "Started the WebView2 bootstrapper from {}",
                setup.display()
            ));
            Ok(())
        }
        Err(error) => {
            crate::logging::warn(format_args!(
                "WebView2 bootstrap failed ({error}); opening the download page instead"
            ));
            open::that(WEBVIEW2_BOOTSTRAPPER_URL)
                .map_err(|open_error| format!("{error}; {open_error}"))
        }
    }
}

#[cfg(target_os = "macos")]
fn show_missing_runtime_prompt() {
    crate::native_dialog::error(
        "CeleMod 无法启动",
        "CeleMod 无法初始化系统 WKWebView。请更新 macOS 后重试。",
    );
}

#[cfg(all(unix, not(target_os = "macos")))]
fn show_missing_runtime_prompt() {
    crate::native_dialog::error(
        "CeleMod 无法启动",
        "CeleMod 无法初始化 WebKitGTK。请安装系统的 WebKitGTK 4.1 运行库后重试。",
    );
}

#[cfg(not(any(windows, unix)))]
fn show_missing_runtime_prompt() {
    crate::logging::error(format_args!(
        "CeleMod cannot initialize the system webview runtime."
    ));
}
