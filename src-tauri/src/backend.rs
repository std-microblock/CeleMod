use serde::{Deserialize, Serialize};

use anyhow::{Context, bail};
use dirs;
use everest::get_mod_cached_new;
use game_scanner::prelude::Game;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use ureq::DownloadCallbackInfo;

static TEST_MODE: AtomicBool = AtomicBool::new(false);

fn is_test_mode() -> bool {
    TEST_MODE.load(Ordering::Relaxed)
}

fn get_test_game_path() -> PathBuf {
    let path = std::env::temp_dir().join("celemod_test_game");
    let _ = std::fs::create_dir_all(path.join("Mods"));
    #[cfg(windows)]
    let _ = std::fs::write(path.join("Celeste.exe"), b"");
    #[cfg(unix)]
    let _ = std::fs::write(path.join("Celeste"), b"");
    path
}

extern crate lazy_static;

lazy_static::lazy_static! {
    static ref DOWNLOAD_CANCEL_FLAGS: Mutex<HashMap<String, Arc<AtomicBool>>> = Mutex::new(HashMap::new());
    static ref DOWNLOAD_DESTINATION_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> = Mutex::new(HashMap::new());
}

#[path = "blacklist.rs"]
mod blacklist;
#[path = "everest.rs"]
mod everest;
#[path = "ureq.rs"]
mod ureq;
#[path = "wegfan.rs"]
mod wegfan;

use tauri::ipc::Channel;

type IpcEvent = serde_json::Value;

fn send_event(channel: &Channel<IpcEvent>, args: Vec<IpcEvent>) {
    let _ = channel.send(IpcEvent::Array(args));
}

#[cfg(target_os = "macos")]
fn apply_macos_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

    apply_vibrancy(
        window,
        NSVisualEffectMaterial::Titlebar,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    )
    .map_err(|error| format!("failed to apply macOS vibrancy: {error}"))
}

#[cfg(target_os = "windows")]
fn set_legacy_windows_acrylic(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    use std::ffi::c_void;
    use winapi::{
        shared::{minwindef::BOOL, windef::HWND},
        um::libloaderapi::{GetModuleHandleA, GetProcAddress},
    };

    #[repr(C)]
    struct AccentPolicy {
        state: i32,
        flags: i32,
        gradient_color: u32,
        animation_id: i32,
    }

    #[repr(C)]
    struct WindowCompositionAttributeData {
        attribute: i32,
        data: *mut c_void,
        size: usize,
    }

    type SetWindowCompositionAttribute =
        unsafe extern "system" fn(HWND, *mut WindowCompositionAttributeData) -> BOOL;

    const WCA_ACCENT_POLICY: i32 = 19;
    const ACCENT_DISABLED: i32 = 0;
    const ACCENT_ENABLE_ACRYLIC_BLUR_BEHIND: i32 = 4;

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get the Windows window handle: {error}"))?
        .0 as HWND;

    unsafe {
        let user32 = GetModuleHandleA(c"user32.dll".as_ptr());
        if user32.is_null() {
            return Err("failed to load user32.dll".into());
        }

        let proc = GetProcAddress(user32, c"SetWindowCompositionAttribute".as_ptr());
        if proc.is_null() {
            return Err("SetWindowCompositionAttribute is unavailable".into());
        }

        let set_window_composition_attribute: SetWindowCompositionAttribute =
            std::mem::transmute(proc);
        let mut policy = AccentPolicy {
            state: if enabled {
                ACCENT_ENABLE_ACRYLIC_BLUR_BEHIND
            } else {
                ACCENT_DISABLED
            },
            flags: 0,
            // The alpha byte is the persistent dark mask used by the legacy UI.
            gradient_color: if enabled { 0x9905_0505 } else { 0 },
            animation_id: 0,
        };
        let mut data = WindowCompositionAttributeData {
            attribute: WCA_ACCENT_POLICY,
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };

        if set_window_composition_attribute(hwnd, &mut data) == 0 {
            return Err("SetWindowCompositionAttribute failed".into());
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::apply_mica;

    set_legacy_windows_acrylic(window, true).or_else(|acrylic_error| {
        apply_mica(window, Some(true)).map_err(|mica_error| {
            format!(
                "failed to apply Windows acrylic ({acrylic_error}); Mica fallback also failed: {mica_error}"
            )
        })
    })
}

#[cfg(target_os = "windows")]
fn clear_windows_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::{clear_acrylic, clear_mica};

    let legacy_acrylic_result = set_legacy_windows_acrylic(window, false);
    let mica_result = clear_mica(window);
    let acrylic_result = clear_acrylic(window);
    if legacy_acrylic_result.is_ok() || mica_result.is_ok() || acrylic_result.is_ok() {
        Ok(())
    } else {
        Err(format!(
            "failed to clear legacy Windows acrylic ({}); Mica cleanup failed ({}); modern acrylic cleanup also failed: {}",
            legacy_acrylic_result.unwrap_err(),
            mica_result.unwrap_err(),
            acrylic_result.unwrap_err()
        ))
    }
}

#[tauri::command]
fn set_window_vibrancy(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            apply_macos_vibrancy(&window)
        } else {
            window_vibrancy::clear_vibrancy(&window)
                .map(|_| ())
                .map_err(|error| format!("failed to clear macOS vibrancy: {error}"))
        }
    }

    #[cfg(target_os = "windows")]
    {
        if enabled {
            apply_windows_vibrancy(&window)
        } else {
            clear_windows_vibrancy(&window)
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled);
        Ok(())
    }
}

fn compare_version(a: &str, b: &str) -> i32 {
    let a_parts: Vec<&str> = a.split('.').collect();
    let b_parts: Vec<&str> = b.split('.').collect();
    for i in 0..std::cmp::max(a_parts.len(), b_parts.len()) {
        let a_part = a_parts.get(i).unwrap_or(&"0");
        let b_part = b_parts.get(i).unwrap_or(&"0");
        if a_part == b_part {
            continue;
        }
        if a_part.parse::<i32>().unwrap() > b_part.parse::<i32>().unwrap() {
            return 1;
        } else {
            return -1;
        }
    }
    0
}

fn read_mod_yaml_bytes(path: &Path) -> anyhow::Result<Vec<u8>> {
    let zipfile = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(zipfile)?;
    let everest_name = archive
        .file_names()
        .find(|name| name == &"everest.yaml" || name == &"everest.yml")
        .context("Failed to find everest.yaml")?
        .to_string();

    let mut file = archive
        .by_name(&everest_name)
        .context("Failed to get everest.yaml")?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn parse_mod_yaml(path: &Path) -> anyhow::Result<serde_yaml::Value> {
    use strip_bom::StripBom;
    let buffer = read_mod_yaml_bytes(path)?;
    Ok(serde_yaml::from_str(
        String::from_utf8(buffer)?.strip_bom(),
    )?)
}

fn extract_mod_for_yaml(path: &PathBuf) -> anyhow::Result<serde_yaml::Value> {
    use std::io::Write;
    use strip_bom::StripBom;

    let buffer = read_mod_yaml_bytes(path)?;
    let cache_dir = path
        .parent()
        .context("Mod archive has no parent folder")?
        .parent()
        .context("Mods folder has no parent folder")?
        .join("celemod_yaml_cache");
    std::fs::create_dir_all(&cache_dir)?;

    let mut file =
        std::fs::File::create(cache_dir.join(path.with_extension("yaml").file_name().unwrap()))?;
    file.write_all(&buffer)?;
    Ok(serde_yaml::from_str(
        String::from_utf8(buffer)?.strip_bom(),
    )?)
}

fn is_valid_zip_archive(path: &Path) -> bool {
    std::fs::File::open(path)
        .ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some()
}

fn get_invalid_zip_mod_files_sync(mods_folder_path: &str) -> Vec<String> {
    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|v| v.is_file()).unwrap_or(false))
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|v| v == "zip")
                .unwrap_or(false)
        })
        .filter(|entry| !is_valid_zip_archive(&entry.path()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

#[derive(Debug, Serialize, Clone)]
struct FullModCheckIssue {
    file: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct FullModCheckProgress {
    current: usize,
    total: usize,
    file: String,
    done: bool,
    issues: Vec<FullModCheckIssue>,
}

fn get_zip_mod_entries(mods_folder_path: &str) -> Vec<fs::DirEntry> {
    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|v| v.is_file()).unwrap_or(false))
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|v| v.eq_ignore_ascii_case("zip"))
                .unwrap_or(false)
        })
        .collect()
}

