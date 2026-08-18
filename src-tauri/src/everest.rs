use super::{ureq, wegfan};

use ::ureq::get;
use anyhow::{Context, bail};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfoCached {
    pub name: String,
    pub version: String,
    pub game_banana_id: i64,
    pub game_banana_file_id: i64,
    pub download_url: String,
}

static USING_CACHE: AtomicBool = AtomicBool::new(false);
static MOD_CACHE_TTL_SECONDS: AtomicU64 = AtomicU64::new(24 * 60 * 60);

pub fn is_using_cache() -> bool {
    USING_CACHE.load(Ordering::Relaxed)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModCacheStatus {
    pub source: String,
    pub updated_at: u64,
    pub count: usize,
    pub path: String,
}

#[derive(Clone)]
struct ModCatalogState {
    raw: String,
    compact: Arc<HashMap<String, ModInfoCached>>,
    categories: Arc<HashMap<String, String>>,
    status: ModCacheStatus,
}

lazy_static! {
    static ref MOD_CATALOG_STATE: Mutex<Option<ModCatalogState>> = Mutex::new(None);
}

fn raw_mod_cache_path() -> Option<PathBuf> {
    dirs::cache_dir().map(|directory| directory.join("CeleMod").join("mod_list.json"))
}

fn timestamp_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn parse_raw_catalog(raw: &str) -> anyhow::Result<Vec<wegfan::Mod>> {
    let mut response: serde_json::Value = serde_json::from_str(raw)?;
    Ok(serde_json::from_value(response["data"].take())?)
}

fn compact_catalog(mods: &[wegfan::Mod]) -> HashMap<String, ModInfoCached> {
    mods.iter()
        .map(|item| {
            let compact = ModInfoCached {
                game_banana_file_id: item.submission_file.game_banana_id.unwrap_or(-1),
                game_banana_id: item.submission_file.submission.game_banana_id.unwrap_or(-1),
                download_url: item.submission_file.url.clone(),
                name: item.name.clone(),
                version: item.version.clone(),
            };
            (compact.name.clone(), compact)
        })
        .collect()
}

fn catalog_categories(mods: &[wegfan::Mod]) -> HashMap<String, String> {
    mods.iter()
        .filter_map(|item| {
            item.submission_file
                .submission
                .category_name
                .as_ref()
                .map(|category| (item.name.clone(), category.clone()))
        })
        .collect()
}

fn fetch_raw_catalog() -> anyhow::Result<String> {
    Ok(get("https://celeste.weg.fan/api/v2/mod/list")
        .set(
            "User-Agent",
            &format!("CeleMod/{}-{}", env!("VERSION"), &env!("GIT_HASH")[..6]),
        )
        .timeout(std::time::Duration::from_secs(20))
        .set("Accept-Encoding", "gzip, deflate, br")
        .call()?
        .into_string()?)
}

fn read_raw_cache() -> Option<(String, SystemTime)> {
    let path = raw_mod_cache_path()?;
    let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    Some((raw, modified))
}

fn save_raw_cache(raw: &str) {
    let Some(path) = raw_mod_cache_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(error) = std::fs::write(&path, raw) {
        crate::logging::error(format_args!(
            "Failed to save raw Mod catalog cache: {error}"
        ));
    }
}

fn catalog_state_from_raw(
    raw: String,
    source: &str,
    updated_at: SystemTime,
) -> anyhow::Result<ModCatalogState> {
    let mods = Arc::new(parse_raw_catalog(&raw)?);
    let compact = Arc::new(compact_catalog(&mods));
    let categories = Arc::new(catalog_categories(&mods));
    Ok(ModCatalogState {
        status: ModCacheStatus {
            source: source.to_string(),
            updated_at: timestamp_millis(updated_at),
            count: mods.len(),
            path: raw_mod_cache_path()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default(),
        },
        raw,
        compact,
        categories,
    })
}

fn cache_is_fresh(modified: SystemTime) -> bool {
    let ttl = MOD_CACHE_TTL_SECONDS.load(Ordering::Relaxed);
    ttl > 0 && modified.elapsed().unwrap_or(Duration::MAX) <= Duration::from_secs(ttl)
}

fn load_catalog(force_refresh: bool) -> anyhow::Result<ModCatalogState> {
    if !force_refresh {
        if let Some(current) = MOD_CATALOG_STATE.lock().unwrap().as_ref() {
            let updated_at = UNIX_EPOCH + Duration::from_millis(current.status.updated_at);
            if cache_is_fresh(updated_at) {
                return Ok(current.clone());
            }
        }

        if let Some((raw, modified)) = read_raw_cache()
            && cache_is_fresh(modified)
        {
            USING_CACHE.store(true, Ordering::Relaxed);
            return catalog_state_from_raw(raw, "cache", modified);
        }
    }

    match fetch_raw_catalog().and_then(|raw| {
        let state = catalog_state_from_raw(raw.clone(), "network", SystemTime::now())?;
        save_raw_cache(&raw);
        Ok(state)
    }) {
        Ok(state) => {
            USING_CACHE.store(false, Ordering::Relaxed);
            Ok(state)
        }
        Err(network_error) => {
            crate::logging::error(format_args!(
                "Failed to fetch Mod catalog: {network_error:#}"
            ));
            if let Some((raw, modified)) = read_raw_cache() {
                USING_CACHE.store(true, Ordering::Relaxed);
                return catalog_state_from_raw(raw, "stale-cache", modified);
            }
            USING_CACHE.store(false, Ordering::Relaxed);
            Err(network_error)
        }
    }
}

fn catalog(force_refresh: bool) -> anyhow::Result<ModCatalogState> {
    let state = load_catalog(force_refresh)?;
    *MOD_CATALOG_STATE.lock().unwrap() = Some(state.clone());
    Ok(state)
}

pub fn set_mod_cache_ttl(seconds: u64) {
    MOD_CACHE_TTL_SECONDS.store(seconds, Ordering::Relaxed);
}

pub fn get_mod_catalog_json(force_refresh: bool) -> anyhow::Result<String> {
    Ok(catalog(force_refresh)?.raw)
}

pub fn get_mod_catalog_status() -> anyhow::Result<ModCacheStatus> {
    Ok(catalog(false)?.status)
}

pub fn get_mod_cached_new() -> anyhow::Result<Arc<HashMap<String, ModInfoCached>>> {
    Ok(catalog(false)?.compact)
}

pub fn get_mod_cached_if_loaded() -> Option<Arc<HashMap<String, ModInfoCached>>> {
    MOD_CATALOG_STATE
        .lock()
        .ok()?
        .as_ref()
        .map(|state| Arc::clone(&state.compact))
}

pub fn get_mod_category(name: &str) -> Option<String> {
    catalog(false).ok()?.categories.get(name).cloned()
}

static MAGIC_STR: &str = "EverestBuild";
static MAGIC_STR_ONLY_ORIGIN_EXE: &str = "_StarJumpEnd+<StartCirclingPlayer>";

pub fn get_everest_version(game_path: &str) -> Option<i32> {
    fn check_file(path: PathBuf) -> Option<i32> {
        crate::logging::info(format_args!("Checking {}", path.display()));
        let buf = std::fs::read(path).ok()?;
        let str = unsafe { std::str::from_utf8_unchecked(&buf) };
        let pos = str.find(MAGIC_STR);
        // slice to next \0
        let pos = pos?;
        let str = &str[pos..];
        let pos = str.find('\0');
        let str = &str[..pos?];
        let str = &str[MAGIC_STR.len()..];
        let str = str.parse::<i32>().ok()?;
        Some(str)
    }

    let game_path = Path::new(game_path);

    check_file(game_path.join("Celeste.exe"))
        .or_else(|| {
            if let Ok(data) = std::fs::read(game_path.join("Celeste.exe"))
                && data
                    .windows(MAGIC_STR_ONLY_ORIGIN_EXE.len())
                    .any(|window| window == MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes())
            {
                None
            } else {
                check_file(game_path.join("Celeste.dll"))
            }
        })
        // Locally-built / development Everest packages do not necessarily embed
        // the EverestBuild marker. Celeste.Mod.mm.dll is an Everest-specific
        // installation artifact, so treat it as an installed development build.
        .or_else(|| game_path.join("Celeste.Mod.mm.dll").is_file().then_some(0))
}

const EVEREST_PARALLEL_LOAD_MARKERS: [&[u8]; 2] = [
    b"EVEREST_PARALLEL_LOAD",
    b"E\0V\0E\0R\0E\0S\0T\0_\0P\0A\0R\0A\0L\0L\0E\0L\0_\0L\0O\0A\0D\0",
];

pub fn is_everest_ultra(game_path: &Path) -> bool {
    std::fs::read(game_path.join("Celeste.Mod.mm.dll")).is_ok_and(|bytes| {
        EVEREST_PARALLEL_LOAD_MARKERS
            .iter()
            .any(|marker| bytes.windows(marker.len()).any(|window| window == *marker))
    })
}

fn run_command(
    installer_path: PathBuf,
    step_label: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let mut cmd = Command::new(&installer_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    let cmd = cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.current_dir(
        installer_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid installer path"))?,
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&installer_path)?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        std::fs::set_permissions(&installer_path, permissions)?;
    }

    let mut child = cmd.spawn()?;
    let stdout = child
        .stdout
        .take()
        .context("Failed to capture installer stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("Failed to capture installer stderr")?;
    let reader = BufReader::new(stdout);
    let stderr_handle = std::thread::spawn(move || {
        let mut lines = Vec::new();
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => lines.push(line),
                Err(err) => {
                    lines.push(format!("Failed to read installer stderr: {err}"));
                    break;
                }
            }
        }
        lines
    });

    let mut line_count = 0f32;
    for line in reader.lines() {
        let line = line?;
        line_count = (line_count + 1.0).min(99.0);
        progress_callback(format!("{step_label}: {line}"), line_count);
    }

    let status = child.wait()?;
    let stderr = stderr_handle
        .join()
        .unwrap_or_else(|_| vec!["Failed to join installer stderr reader".to_string()])
        .join("\n");

    if !status.success() {
        bail!("Command failed with error: {}", stderr);
    }

    progress_callback(step_label.to_string(), 100.0);

    Ok(())
}

