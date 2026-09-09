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

pub fn settings(buttons: Option<bool>, joystick: Option<bool>) -> anyhow::Result<serde_json::Value> {
    let handle = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?;
    Ok(if let (Some(buttons), Some(joystick)) = (buttons, joystick) {
        handle.run_mobile_plugin("configure", serde_json::json!({"buttons": buttons, "joystick": joystick}))?
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
    progress(format!("{step}: Android CoreCLR MiniInstaller"), 0.0);
    let _: serde_json::Value = RUNTIME.get().ok_or_else(|| anyhow::anyhow!("Android runtime is not initialized"))?
        .run_mobile_plugin("installEverest", serde_json::json!({"path": path.to_string_lossy()}))?;
    progress(step.into(), 100.0);
    Ok(())
}