fn check_zip_mod_file_content(path: &Path) -> anyhow::Result<()> {
    let file = fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut buffer = vec![0_u8; 64 * 1024];

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
        }
    }

    Ok(())
}

fn check_all_mod_contents_sync(
    mods_folder_path: &str,
    progress_callback: &mut dyn FnMut(FullModCheckProgress),
) {
    let entries = get_zip_mod_entries(mods_folder_path);
    let total = entries.len();
    let mut issues = Vec::new();

    progress_callback(FullModCheckProgress {
        current: 0,
        total,
        file: String::new(),
        done: total == 0,
        issues: Vec::new(),
    });

    if total == 0 {
        return;
    }

    for (index, entry) in entries.into_iter().enumerate() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Err(err) = check_zip_mod_file_content(&path) {
            issues.push(FullModCheckIssue {
                file: file_name.clone(),
                error: format!("{err:#}"),
            });
        }

        progress_callback(FullModCheckProgress {
            current: index + 1,
            total,
            file: file_name,
            done: index + 1 == total,
            issues: if index + 1 == total {
                issues.clone()
            } else {
                Vec::new()
            },
        });
    }
}

fn delete_mod_files_sync(mods_folder_path: &str, file_names: &[String]) -> anyhow::Result<()> {
    for file_name in file_names {
        let safe_name = Path::new(file_name)
            .file_name()
            .context("Invalid mod file name")?;
        let path = Path::new(mods_folder_path).join(safe_name);
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

fn download_mod_archive_with_cancel(
    url: &str,
    dest: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let destination = Path::new(dest);
    let destination_lock = DOWNLOAD_DESTINATION_LOCKS
        .lock()
        .unwrap()
        .entry(dest.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _destination_guard = loop {
        match destination_lock.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::WouldBlock) => {
                if cancel_flag.load(Ordering::Relaxed) {
                    bail!("Download canceled");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(std::sync::TryLockError::Poisoned(error)) => break error.into_inner(),
        }
    };
    let mut temporary_name = destination.as_os_str().to_os_string();
    temporary_name.push(".celemod");
    let temporary = PathBuf::from(temporary_name);

    let result: anyhow::Result<()> = try {
        ureq::download_file_to_path_with_progress(
            url,
            temporary.to_string_lossy().as_ref(),
            progress_callback,
            multi_thread,
            cancel_flag,
        )?;

        if !is_valid_zip_archive(&temporary) {
            bail!("Downloaded file is not a valid zip archive");
        }

        if destination.exists() {
            std::fs::remove_file(destination)
                .with_context(|| format!("Failed to replace Mod archive at {dest}"))?;
        }
        std::fs::rename(&temporary, destination)
            .with_context(|| format!("Failed to finish Mod archive at {dest}"))?;
    };

    result
}

fn cleanup_mod_download_temp_files_impl(mods_dir: &Path) -> anyhow::Result<usize> {
    if !mods_dir.is_dir() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(mods_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !file_name.ends_with(".zip.celemod") {
            continue;
        }
        fs::remove_file(entry.path())?;
        removed += 1;
    }
    Ok(removed)
}

fn cleanup_game_mod_download_temp_files(game_path: &Path) -> anyhow::Result<usize> {
    cleanup_mod_download_temp_files_impl(&normalize_game_path_buf(game_path).join("Mods"))
}

#[derive(Debug, Serialize, Deserialize)]
struct ModDependency {
    name: String,
    version: String,
    optional: bool,
}
#[derive(Debug, Serialize, Deserialize)]
struct LocalMod {
    game_banana_id: i64,
    name: String,
    deps: Vec<ModDependency>,
    version: String,
    file: String,
    size: u64,
}

fn read_to_string_bom(path: &Path) -> anyhow::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let bytes = bytes
        .strip_prefix("\u{feff}".as_bytes())
        .unwrap_or(bytes.as_slice());
    Ok(String::from_utf8(bytes.to_vec())?)
}

fn parse_version(mod_version: &serde_yaml::Value) -> String {
    // 1. 处理数字类型 (如 YAML 中写 1.0)
    if let Some(f) = mod_version.as_f64() {
        return f.to_string();
    }

    // 2. 处理字符串类型
    let v_str = mod_version.as_str().unwrap_or("1.0.0");

    // 3. 去除前缀 (例如 "v0.3.3" -> "0.3.3")
    // 找到第一个数字出现的位置
    let start_idx = v_str.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    let trimmed = &v_str[start_idx..];

    // 4. 验证基本合法性
    // SemVer 允许数字、点、连字符和加号 (0.3.3-dev3+build1)
    if !trimmed.is_empty() && trimmed.chars().next().unwrap().is_ascii_digit() {
        trimmed.to_string()
    } else {
        "1.0.0".to_string()
    }
}

fn get_installed_mods_sync(mods_folder_path: String) -> Vec<LocalMod> {
    let mut mods = Vec::new();
    let mod_data = get_mod_cached_new().unwrap();

    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return mods;
    };

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        println!("Checking mod entry: {:?}", entry.file_name());
        let res: anyhow::Result<_> = try {
            if false {
                anyhow::Ok(())?
            }

            let yaml = if entry.file_type().context("invalid file type")?.is_dir() {
                let cache_path = entry.path().read_dir().unwrap().find(|v| {
                    v.as_ref()
                        .map(|v| {
                            let name = v.file_name().to_string_lossy().to_string().to_lowercase();
                            name == "everest.yaml" || name == "everest.yml"
                        })
                        .unwrap_or(false)
                });
                match cache_path {
                    Some(cache_path) => {
                        let cache_path = cache_path.unwrap().path();
                        read_to_string_bom(&cache_path)?
                    }
                    None => {
                        println!(
                            "[ WARNING ] Failed to find yaml, skipping {:?}",
                            entry.file_name()
                        );
                        continue;
                    }
                }
            } else if entry
                .path()
                .extension()
                .context("Unable to get the extension")?
                == "zip"
            {
                let cache_path = entry
                    .path()
                    .parent()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .join("celemod_yaml_cache")
                    .join(entry.path().with_extension("yaml").file_name().unwrap());

                let mod_date = entry.metadata().unwrap().modified().unwrap();
                let cache_date = cache_path.metadata().ok().map(|v| v.modified().unwrap());

                if !cache_path.exists() || cache_date.is_none() || cache_date.unwrap() < mod_date {
                    extract_mod_for_yaml(&entry.path())?;
                }
                read_to_string_bom(&cache_path)?
            } else {
                println!(
                    "[ WARNING ] Failed to find yaml, skipping {:?}",
                    entry.file_name()
                );
                continue;
            };

            let yaml = serde_yaml::from_str(&yaml);
            if let Err(e) = yaml {
                println!("[ WARNING ] Failed to parse {:?}: {}", entry.file_name(), e);
                continue;
            }
            let yaml: serde_yaml::Value = yaml.unwrap();

            let mut deps: Vec<ModDependency> = Vec::new();

            if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
                for dep in deps_yaml {
                    deps.push(ModDependency {
                        name: dep["Name"].as_str().unwrap().to_string(),
                        version: parse_version(&dep["Version"]),
                        optional: false,
                    });
                }
            }

            if let Some(deps_yaml) = yaml[0]["OptionalDependencies"].as_sequence() {
                for dep in deps_yaml {
                    deps.push(ModDependency {
                        name: dep["Name"].as_str().unwrap().to_string(),
                        version: parse_version(&dep["Version"]),
                        optional: true,
                    });
                }
            }

            let name = yaml[0]["Name"].as_str().context("")?.to_string();
            let version = parse_version(&yaml[0]["Version"]);
            if !mod_data.contains_key(&name) {
                println!(
                    "[ WARNING ] Failed to resolve {name} in mod data, using -1 as gamebanana id"
                );
            }
            let gbid = if mod_data.contains_key(&name) {
                mod_data[&name].game_banana_id
            } else {
                -1
            };

            let size = entry.metadata().unwrap().len();

            mods.push(LocalMod {
                name,
                version,
                game_banana_id: gbid,
                deps,
                file: entry.file_name().to_str().unwrap().to_string(),
                size,
            });
        };

        if let Err(e) = res {
            println!("[ WARNING ] Failed to parse {:?}: {}", entry.file_name(), e)
        }
    }
    mods
}