#[cfg(target_os = "windows")]
fn installer_name() -> anyhow::Result<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("MiniInstaller-win64.exe"),
        "x86" => Ok("MiniInstaller-win.exe"),
        arch => bail!("Unsupported Windows architecture: {arch}"),
    }
}

#[cfg(target_os = "macos")]
fn installer_name() -> anyhow::Result<&'static str> {
    Ok("MiniInstaller-osx")
}

#[cfg(target_os = "linux")]
fn installer_name() -> anyhow::Result<&'static str> {
    Ok("MiniInstaller-linux")
}

pub fn is_everest_install_archive(path: &Path) -> anyhow::Result<bool> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    let expected_installer = format!("main/{}", installer_name()?);
    let mut has_installer = false;

    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let name = file.name();
        if name == expected_installer {
            has_installer = true;
        }
        if !name.starts_with("main/") {
            return Ok(false);
        }
    }

    Ok(has_installer)
}

fn install_everest_archive_with_steps(
    game_path: &Path,
    archive_path: &Path,
    extract_step: &str,
    installer_step: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    if !is_everest_install_archive(archive_path)? {
        bail!("The zip is not an Everest install package for this platform");
    }

    progress_callback(extract_step.to_string(), 0.0);

    let mut archive = zip::ZipArchive::new(std::fs::File::open(archive_path)?)?;
    let archive_len = archive.len();
    let backup_dir = game_path.join("backup");
    let generate_backup = false;

    for i in 0..archive_len {
        let mut file = archive.by_index(i)?;
        let dist_name = file.mangled_name().strip_prefix("main/")?.to_path_buf();
        let outpath = game_path.join(&dist_name);
        let status_str = format!("{extract_step}: {}", outpath.display());
        progress_callback(status_str, (i as f32) / (archive_len as f32) * 100.0);
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p)?;
            }

            if outpath.exists() && generate_backup {
                std::fs::create_dir_all(&backup_dir)?;
                let backpath = backup_dir.join(&dist_name);
                std::fs::create_dir_all(backpath.parent().unwrap())?;
                if backpath.exists() {
                    std::fs::remove_file(&backpath)?;
                }
                std::fs::rename(&outpath, backpath)?;
            }

            let mut outfile = std::fs::File::create(&outpath).with_context(|| {
                format!(
                    "Failed to replace {}. Close Celeste and any program using this file",
                    outpath.display()
                )
            })?;
            std::io::copy(&mut file, &mut outfile)
                .with_context(|| format!("Failed to extract {}", outpath.display()))?;
            outfile
                .flush()
                .with_context(|| format!("Failed to finish writing {}", outpath.display()))?;
        }
    }

    progress_callback(installer_step.to_string(), 0.0);
    run_command(
        game_path.join(installer_name()?),
        installer_step,
        progress_callback,
    )
}

