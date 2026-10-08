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

static CATALOG_OFFLINE: AtomicBool = AtomicBool::new(false);
static CATALOG_REQUEST_GENERATION: AtomicU64 = AtomicU64::new(0);
// Downloads that are still running because a caller stopped waiting for them
// (see CATALOG_SOFT_TIMEOUT). The UI polls this to know that a fresh catalog is
// on its way, so a slow connection is not mistaken for an offline one.
static CATALOG_DOWNLOADS_IN_FLIGHT: AtomicU64 = AtomicU64::new(0);

/// How long the catalog download itself may take. This is only a bound for a
/// server that stops sending: the first screen no longer blocks on the download
/// (see [`CATALOG_SOFT_TIMEOUT`]), so the request may be given the room a slow
/// connection needs instead of being cut short.
const CATALOG_FETCH_TIMEOUT: Duration = Duration::from_secs(60);
/// How long a caller waits for the catalog before continuing with whatever is
/// already cached. The download keeps running in the background and publishes
/// its response when it lands, so exceeding this is a slow connection rather
/// than an offline server.
const CATALOG_SOFT_TIMEOUT: Duration = Duration::from_secs(8);
/// Polling granularity of `wait_for_catalog`: the worker is checked at least
/// this often so a cancellation is noticed quickly.
const CATALOG_POLL_INTERVAL: Duration = Duration::from_millis(100);

pub fn set_catalog_offline(offline: bool) {
    CATALOG_OFFLINE.store(offline, Ordering::SeqCst);
    CATALOG_REQUEST_GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn is_catalog_offline() -> bool {
    CATALOG_OFFLINE.load(Ordering::SeqCst)
}

pub fn is_catalog_downloading() -> bool {
    CATALOG_DOWNLOADS_IN_FLIGHT.load(Ordering::SeqCst) > 0
}

static USING_CACHE: AtomicBool = AtomicBool::new(false);
static MOD_CACHE_TTL_SECONDS: AtomicU64 = AtomicU64::new(60 * 60);

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
    // Several startup paths can ask for the catalog at the same time (for
    // example the installed-Mod scan and the local catalog page). Serialize
    // cache misses so they share the state populated by the first request
    // instead of all fetching the same catalog concurrently.
    static ref MOD_CATALOG_LOAD_LOCK: Mutex<()> = Mutex::new(());
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
        .timeout(CATALOG_FETCH_TIMEOUT)
        .set("Accept-Encoding", "gzip, deflate, br")
        .call()?
        .into_string()?)
}

/// How a wait for the catalog worker ended.
enum CatalogWait {
    /// The worker answered, successfully or not.
    Finished(anyhow::Result<String>),
    /// The caller ran out of patience while the worker keeps downloading. This
    /// is not a failure: the response is still on its way.
    StillDownloading,
    /// The request was cancelled: offline mode was enabled or a newer request
    /// superseded this one.
    Skipped,
}

/// The catalog download is still running even though the caller stopped waiting
/// for it. Unlike a network failure this must not switch the app to offline
/// mode, because the response is on its way and will be published as soon as it
/// lands.
#[derive(Debug)]
struct CatalogDownloadPending;

impl std::fmt::Display for CatalogDownloadPending {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Mod catalog is still downloading; continuing with the cached catalog"
        )
    }
}

impl std::error::Error for CatalogDownloadPending {}

/// A catalog fetch that only ran out of time is not evidence of an unreachable
/// server, so it must not latch offline mode for the rest of the session.
fn is_catalog_download_pending(error: &anyhow::Error) -> bool {
    error.downcast_ref::<CatalogDownloadPending>().is_some()
}

/// Whether a finished response still belongs to the request the app wants.
fn request_is_still_wanted(offline: bool, current_generation: u64, generation: u64) -> bool {
    !offline && current_generation == generation
}

/// A skipped request must never overwrite the cache with a late response or
/// latch offline mode for it.
fn catalog_response_is_still_wanted(generation: u64) -> bool {
    request_is_still_wanted(
        is_catalog_offline(),
        CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst),
        generation,
    )
}