fn download_and_install_mod(
    url: &str,
    dest: &String,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<Vec<(String, String)>> {
    download_mod_archive_with_cancel(url, dest, progress_callback, multi_thread, cancel_flag)?;

    let yaml = extract_mod_for_yaml(&Path::new(&dest).to_path_buf())?;

    let mut deps: Vec<(String, String)> = Vec::new();

    if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
        for dep in deps_yaml {
            // FUCK YOU YAML
            let version = parse_version(&dep["Version"]);

            deps.push((
                dep["Name"]
                    .as_str()
                    .context("Interrupted yaml dependency")?
                    .to_string(),
                version,
            ));
        }
    }
    Ok(deps)
}

fn rm_mod_sync(mods_folder_path: &str, mod_name: &str) -> anyhow::Result<()> {
    let mods = get_installed_mods_sync(mods_folder_path.to_string());
    for mod_ in mods {
        if mod_.name == mod_name {
            let path = Path::new(mods_folder_path).join(&mod_.file);
            if path.exists() {
                if path.is_dir() {
                    fs::remove_dir_all(path)?;
                } else {
                    fs::remove_file(path)?;
                }
            }
        }
    }
    Ok(())
}

fn get_celestes() -> Vec<Game> {
    let mut games = vec![];
    use game_scanner::*;
    if let Ok(game) = steam::find("504230") {
        games.push(game);
    };

    if let Ok(game) = epicgames::find("9ae799adceab466a97fbc0408d12c5b8") {
        games.push(game);
    };

    games
}

fn normalize_game_path_impl(path: &str) -> String {
    normalize_game_path_buf(Path::new(path))
        .to_string_lossy()
        .to_string()
}

fn normalize_game_path_buf(path: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        fn has_game_artifact(path: &Path) -> bool {
            path.join("Celeste.exe").is_file()
                || path.join("Celeste.dll").is_file()
                || path.join("Celeste").is_file()
        }

        fn is_named(path: &Path, name: &str) -> bool {
            path.file_name().and_then(|v| v.to_str()) == Some(name)
        }

        fn resources_if_valid(path: PathBuf) -> Option<PathBuf> {
            if path.is_dir()
                && (has_game_artifact(&path)
                    || path
                        .parent()
                        .map(|contents| contents.join("MacOS").join("Celeste").is_file())
                        .unwrap_or(false))
            {
                Some(path)
            } else {
                None
            }
        }

        let path = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };

        if is_named(path, "Resources") {
            if let Some(resources) = resources_if_valid(path.to_path_buf()) {
                return resources;
            }
        }

        if is_named(path, "MacOS") {
            if let Some(contents) = path.parent() {
                if let Some(resources) = resources_if_valid(contents.join("Resources")) {
                    return resources;
                }
            }
        }

        if is_named(path, "Contents") {
            if let Some(resources) = resources_if_valid(path.join("Resources")) {
                return resources;
            }
        }

        if path.extension().and_then(|v| v.to_str()) == Some("app") {
            if let Some(resources) = resources_if_valid(path.join("Contents").join("Resources")) {
                return resources;
            }
        }

        if let Some(resources) =
            resources_if_valid(path.join("Celeste.app").join("Contents").join("Resources"))
        {
            return resources;
        }

        if has_game_artifact(path) {
            if let Some(parent) = path.parent() {
                if is_named(parent, "Contents") {
                    if let Some(resources) = resources_if_valid(parent.join("Resources")) {
                        return resources;
                    }
                }
            }
        }
    }

    path.to_path_buf()
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
enum DownloadStatus {
    Waiting,
    Downloading,
    Finished,
    Failed,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct DownloadInfo {
    name: String,
    url: String,
    dest: String,
    status: DownloadStatus,
    data: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_sec: f64,
}

enum DownloadWorkerMessage {
    Progress {
        index: usize,
        progress: DownloadCallbackInfo,
    },
    Finished {
        index: usize,
        result: Result<Vec<(String, String)>, String>,
    },
}

fn emit_download_tasks(tasks: &[DownloadInfo], on_event: &Channel<IpcEvent>, state: &'static str) {
    let snapshot = serde_json::to_string(tasks).unwrap_or_else(|_| "[]".to_string());
    send_event(
        on_event,
        vec![serde_json::json!(snapshot), serde_json::json!(state)],
    );
}

fn enqueue_missing_dependencies(
    tasks: &mut Vec<DownloadInfo>,
    queued: &mut HashMap<String, usize>,
    dependencies: Vec<(String, String)>,
    installed: &[LocalMod],
    mod_data: &HashMap<String, everest::ModInfoCached>,
    mods_dir: &str,
) -> usize {
    let mut added = 0;
    for (dependency, min_version) in dependencies {
        // queued 记录 Waiting / Downloading / Finished / Failed 的整个任务队列，
        // 任意父依赖重复发现同一个名字时都不会再次入队。
        if queued.contains_key(&dependency)
            || installed.iter().any(|item| {
                item.name == dependency && compare_version(&item.version, &min_version) >= 0
            })
        {
            continue;
        }
        let Some(data) = mod_data.get(&dependency) else {
            eprintln!("Failed to resolve dependency {dependency} in Mod data");
            continue;
        };

        let index = tasks.len();
        queued.insert(dependency.clone(), index);
        tasks.push(DownloadInfo {
            name: dependency.clone(),
            url: data.download_url.clone(),
            dest: Path::new(mods_dir)
                .join(format!("{}.zip", make_path_compatible_name(&dependency)))
                .to_string_lossy()
                .to_string(),
            status: DownloadStatus::Waiting,
            data: "0".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0.0,
        });
        added += 1;
    }
    added
}

fn start_waiting_mod_downloads(
    tasks: &mut [DownloadInfo],
    started_or_finished: &mut HashSet<String>,
    sender: &std::sync::mpsc::Sender<DownloadWorkerMessage>,
    handles: &mut Vec<std::thread::JoinHandle<()>>,
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> usize {
    let waiting = tasks
        .iter()
        .enumerate()
        .filter_map(|(index, task)| (task.status == DownloadStatus::Waiting).then_some(index))
        .collect::<Vec<_>>();
    let mut started = 0;

    for index in waiting {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        // 即使入队阶段已经去重，真正启动前仍再次检查，避免同一个名字出现两个
        // Downloading / Finished 任务。
        if started_or_finished.contains(&tasks[index].name) {
            continue;
        }
        started_or_finished.insert(tasks[index].name.clone());
        tasks[index].status = DownloadStatus::Downloading;
        tasks[index].data = "0".to_string();

        let sender = sender.clone();
        let task_url = tasks[index].url.clone();
        let task_dest = tasks[index].dest.clone();
        let cancel_flag = Arc::clone(cancel_flag);
        handles.push(std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let progress_sender = sender.clone();
                download_and_install_mod(
                    &task_url,
                    &task_dest,
                    &mut |progress| {
                        let _ = progress_sender
                            .send(DownloadWorkerMessage::Progress { index, progress });
                    },
                    multi_thread,
                    &cancel_flag,
                )
                .map_err(|error| format!("{error:#}"))
            }))
            .unwrap_or_else(|_| Err("Download worker stopped unexpectedly".to_string()));
            let _ = sender.send(DownloadWorkerMessage::Finished { index, result });
        }));
        started += 1;
    }

    started
}

