//! Android owns execution. Desktop PE/ELF launchers must never be spawned here.
use std::{path::{Path, PathBuf}, sync::OnceLock};
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Wry};

static RUNTIME: OnceLock<PluginHandle<Wry>> = OnceLock::new();
static GAME_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub fn can_install() -> anyhow::Result<()> {
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("canInstall", ())?;
    Ok(())
}

pub fn read_log(source: &str) -> anyhow::Result<crate::log_viewer::LogSnapshot> {
    // Never accept a frontend-supplied filesystem path or expose Steam IPC/vault files.
    let path = match source {
        "app" => crate::logging::path().to_path_buf(),
        "game" | "installer" => {
            let root = GAME_ROOT.get().and_then(|root| root.parent())
                .ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?;
            root.join("logs").join(format!("{source}.log"))
        }
        _ => anyhow::bail!("Unknown log source"),
    };
    Ok(crate::log_viewer::read(&path)?)
}

pub fn open_url(url: &str) -> anyhow::Result<()> {
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("openUrl", serde_json::json!({"url": url}))?;
    Ok(())
}

// Call from a blocking worker, not a synchronous WebView IPC handler.
pub fn game_running() -> anyhow::Result<bool> {
    let result: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("gameState", ())?;
    result["running"].as_bool().ok_or_else(|| anyhow::anyhow!("Android game state is unavailable"))
}

pub fn open_miaonet_auth(url: &str) -> anyhow::Result<()> {
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("openMiaoNetAuth", serde_json::json!({"url": url}))?;
    Ok(())
}

pub fn finish_miaonet_auth() -> anyhow::Result<()> {
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("finishMiaoNetAuth", ())?;
    Ok(())
}

pub fn pick_package() -> anyhow::Result<serde_json::Value> {
    Ok(RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("pickPackage", ())?)
}

pub fn steam(request: serde_json::Value) -> anyhow::Result<serde_json::Value> {
    Ok(RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("steam", request)?)
}

pub fn settings(joystick: Option<bool>, game_rumble: Option<bool>) -> anyhow::Result<serde_json::Value> {
    let handle = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?;
    Ok(if joystick.is_some() || game_rumble.is_some() {
        handle.run_mobile_plugin("configure", serde_json::json!({"joystick": joystick, "gameRumble": game_rumble}))?
    } else { handle.run_mobile_plugin("info", ())? })
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("celeste-runtime").setup(|_, api| {
        let handle = api.register_android_plugin("com.celemod.runtime", "RuntimePlugin")?;
        let info: serde_json::Value = handle.run_mobile_plugin("info", ())?;
        if let Some(root) = info["gameRoot"].as_str() { let _ = GAME_ROOT.set(root.into()); }
        let _ = RUNTIME.set(handle);
        Ok(())
    }).build()
}

pub fn game_dirs() -> Vec<PathBuf> {
    GAME_ROOT.get().into_iter().flat_map(|root| std::fs::read_dir(root).into_iter().flatten())
        .filter_map(Result::ok).map(|e| e.path())
        .filter(|p| !p.file_name().is_some_and(|name| {
            let name = name.to_string_lossy();
            name.starts_with("Steam-") && name.contains(".download-")
        }))
        .filter(|p| p.join("Celeste.exe").is_file() || p.join("Celeste.dll").is_file()).collect()
}

pub fn launch(path: &str, origin: bool, legacy_loader: bool) -> anyhow::Result<()> {
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("launch", serde_json::json!({"path": path, "origin": origin, "legacyLoader": legacy_loader}))?;
    Ok(())
}

pub fn install_everest(path: &Path, step: &str, progress: &mut dyn FnMut(String, f32)) -> anyhow::Result<()> {
    use std::{sync::mpsc, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
    let runtime = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?;
    let request_id = format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos());
    let logs = GAME_ROOT.get().and_then(|p| p.parent()).ok_or_else(|| anyhow::anyhow!("Missing Android game root"))?.join("logs");
    let start = Instant::now();
    let mut state = crate::installer_progress::InstallerProgress::default();
    let mut log = String::new();
    progress(format!("{step}: {}", state.status("", 0)), -1.0);
    let result = std::thread::scope(|scope| {
        let (tx, rx) = mpsc::sync_channel(1);
        let request_id = &request_id;
        scope.spawn(move || {
            let result = runtime.run_mobile_plugin::<serde_json::Value>("installEverest",
                serde_json::json!({"path": path.to_string_lossy(), "requestId": request_id}));
            let _ = tx.send(result);
        });
        loop {
            let result = rx.recv_timeout(Duration::from_secs(1));
            // Do not expose the previous install's success/errors before this run starts.
            if std::fs::read_to_string(logs.join("installer-session")).ok().as_deref() == Some(request_id.as_str()) {
                if let Ok(snapshot) = crate::log_viewer::read(&logs.join("installer.log")) { log = snapshot.content; }
            }
            match result {
                Ok(result) => break result.map(|_| ()).map_err(anyhow::Error::from),
                Err(mpsc::RecvTimeoutError::Disconnected) => break Err(anyhow::anyhow!("Android installer worker disconnected")),
                Err(mpsc::RecvTimeoutError::Timeout) => progress(format!("{step}: {}", state.status(&log, start.elapsed().as_secs())), -1.0),
            }
        }
    });
    if let Err(error) = result {
        let mut tail: Vec<_> = log.lines().rev().take(45).collect();
        tail.reverse();
        anyhow::bail!("{error}\n{}", tail.join("\n"));
    }
    progress(step.into(), 100.0);
    Ok(())
}