// The worker outlives the caller: a slow connection is not a reason to throw a
// response away, but a cancelled request must still publish nothing.
fn fetch_catalog_interruptible() -> anyhow::Result<String> {
    let generation = CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst);
    let (sender, receiver) = std::sync::mpsc::channel();
    CATALOG_DOWNLOADS_IN_FLIGHT.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        let result = fetch_raw_catalog();
        let still_wanted = catalog_response_is_still_wanted(generation);
        match &result {
            // Nobody may be waiting for a slow connection anymore: keep the
            // response in the cache so the next catalog read (or the frontend
            // retry) picks it up instead of giving up on it.
            Ok(raw) if still_wanted => save_raw_cache(raw),
            // Remember an unreachable server even when the caller already moved
            // on, so local operations stop retrying it in a loop.
            Err(_) if still_wanted => CATALOG_OFFLINE.store(true, Ordering::SeqCst),
            _ => {}
        }
        CATALOG_DOWNLOADS_IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
        let _ = sender.send(result);
    });
    match wait_for_catalog(receiver, CATALOG_SOFT_TIMEOUT, || {
        is_catalog_offline() || CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst) != generation
    }) {
        CatalogWait::Finished(result) => result,
        CatalogWait::StillDownloading => Err(CatalogDownloadPending.into()),
        CatalogWait::Skipped => bail!("Mod catalog download skipped"),
    }
}

fn wait_for_catalog(
    receiver: std::sync::mpsc::Receiver<anyhow::Result<String>>,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> CatalogWait {
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() >= timeout {
            return CatalogWait::StillDownloading;
        }
        if cancelled() {
            return CatalogWait::Skipped;
        }
        match receiver.recv_timeout(CATALOG_POLL_INTERVAL) {
            Ok(result) => return CatalogWait::Finished(result),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return CatalogWait::Finished(Err(anyhow::anyhow!(
                    "Mod catalog worker stopped without a response"
                )));
            }
        }
    }
}

fn offline_catalog() -> anyhow::Result<ModCatalogState> {
    USING_CACHE.store(true, Ordering::Relaxed);
    if let Some(mut state) = MOD_CATALOG_STATE.lock().unwrap().clone() {
        state.status.source = "stale-cache".into();
        return Ok(state);
    }
    if let Some((raw, modified)) = read_raw_cache() {
        return catalog_state_from_raw(raw, "stale-cache", modified);
    }
    USING_CACHE.store(false, Ordering::Relaxed);
    bail!("Mod catalog unavailable offline; installed Mods remain available")
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
    if is_catalog_offline() {
        return offline_catalog();
    }
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

    let generation = CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst);
    match fetch_catalog_interruptible().and_then(|raw| {
        let state = catalog_state_from_raw(raw.clone(), "network", SystemTime::now())?;
        if is_catalog_offline() || CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst) != generation {
            bail!("Mod catalog download skipped");
        }
        save_raw_cache(&raw);
        Ok(state)
    }) {
        Ok(state) => {
            USING_CACHE.store(false, Ordering::Relaxed);
            Ok(state)
        }
        Err(network_error) => {
            // A download that is still running is not an offline server: serve
            // the cached catalog, keep offline mode off, and let the background
            // download publish the fresh catalog once it lands.
            if is_catalog_download_pending(&network_error) {
                return offline_catalog().map_err(|_| network_error);
            }
            crate::logging::error(format_args!(
                "Failed to fetch Mod catalog: {network_error:#}"
            ));
            // Avoid retrying an unreachable server for every local operation.
            if CATALOG_REQUEST_GENERATION.load(Ordering::SeqCst) == generation {
                CATALOG_OFFLINE.store(true, Ordering::SeqCst);
            }
            offline_catalog().map_err(|_| network_error)
        }
    }
}

fn catalog(force_refresh: bool) -> anyhow::Result<ModCatalogState> {
    let _load_guard = MOD_CATALOG_LOAD_LOCK.lock().unwrap();
    let state = load_catalog(force_refresh)?;
    *MOD_CATALOG_STATE.lock().unwrap() = Some(state.clone());
    Ok(state)
}

pub fn set_mod_cache_ttl(seconds: u64) {
    MOD_CACHE_TTL_SECONDS.store(seconds, Ordering::Relaxed);
}