/// 事件驱动的依赖队列：任意 Mod 一完成就立即解析 YAML、去重入队它的新依赖，
/// 并马上启动所有 Waiting 项，不等待同一层的其他下载结束。
fn download_mod_queue(
    tasks: &mut Vec<DownloadInfo>,
    installed: &[LocalMod],
    mod_data: &HashMap<String, everest::ModInfoCached>,
    mods_dir: &str,
    on_event: &Channel<IpcEvent>,
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> bool {
    let mut queued = tasks
        .iter()
        .enumerate()
        .map(|(index, task)| (task.name.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut started_or_finished = HashSet::new();
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut handles = Vec::new();
    let mut failed = false;
    let mut active = start_waiting_mod_downloads(
        tasks,
        &mut started_or_finished,
        &sender,
        &mut handles,
        multi_thread,
        cancel_flag,
    );
    emit_download_tasks(tasks, on_event, "pending");

    while active > 0 {
        let Ok(message) = receiver.recv() else {
            failed = true;
            break;
        };
        match message {
            DownloadWorkerMessage::Progress { index, progress } => {
                tasks[index].data = format!("{:.2}", progress.progress);
                tasks[index].downloaded_bytes = progress.downloaded_bytes;
                tasks[index].total_bytes = progress.total_bytes;
                tasks[index].speed_bytes_per_sec = progress.speed_bytes_per_sec;
                emit_download_tasks(tasks, on_event, "pending");
            }
            DownloadWorkerMessage::Finished { index, result } => {
                active -= 1;
                match result {
                    Ok(task_dependencies) => {
                        tasks[index].status = DownloadStatus::Finished;
                        tasks[index].data = "100".to_string();
                        tasks[index].speed_bytes_per_sec = 0.0;
                        if !cancel_flag.load(Ordering::Relaxed) {
                            enqueue_missing_dependencies(
                                tasks,
                                &mut queued,
                                task_dependencies,
                                installed,
                                mod_data,
                                mods_dir,
                            );
                        }
                    }
                    Err(error) => {
                        tasks[index].status = DownloadStatus::Failed;
                        tasks[index].data = error;
                        tasks[index].speed_bytes_per_sec = 0.0;
                        let _ = fs::remove_file(&tasks[index].dest);
                        failed = true;
                    }
                }

                // 新依赖一入队就立即启动；不等待其他 active 任务结束。
                active += start_waiting_mod_downloads(
                    tasks,
                    &mut started_or_finished,
                    &sender,
                    &mut handles,
                    multi_thread,
                    cancel_flag,
                );
                emit_download_tasks(tasks, on_event, "pending");
            }
        }
    }

    drop(sender);
    for handle in handles {
        if handle.join().is_err() {
            failed = true;
        }
    }

    if cancel_flag.load(Ordering::Relaxed) {
        for task in tasks
            .iter_mut()
            .filter(|task| task.status == DownloadStatus::Waiting)
        {
            task.status = DownloadStatus::Failed;
            task.data = "Download canceled".to_string();
        }
    }

    failed || cancel_flag.load(Ordering::Relaxed)
}

fn make_path_compatible_name(name: &str) -> String {
    name.replace([' ', ':', '/', '\\', '?', '*', '\"', '<', '>', '|'], "_")
}

#[derive(Debug, Clone, Copy)]
enum LocalPackageKind {
    Mod,
    Everest,
}

impl LocalPackageKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Everest => "everest",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPackageInstallResult {
    file: String,
    package_type: String,
    success: bool,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPackageInstallProgress {
    current: usize,
    total: usize,
    file: String,
    detail: String,
    progress: f32,
}

fn is_celeste_running(game_path: &Path) -> bool {
    use sysinfo::{ProcessExt, System, SystemExt};

    fn comparable_path(path: &Path) -> String {
        let value = path.to_string_lossy().replace('/', "\\");
        #[cfg(target_os = "windows")]
        let value = value.strip_prefix(r"\\?\").unwrap_or(&value).to_lowercase();
        value.trim_end_matches('\\').to_string()
    }

    let game_directory = comparable_path(game_path);
    let mut system = System::new();
    system.refresh_processes();

    system.processes().values().any(|process| {
        let process_name = process.name().to_ascii_lowercase();
        if process_name != "celeste" && process_name != "celeste.exe" {
            return false;
        }

        let executable = process.exe();
        if executable.as_os_str().is_empty() {
            return false;
        }

        let executable_directory = executable.parent().map(comparable_path).unwrap_or_default();
        if executable_directory == game_directory {
            return true;
        }

        #[cfg(target_os = "macos")]
        if game_path.file_name().and_then(|name| name.to_str()) == Some("Resources") {
            let macos_directory = game_path
                .parent()
                .map(|contents| contents.join("MacOS"))
                .map(|path| comparable_path(&path))
                .unwrap_or_default();
            return executable_directory == macos_directory;
        }

        false
    })
}

fn classify_local_package(path: &Path) -> anyhow::Result<LocalPackageKind> {
    if !path.is_file() {
        bail!("Package is not a file");
    }
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        bail!("Only zip packages are supported");
    }

    let file = fs::File::open(path)?;
    let archive = zip::ZipArchive::new(file)?;
    if archive
        .file_names()
        .any(|name| name == "everest.yaml" || name == "everest.yml")
    {
        return Ok(LocalPackageKind::Mod);
    }
    drop(archive);

    if everest::is_everest_install_archive(path)? {
        Ok(LocalPackageKind::Everest)
    } else {
        bail!("The zip is neither a Mod nor an Everest package for this platform")
    }
}

fn replace_local_mod_archive(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let file_name = destination
        .file_name()
        .context("Failed to resolve Mod archive file name")?
        .to_string_lossy();
    let install_id = std::process::id();
    let temporary =
        destination.with_file_name(format!(".{file_name}.celemod-installing-{install_id}"));
    let backup = destination.with_file_name(format!(".{file_name}.celemod-backup-{install_id}"));

    fs::remove_file(&temporary).ok();
    fs::remove_file(&backup).ok();
    fs::copy(source, &temporary).with_context(|| {
        format!(
            "Failed to copy package into {}",
            destination.parent().unwrap_or(destination).display()
        )
    })?;

    let had_existing = destination.exists();
    if had_existing {
        if let Err(error) = fs::rename(destination, &backup) {
            fs::remove_file(&temporary).ok();
            return Err(error).context("Failed to back up the existing Mod archive");
        }
    }

    if let Err(error) = fs::rename(&temporary, destination) {
        if had_existing {
            fs::rename(&backup, destination).ok();
        }
        fs::remove_file(&temporary).ok();
        return Err(error).context("Failed to finish installing the Mod archive");
    }

    fs::remove_file(&backup).ok();
    Ok(())
}

fn install_local_mod(game_path: &Path, package_path: &Path) -> anyhow::Result<(String, String)> {
    let yaml = parse_mod_yaml(package_path)?;
    let mod_name = yaml[0]["Name"]
        .as_str()
        .context("everest.yaml is missing the Mod name")?
        .to_string();
    let source_name = package_path
        .file_name()
        .context("Package path has no file name")?;
    let destination_name = source_name.to_string_lossy().to_string();
    let mods_path = game_path.join("Mods");
    fs::create_dir_all(&mods_path)?;
    let destination = mods_path.join(source_name);

    replace_local_mod_archive(package_path, &destination)?;
    Ok((mod_name, destination_name))
}

fn disable_installed_local_mods(
    game_path: &String,
    installed_mods: &[(String, String)],
) -> anyhow::Result<()> {
    if installed_mods.is_empty() {
        return Ok(());
    }
    let mods: Vec<(&String, &String)> = installed_mods
        .iter()
        .map(|(name, file)| (name, file))
        .collect();
    for profile in blacklist::get_mod_blacklist_profiles(game_path) {
        blacklist::switch_mod_blacklist_profile(game_path, &profile.name, mods.clone(), false)?;
    }
    Ok(())
}

#[cfg(test)]
mod local_package_tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::SimpleFileOptions;

    fn test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("celemod-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn identifies_and_installs_mod_archives() {
        let root = test_dir("drop-mod");
        let package = root.join("Test Mod.zip");
        let game_path = root.join("game");
        fs::create_dir_all(&game_path).unwrap();
        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: DropInstallTest\n  Version: 1.0.0\n",
            )],
        );

        assert!(matches!(
            classify_local_package(&package).unwrap(),
            LocalPackageKind::Mod
        ));
        let installed = install_local_mod(&game_path, &package).unwrap();
        assert_eq!(installed.0, "DropInstallTest");
        assert_eq!(installed.1, "Test Mod.zip");
        let installed_path = game_path.join("Mods").join(installed.1);
        assert!(installed_path.is_file());

        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: DropInstallReplacement\n  Version: 2.0.0\n",
            )],
        );
        install_local_mod(&game_path, &package).unwrap();
        assert_eq!(
            parse_mod_yaml(&installed_path).unwrap()[0]["Name"].as_str(),
            Some("DropInstallReplacement")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn identifies_platform_everest_archives() {
        #[cfg(target_os = "windows")]
        let installer = if std::env::consts::ARCH == "x86" {
            "main/MiniInstaller-win.exe"
        } else {
            "main/MiniInstaller-win64.exe"
        };
        #[cfg(target_os = "macos")]
        let installer = "main/MiniInstaller-osx";
        #[cfg(target_os = "linux")]
        let installer = "main/MiniInstaller-linux";

        let root = test_dir("drop-everest");
        let package = root.join("everest.zip");
        write_zip(&package, &[(installer, b"installer")]);

        assert!(matches!(
            classify_local_package(&package).unwrap(),
            LocalPackageKind::Everest
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unrecognized_zip_archives() {
        let root = test_dir("drop-unknown");
        let package = root.join("unknown.zip");
        write_zip(&package, &[("readme.txt", b"not a package")]);

        assert!(classify_local_package(&package).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_stale_mod_download_sidecars() {
        let root = test_dir("download-cleanup");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Example.zip.celemod"), b"partial").unwrap();
        fs::write(mods.join("Keep.zip"), b"installed").unwrap();
        fs::write(mods.join("Keep.celemod"), b"unrelated").unwrap();

        assert_eq!(cleanup_mod_download_temp_files_impl(&mods).unwrap(), 1);
        assert!(!mods.join("Example.zip.celemod").exists());
        assert!(mods.join("Keep.zip").exists());
        assert!(mods.join("Keep.celemod").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dependency_queue_deduplicates_all_task_states() {
        let root = test_dir("dependency-queue");
        let mut tasks = Vec::new();
        let mut queued = HashMap::new();
        let mod_data = HashMap::from([(
            "SharedDependency".to_string(),
            everest::ModInfoCached {
                name: "SharedDependency".to_string(),
                version: "1.0.0".to_string(),
                game_banana_id: 1,
                game_banana_file_id: 2,
                download_url: "https://example.invalid/dependency.zip".to_string(),
            },
        )]);
        let dependencies = vec![
            ("SharedDependency".to_string(), "1.0.0".to_string()),
            ("SharedDependency".to_string(), "1.0.0".to_string()),
        ];

        assert_eq!(
            enqueue_missing_dependencies(
                &mut tasks,
                &mut queued,
                dependencies.clone(),
                &[],
                &mod_data,
                root.to_string_lossy().as_ref(),
            ),
            1
        );
        assert_eq!(tasks.len(), 1);

        for status in [
            DownloadStatus::Waiting,
            DownloadStatus::Downloading,
            DownloadStatus::Finished,
            DownloadStatus::Failed,
        ] {
            tasks[0].status = status;
            assert_eq!(
                enqueue_missing_dependencies(
                    &mut tasks,
                    &mut queued,
                    dependencies.clone(),
                    &[],
                    &mod_data,
                    root.to_string_lossy().as_ref(),
                ),
                0
            );
            assert_eq!(tasks.len(), 1);
        }

        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
fn cancel_download_mod(name: String) -> bool {
    if let Some(flag) = DOWNLOAD_CANCEL_FLAGS.lock().unwrap().get(&name) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

#[tauri::command]
fn cleanup_mod_download_temp_files(game_path: String) -> Result<usize, String> {
    cleanup_game_mod_download_temp_files(Path::new(&game_path))
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn get_celeste_dirs() -> String {
    if is_test_mode() {
        return get_test_game_path().to_string_lossy().to_string();
    }
    get_celestes()
        .iter()
        .filter_map(|game| game.path.as_ref())
        .map(|path| normalize_game_path_buf(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn start_game_directly_impl(path: String, origin: bool) -> anyhow::Result<()> {
    let path = normalize_game_path_impl(&path);
    let path = Path::new(&path);

    #[cfg(windows)]
    let game = path.join("Celeste.exe");
    #[cfg(all(unix, not(target_os = "macos")))]
    let game = path.join("Celeste");
    #[cfg(target_os = "macos")]
    let game = {
        let direct = path.join("Celeste");
        if direct.exists() {
            direct
        } else if path.file_name().and_then(|name| name.to_str()) == Some("Resources") {
            path.parent().unwrap_or(path).join("MacOS").join("Celeste")
        } else {
            direct
        }
    };

    let game_origin = path.join("orig").join(
        game.file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("Celeste")),
    );
    let executable = if origin && game_origin.exists() {
        &game_origin
    } else {
        &game
    };
    let mut command = std::process::Command::new(executable);
    if origin && game_origin.exists() {
        command.arg("--vanilla");
    }
    command.spawn()?;
    Ok(())
}

#[tauri::command]
fn start_game(path: String) -> Result<(), String> {
    let path = normalize_game_path_impl(&path);
    let celestes = get_celestes();
    if let Some(game) = celestes.iter().find(|game| {
        game.path
            .as_ref()
            .map(|game_path| normalize_game_path_buf(game_path).to_string_lossy() == path)
            .unwrap_or(false)
    }) {
        game_scanner::manager::launch_game(game).map_err(|error| error.to_string())
    } else {
        start_game_directly_impl(path, false).map_err(|error| format!("{error:#}"))
    }
}

#[tauri::command]
fn start_game_directly(path: String, origin: bool) -> Result<(), String> {
    start_game_directly_impl(path, origin).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn verify_celeste_install(path: String) -> bool {
    if is_test_mode() && path == get_test_game_path().to_string_lossy() {
        return true;
    }
    let path = normalize_game_path_impl(&path);
    let path = Path::new(&path);
    if ["Celeste.exe", "Celeste", "Celeste.dll"]
        .iter()
        .any(|file| path.join(file).exists())
    {
        return true;
    }
    #[cfg(target_os = "macos")]
    if path.file_name().and_then(|name| name.to_str()) == Some("Resources")
        && path
            .parent()
            .map(|contents| contents.join("MacOS").join("Celeste").exists())
            .unwrap_or(false)
    {
        return true;
    }
    false
}

#[tauri::command]
fn normalize_game_path(path: String) -> String {
    normalize_game_path_impl(&path)
}

#[tauri::command]
fn celemod_version() -> String {
    env!("VERSION").to_string()
}

#[tauri::command]
fn celemod_hash() -> String {
    env!("GIT_HASH").to_string()
}

#[tauri::command]
fn enable_window_controls(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_window_controls::WindowControlsExt;

        window
            .set_title_bar_height(45)
            .map_err(|error| error.to_string())?;
        window
            .set_title_bar_overlay(true)
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = window;

    Ok(())
}

#[tauri::command]
fn is_using_cache() -> bool {
    everest::is_using_cache()
}

#[tauri::command]
fn configure_mod_cache(ttl_seconds: u64) {
    everest::set_mod_cache_ttl(ttl_seconds);
}

#[tauri::command]
fn get_mod_catalog(force_refresh: bool) -> Result<String, String> {
    everest::get_mod_catalog_json(force_refresh).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn get_mod_cache_status() -> Result<everest::ModCacheStatus, String> {
    everest::get_mod_catalog_status().map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn show_log_window() {
    #[cfg(windows)]
    unsafe {
        use winapi::um::winuser::{IsWindowVisible, SW_HIDE, SW_SHOW, ShowWindow};

        let console = winapi::um::wincon::GetConsoleWindow();
        if console.is_null() {
            return;
        }
        let command = if IsWindowVisible(console) == 0 {
            SW_SHOW
        } else {
            SW_HIDE
        };
        ShowWindow(console, command);
    }
}

#[cfg(all(windows, not(debug_assertions)))]
fn initialize_windows_console() {
    unsafe {
        use winapi::um::{
            consoleapi::AllocConsole,
            winuser::{SW_HIDE, ShowWindow},
        };

        if AllocConsole() != 0 {
            ShowWindow(winapi::um::wincon::GetConsoleWindow(), SW_HIDE);
        }
    }
}

#[tauri::command]
fn get_database_path() -> String {
    let Some(home_dir) = dirs::home_dir() else {
        return "./cele-mod.db".to_string();
    };
    let celemod_dir = home_dir.join(".celemod");
    let new_path = celemod_dir.join("cele-mod.db");
    let old_cwd_path = Path::new("./cele-mod.db").to_path_buf();
    let old_parent_path = Path::new("../../cele-mod.db").to_path_buf();
    let _ = fs::create_dir_all(&celemod_dir);
    let old_db_path = if old_parent_path.exists() {
        Some(old_parent_path)
    } else if old_cwd_path.exists() {
        Some(old_cwd_path)
    } else {
        None
    };
    if let Some(old_path) = old_db_path
        && !new_path.exists()
        && fs::copy(&old_path, &new_path).is_ok()
    {
        let _ = fs::remove_file(old_path);
    }
    new_path.to_string_lossy().to_string()
}

#[tauri::command]
fn get_installed_mod_ids(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let ids = get_installed_mods_sync(mods_folder_path)
            .into_iter()
            .map(|item| item.game_banana_id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        send_event(&on_event, vec![serde_json::json!(ids)]);
    });
}

#[tauri::command]
fn get_installed_miaonet(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let installed = get_installed_mods_sync(mods_folder_path)
            .into_iter()
            .any(|item| item.name == "MiaoNet");
        send_event(&on_event, vec![serde_json::json!(installed)]);
    });
}

#[tauri::command]
fn get_installed_mods(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let installed = get_installed_mods_sync(mods_folder_path);
        let payload = serde_json::to_string(&installed).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn get_invalid_zip_mod_files(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let invalid = get_invalid_zip_mod_files_sync(&mods_folder_path);
        let payload = serde_json::to_string(&invalid).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn check_all_mod_contents(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        check_all_mod_contents_sync(&mods_folder_path, &mut |progress| {
            if let Ok(payload) = serde_json::to_string(&progress) {
                send_event(&on_event, vec![serde_json::json!(payload)]);
            }
        });
    });
}

#[tauri::command]
fn get_blacklist_profiles(game_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let profiles = blacklist::get_mod_blacklist_profiles(&game_path);
        let payload = serde_json::to_string(&profiles).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn apply_blacklist_profile(
    game_path: String,
    profile_name: String,
    always_on_mods: String,
) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let always_on_mods: Vec<String> = match serde_json::from_str(&always_on_mods) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse always-on mods: {error}"),
    };
    match blacklist::apply_mod_blacklist_profile(&game_path, &profile_name, &always_on_mods) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to apply blacklist profile: {error}"),
    }
}

#[tauri::command]
fn switch_mod_blacklist_profile(
    game_path: String,
    profile_name: String,
    mod_names: String,
    mod_files: String,
    enabled: bool,
) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let mod_names: Vec<String> = match serde_json::from_str(&mod_names) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse Mod names: {error}"),
    };
    let mod_files: Vec<String> = match serde_json::from_str(&mod_files) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse Mod files: {error}"),
    };
    let mods = mod_names.iter().zip(mod_files.iter()).collect();
    match blacklist::switch_mod_blacklist_profile(&game_path, &profile_name, mods, enabled) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to switch blacklist profile: {error}"),
    }
}

#[tauri::command]
fn new_mod_blacklist_profile(game_path: String, profile_name: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::new_mod_blacklist_profile(&game_path, &profile_name) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to create blacklist profile: {error}"),
    }
}

#[tauri::command]
fn get_current_profile(game_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    blacklist::get_current_profile(&game_path)
        .unwrap_or_else(|error| format!("Failed to get current profile: {error}"))
}

#[tauri::command]
fn remove_mod_blacklist_profile(game_path: String, profile_name: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::remove_mod_blacklist_profile(&game_path, &profile_name) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to remove blacklist profile: {error}"),
    }
}

#[tauri::command]
fn get_current_blacklist_content(game_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    blacklist::get_current_blacklist_content(&game_path).unwrap_or_default()
}

#[tauri::command]
fn import_blacklist_file_as_profile(game_path: String, always_on_mods: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let always_on_mods: Vec<String> = match serde_json::from_str(&always_on_mods) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse always-on mods: {error}"),
    };
    blacklist::import_blacklist_file_as_profile(&game_path, &always_on_mods)
        .unwrap_or_else(|error| format!("Failed to import blacklist profile: {error}"))
}

#[tauri::command]
fn set_mod_options_order(game_path: String, profile_name: String, order_json: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let order = match serde_json::from_str(&order_json) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse order: {error}"),
    };
    match blacklist::set_mod_options_order(&game_path, &profile_name, order) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to set mod options order: {error}"),
    }
}

#[tauri::command]
fn get_mod_update(name: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let data = get_mod_cached_new()
            .ok()
            .and_then(|mods| {
                mods.get(&name)
                    .map(|item| (item.game_banana_file_id.to_string(), item.version.clone()))
            })
            .and_then(|value| serde_json::to_string(&value).ok())
            .unwrap_or_default();
        send_event(&on_event, vec![serde_json::json!(data)]);
    });
}