pub fn install_everest_archive(
    game_path: &str,
    archive_path: &Path,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    install_everest_archive_with_steps(
        Path::new(game_path),
        archive_path,
        "[1/2] Extract local Everest package",
        "[2/2] Run MiniInstaller",
        progress_callback,
    )
}

pub fn download_and_install_everest(
    game_path: &str,
    url: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let temp_path = std::env::temp_dir().join("everest.zip");
    let game_path = std::path::Path::new(game_path);
    let cancel_flag = Arc::new(AtomicBool::new(false));

    ureq::download_file_with_progress(
        url,
        temp_path.to_string_lossy().as_ref(),
        &mut |callback| {
            progress_callback("[1/3] Download Everest".to_string(), callback.progress);
        },
        false,
        &cancel_flag,
    )?;

    install_everest_archive_with_steps(
        game_path,
        &temp_path,
        "[2/3] Extract Everest files",
        "[3/3] Run MiniInstaller",
        progress_callback,
    )
}

#[cfg(test)]
mod tests {
    use super::is_everest_ultra;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn detects_everest_ultra_marker_in_installed_binary() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time must be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "celemod-everest-ultra-test-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        let binary = root.join("Celeste.Mod.mm.dll");

        std::fs::write(
            &binary,
            "prefix\0EVEREST_PARALLEL_LOAD\0suffix"
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        )
        .expect("UTF-16 test binary should be written");
        assert!(is_everest_ultra(&root));

        std::fs::write(&binary, b"prefix\0EVEREST_PARALLEL_LOAD\0suffix")
            .expect("ASCII test binary should be written");
        assert!(is_everest_ultra(&root));

        std::fs::write(&binary, b"ordinary Everest binary")
            .expect("test binary should be replaced");
        assert!(!is_everest_ultra(&root));

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