pub fn get_mod_cache_ttl_seconds() -> u64 {
    MOD_CACHE_TTL_SECONDS.load(Ordering::Relaxed)
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
    #[cfg(target_os = "android")]
    return crate::android::install_everest(&installer_path, step_label, progress_callback);
    #[cfg(not(target_os = "android"))]
    {
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
}

#[cfg(target_os = "android")]
fn installer_name() -> anyhow::Result<&'static str> {
    Ok("MiniInstaller.dll")
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
    #[cfg(target_os = "android")]
    crate::android::can_install()?;
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
        let safe_name = file
            .enclosed_name()
            .context("Unsafe Everest archive path")?;
        let dist_name = safe_name.strip_prefix("main/")?.to_path_buf();
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
    let pause_flag = Arc::new(AtomicBool::new(false));

    ureq::download_file_with_progress(
        url,
        temp_path.to_string_lossy().as_ref(),
        &mut |callback| {
            progress_callback("[1/3] Download Everest".to_string(), callback.progress);
        },
        false,
        &cancel_flag,
        &pause_flag,
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
    use super::{CatalogWait, is_everest_ultra, wait_for_catalog};
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn offline_catalog_reuses_stale_memory_even_for_forced_refresh() {
        let state =
            super::catalog_state_from_raw(r#"{"data":[]}"#.into(), "network", UNIX_EPOCH).unwrap();
        let previous = super::MOD_CATALOG_STATE.lock().unwrap().replace(state);
        super::set_catalog_offline(true);
        let result = super::load_catalog(true);
        super::set_catalog_offline(false);
        *super::MOD_CATALOG_STATE.lock().unwrap() = previous;
        super::USING_CACHE.store(false, super::Ordering::Relaxed);
        let cached = result.unwrap();
        assert_eq!(cached.status.source, "stale-cache");
        assert_eq!(cached.status.updated_at, 0);
        assert_eq!(cached.raw, r#"{"data":[]}"#);
    }

    #[test]
    fn catalog_wait_returns_success_and_network_errors() {
        let (sender, receiver) = std::sync::mpsc::channel();
        sender.send(Ok("catalog".into())).unwrap();
        match wait_for_catalog(receiver, Duration::from_secs(1), || false) {
            CatalogWait::Finished(Ok(raw)) => assert_eq!(raw, "catalog"),
            _ => panic!("a received response must finish the wait"),
        }
        let (sender, receiver) = std::sync::mpsc::channel();
        sender.send(Err(anyhow::anyhow!("no network"))).unwrap();
        match wait_for_catalog(receiver, Duration::from_secs(1), || false) {
            CatalogWait::Finished(Err(error)) => {
                assert!(error.to_string().contains("no network"))
            }
            _ => panic!("a worker error must finish the wait"),
        }
    }

    #[test]
    fn catalog_skip_discards_even_an_already_received_response() {
        let (sender, receiver) = std::sync::mpsc::channel();
        sender.send(Ok("late catalog".into())).unwrap();
        assert!(matches!(
            wait_for_catalog(receiver, Duration::from_secs(1), || true),
            CatalogWait::Skipped
        ));
    }

    #[test]
    fn slow_catalog_download_keeps_the_wait_open_instead_of_failing() {
        // A connection that is merely slow must not be reported as an error:
        // the download keeps running and publishes the catalog when it lands.
        let (_sender, receiver) = std::sync::mpsc::channel();
        assert!(matches!(
            wait_for_catalog(receiver, Duration::from_millis(1), || false),
            CatalogWait::StillDownloading
        ));
    }

    #[test]
    fn catalog_wait_handles_worker_failure() {
        let (sender, receiver) = std::sync::mpsc::channel();
        drop(sender);
        assert!(matches!(
            wait_for_catalog(receiver, Duration::from_secs(1), || false),
            CatalogWait::Finished(Err(_))
        ));
    }

    #[test]
    fn only_real_catalog_failures_switch_to_offline_mode() {
        // The regression behind the slow-network bug: running out of the 8s
        // wait used to latch offline mode and drop the response that was still
        // on its way.
        assert!(super::is_catalog_download_pending(
            &super::CatalogDownloadPending.into()
        ));
        assert!(!super::is_catalog_download_pending(&anyhow::anyhow!(
            "no network"
        )));
    }

    #[test]
    fn late_catalog_responses_are_only_published_while_still_wanted() {
        // A response that lands after the caller gave up is still published, so
        // a slow connection ends up with a fresh catalog. A request that was
        // cancelled (offline mode or a newer request) must be dropped instead.
        assert!(super::request_is_still_wanted(false, 7, 7));
        assert!(!super::request_is_still_wanted(true, 7, 7));
        assert!(!super::request_is_still_wanted(false, 8, 7));
    }

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