#[tauri::command]
fn get_mod_latest_info(on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let values: Vec<(String, String, String, String)> = get_mod_cached_new()
            .map(|mods| {
                mods.iter()
                    .map(|(name, item)| {
                        (
                            name.clone(),
                            item.version.clone(),
                            item.game_banana_file_id.to_string(),
                            item.download_url.clone(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let data = serde_json::to_string(&values).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(data)]);
    });
}

#[tauri::command]
fn rm_mod(mods_folder_path: String, mod_name: String) {
    std::thread::spawn(move || {
        if let Err(error) = rm_mod_sync(&mods_folder_path, &mod_name) {
            eprintln!("Failed to remove Mod: {error:#}");
        }
    });
}

#[tauri::command]
fn delete_mods(game_path: String, mod_names: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let mods_folder_path = Path::new(&game_path)
            .join("Mods")
            .to_string_lossy()
            .to_string();
        let names: Vec<String> = serde_json::from_str(&mod_names).unwrap_or_default();
        let failed = names
            .iter()
            .filter_map(|name| {
                rm_mod_sync(&mods_folder_path, name)
                    .err()
                    .map(|error| format!("{name}: {error}"))
            })
            .collect::<Vec<_>>();
        let result = if failed.is_empty() {
            "Success".to_string()
        } else {
            format!("Failed to remove some Mods: {}", failed.join(", "))
        };
        send_event(&on_event, vec![serde_json::json!(result)]);
    });
}

#[tauri::command]
fn delete_mod_files(mods_folder_path: String, file_names: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let names: Vec<String> = serde_json::from_str(&file_names).unwrap_or_default();
        let result = delete_mod_files_sync(&mods_folder_path, &names)
            .map(|_| "Success".to_string())
            .unwrap_or_else(|error| format!("Failed to remove some files: {error}"));
        send_event(&on_event, vec![serde_json::json!(result)]);
    });
}

#[tauri::command]
fn get_everest_version(game_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let version = if is_test_mode() {
            "4000".to_string()
        } else {
            everest::get_everest_version(&normalize_game_path_impl(&game_path))
                .map(|value| value.to_string())
                .unwrap_or_default()
        };
        send_event(&on_event, vec![serde_json::json!(version)]);
    });
}

#[tauri::command]
fn download_and_install_everest(game_path: String, url: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        if is_test_mode() {
            send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(100.0)],
            );
            return;
        }
        let game_path = normalize_game_path_impl(&game_path);
        let result =
            everest::download_and_install_everest(&game_path, &url, &mut |message, progress| {
                send_event(
                    &on_event,
                    vec![serde_json::json!(message), serde_json::json!(progress)],
                );
            });
        match result {
            Ok(()) => send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(100.0)],
            ),
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("Failed"),
                    serde_json::json!(error.to_string()),
                ],
            ),
        }
    });
}

#[tauri::command]
fn install_local_packages(
    game_path: String,
    package_paths: String,
    auto_disable_new_mods: bool,
    on_event: Channel<IpcEvent>,
) {
    std::thread::spawn(move || {
        let paths: Vec<String> = match serde_json::from_str(&package_paths) {
            Ok(paths) => paths,
            Err(error) => {
                send_event(
                    &on_event,
                    vec![
                        serde_json::json!("failed"),
                        serde_json::json!(format!("Invalid package list: {error}")),
                    ],
                );
                return;
            }
        };
        if paths.is_empty() {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!("No packages were dropped"),
                ],
            );
            return;
        }
        let game_path = normalize_game_path_impl(&game_path);
        let normalized_game_path = Path::new(&game_path);
        if !normalized_game_path.is_dir() {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!("The selected Celeste folder does not exist"),
                ],
            );
            return;
        }
        if !is_test_mode() && is_celeste_running(normalized_game_path) {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!(
                        "Celeste is currently running. Exit the game before installing packages."
                    ),
                ],
            );
            return;
        }
        let total = paths.len();
        let mut results = Vec::with_capacity(total);
        let mut installed_mods = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            let package_path = Path::new(path);
            let file_name = package_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let current = index + 1;
            let progress = LocalPackageInstallProgress {
                current,
                total,
                file: file_name.clone(),
                detail: "Inspecting package".to_string(),
                progress: 0.0,
            };
            send_event(
                &on_event,
                vec![
                    serde_json::json!("progress"),
                    serde_json::json!(serde_json::to_string(&progress).unwrap()),
                ],
            );
            let kind = classify_local_package(package_path);
            let package_type = kind
                .as_ref()
                .map(|kind| kind.as_str())
                .unwrap_or("unknown")
                .to_string();
            let install_result = match kind {
                Ok(LocalPackageKind::Mod) => install_local_mod(normalized_game_path, package_path)
                    .map(|installed| installed_mods.push(installed)),
                Ok(LocalPackageKind::Everest) if is_test_mode() => Ok(()),
                Ok(LocalPackageKind::Everest) => everest::install_everest_archive(
                    &game_path,
                    package_path,
                    &mut |detail, value| {
                        let progress = LocalPackageInstallProgress {
                            current,
                            total,
                            file: file_name.clone(),
                            detail,
                            progress: value,
                        };
                        send_event(
                            &on_event,
                            vec![
                                serde_json::json!("progress"),
                                serde_json::json!(serde_json::to_string(&progress).unwrap()),
                            ],
                        );
                    },
                ),
                Err(error) => Err(error),
            };
            results.push(match install_result {
                Ok(()) => LocalPackageInstallResult {
                    file: file_name,
                    package_type,
                    success: true,
                    error: String::new(),
                },
                Err(error) => LocalPackageInstallResult {
                    file: file_name,
                    package_type,
                    success: false,
                    error: format!("{error:#}"),
                },
            });
        }
        if auto_disable_new_mods {
            if let Err(error) = disable_installed_local_mods(&game_path, &installed_mods) {
                eprintln!("Failed to auto-disable dropped Mods: {error:#}");
            }
        }
        send_event(
            &on_event,
            vec![
                serde_json::json!("finished"),
                serde_json::json!(serde_json::to_string(&results).unwrap()),
            ],
        );
    });
}

#[tauri::command]
fn download_mod(
    name: String,
    url: String,
    mods_dir: String,
    auto_disable_new_mods: bool,
    on_event: Channel<IpcEvent>,
    use_cn_proxy: bool,
    multi_thread: bool,
) {
    let _ = use_cn_proxy;
    std::thread::spawn(move || {
        if let Err(error) = fs::create_dir_all(&mods_dir) {
            send_event(
                &on_event,
                vec![serde_json::json!(format!(
                    "Failed to create Mods directory: {error}"
                ))],
            );
            return;
        }
        let cancel_flag = Arc::new(AtomicBool::new(false));
        DOWNLOAD_CANCEL_FLAGS
            .lock()
            .unwrap()
            .insert(name.clone(), Arc::clone(&cancel_flag));
        let mod_data = match get_mod_cached_new() {
            Ok(data) => data,
            Err(error) => {
                send_event(
                    &on_event,
                    vec![serde_json::json!(format!(
                        "Failed to get Mod data: {error}"
                    ))],
                );
                DOWNLOAD_CANCEL_FLAGS.lock().unwrap().remove(&name);
                return;
            }
        };
        let mut tasks = vec![DownloadInfo {
            name: name.clone(),
            url,
            dest: Path::new(&mods_dir)
                .join(format!("{}.zip", make_path_compatible_name(&name)))
                .to_string_lossy()
                .to_string(),
            status: DownloadStatus::Waiting,
            data: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0.0,
        }];
        let installed = get_installed_mods_sync(mods_dir.clone());
        let failed = download_mod_queue(
            &mut tasks,
            &installed,
            &mod_data,
            &mods_dir,
            &on_event,
            multi_thread,
            &cancel_flag,
        );
        if !failed && auto_disable_new_mods {
            let game_path = Path::new(&mods_dir)
                .parent()
                .unwrap_or(Path::new(&mods_dir))
                .to_string_lossy()
                .to_string();
            let installed = get_installed_mods_sync(mods_dir.clone());
            let completed = tasks
                .iter()
                .filter(|task| task.status == DownloadStatus::Finished)
                .filter_map(|task| {
                    installed
                        .iter()
                        .find(|item| item.name == task.name)
                        .map(|item| (&item.name, &item.file))
                })
                .collect::<Vec<_>>();
            for profile in blacklist::get_mod_blacklist_profiles(&game_path) {
                if let Err(error) = blacklist::switch_mod_blacklist_profile(
                    &game_path,
                    &profile.name,
                    completed.clone(),
                    false,
                ) {
                    eprintln!("Failed to auto-disable downloaded Mods: {error:#}");
                }
            }
        }
        emit_download_tasks(
            &tasks,
            &on_event,
            if failed { "failed" } else { "finished" },
        );
        DOWNLOAD_CANCEL_FLAGS.lock().unwrap().remove(&name);
    });
}

#[tauri::command]
fn do_self_update(url: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let tmp = std::env::temp_dir().join(if cfg!(windows) {
            "cele-mod.exe"
        } else {
            "cele-mod"
        });
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let result = ureq::download_file_with_progress(
            &url,
            tmp.to_string_lossy().as_ref(),
            &mut |progress| {
                send_event(
                    &on_event,
                    vec![
                        serde_json::json!("downloading"),
                        serde_json::json!(progress.progress),
                    ],
                )
            },
            false,
            &cancel_flag,
        );
        match result {
            Ok(()) => {
                let current_exe = match std::env::current_exe() {
                    Ok(path) => path,
                    Err(error) => {
                        send_event(
                            &on_event,
                            vec![
                                serde_json::json!("failed"),
                                serde_json::json!(error.to_string()),
                            ],
                        );
                        return;
                    }
                };
                let mut command = std::process::Command::new(&tmp);
                command.arg("/update").arg(current_exe);
                if let Err(error) = command.spawn() {
                    send_event(
                        &on_event,
                        vec![
                            serde_json::json!("failed"),
                            serde_json::json!(error.to_string()),
                        ],
                    );
                } else {
                    std::process::exit(0);
                }
            }
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!(error.to_string()),
                ],
            ),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(windows, not(debug_assertions)))]
    initialize_windows_console();

    let args = std::env::args().collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--test-mode") {
        TEST_MODE.store(true, Ordering::Relaxed);
    }
    if args.len() == 3 && args[1] == "/update" {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let replacement = &args[2];
        if let Ok(current_exe) = std::env::current_exe() {
            let _ = fs::remove_file(replacement);
            if fs::copy(&current_exe, replacement).is_ok() {
                let _ = std::process::Command::new(replacement).spawn();
            }
        }
        return;
    }

    println!("CeleMod v{} ({})", env!("VERSION"), env!("GIT_HASH"));
    let startup_game_paths = if is_test_mode() {
        vec![get_test_game_path()]
    } else {
        get_celestes()
            .iter()
            .filter_map(|game| game.path.as_ref())
            .map(|path| normalize_game_path_buf(path))
            .collect()
    };
    for game_path in startup_game_paths {
        match cleanup_game_mod_download_temp_files(&game_path) {
            Ok(removed) if removed > 0 => {
                println!("Removed {removed} stale Mod download temporary file(s)");
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!(
                    "Failed to clean stale Mod downloads in {}: {error:#}",
                    game_path.display()
                );
            }
        }
    }
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;

                let window = _app.get_webview_window("main").ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "main webview window was not created",
                    )
                })?;
                apply_macos_vibrancy(&window).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            download_mod,
            cancel_download_mod,
            cleanup_mod_download_temp_files,
            get_celeste_dirs,
            get_installed_mod_ids,
            get_installed_mods,
            get_invalid_zip_mod_files,
            check_all_mod_contents,
            get_installed_miaonet,
            start_game,
            open_url,
            get_blacklist_profiles,
            apply_blacklist_profile,
            switch_mod_blacklist_profile,
            new_mod_blacklist_profile,
            get_current_profile,
            remove_mod_blacklist_profile,
            get_mod_update,
            rm_mod,
            delete_mods,
            delete_mod_files,
            get_everest_version,
            download_and_install_everest,
            install_local_packages,
            celemod_version,
            celemod_hash,
            enable_window_controls,
            do_self_update,
            start_game_directly,
            verify_celeste_install,
            normalize_game_path,
            get_mod_latest_info,
            show_log_window,
            get_current_blacklist_content,
            import_blacklist_file_as_profile,
            is_using_cache,
            configure_mod_cache,
            get_mod_catalog,
            get_mod_cache_status,
            get_database_path,
            set_mod_options_order,
            set_window_vibrancy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CeleMod");
}
