use crate::{ureq, wegfan};

use ::ureq::get;
use anyhow::{Context, bail};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::AtomicBool},
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfoCached {
    pub name: String,
    pub version: String,
    pub game_banana_id: i64,
    pub game_banana_file_id: i64,
    pub download_url: String,
}

static USING_CACHE: AtomicBool = AtomicBool::new(false);

pub fn is_using_cache() -> bool {
    USING_CACHE.load(std::sync::atomic::Ordering::Relaxed)
}

lazy_static! {
    static ref MOD_INFO_CACHED: Arc<HashMap<String, ModInfoCached>> = {
        let mods = match get_mod_online_wegfan() {
            Ok(fetched) => {
                save_mod_cache(&fetched);
                USING_CACHE.store(false, std::sync::atomic::Ordering::Relaxed);
                fetched
            }
            Err(e) => {
                eprintln!("Failed to fetch mod list: {}", e);
                if let Some(cached) = load_mod_cache() {
                    println!("Using cached mod list");
                    USING_CACHE.store(true, std::sync::atomic::Ordering::Relaxed);
                    cached
                } else {
                    eprintln!("No cache available");
                    USING_CACHE.store(false, std::sync::atomic::Ordering::Relaxed);
                    vec![]
                }
            }
        };
        let mods = mods.into_iter().map(|v| (v.name.clone(), v)).collect();
        Arc::new(mods)
    };
}

fn load_mod_cache() -> Option<Vec<ModInfoCached>> {
    let cache_path = std::env::current_dir().ok()?.join("mod_cache.json");
    let data = std::fs::read_to_string(cache_path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_mod_cache(mods: &[ModInfoCached]) {
    if let Ok(dir) = std::env::current_dir() {
        let cache_path = dir.join("mod_cache.json");
        if let Ok(data) = serde_json::to_string(mods) {
            let _ = std::fs::write(cache_path, data);
        }
    }
}

pub fn get_mod_online_wegfan() -> anyhow::Result<Vec<ModInfoCached>> {
    let mut response: serde_json::Value = get("https://celeste.weg.fan/api/v2/mod/list")
        .set(
            "User-Agent",
            &format!("CeleMod/{}-{}", env!("VERSION"), &env!("GIT_HASH")[..6]),
        )
        .timeout(std::time::Duration::from_secs(20))
        .set("Accept-Encoding", "gzip, deflate, br")
        .call()?
        .into_json()?;
    let mods: Vec<wegfan::Mod> = serde_json::from_value(response["data"].take())?;
    mods.into_iter()
        .map(|v| -> anyhow::Result<ModInfoCached> {
            Ok(ModInfoCached {
                game_banana_file_id: v.submission_file.game_banana_id.unwrap_or(-1),
                game_banana_id: v.submission_file.submission.game_banana_id.unwrap_or(-1),
                download_url: v.submission_file.url,
                name: v.name,
                version: v.version,
            })
        })
        .collect()
}

pub fn get_mod_cached_new() -> anyhow::Result<Arc<HashMap<String, ModInfoCached>>> {
    Ok(Arc::clone(&MOD_INFO_CACHED))
}

static MAGIC_STR: &str = "EverestBuild";
static MAGIC_STR_ONLY_ORIGIN_EXE: &str = "_StarJumpEnd+<StartCirclingPlayer>";

pub fn get_everest_version(game_path: &str) -> Option<i32> {
    fn check_file(path: PathBuf) -> Option<i32> {
        println!("Checking {}", path.display());
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

    let game_path = resolve_everest_install_path(Path::new(game_path));

    check_file(game_path.join("Celeste.exe"))
        .or_else(|| {
            if let Ok(data) = std::fs::read(game_path.join("Celeste.exe"))
                && data
                    .windows(MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes().len())
                    .any(|window| window == MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes())
            {
                None
            } else {
                check_file(game_path.join("Celeste.dll"))
            }
        })
        .or(None)
}

fn run_command(
    installer_path: PathBuf,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let mut cmd = Command::new(&installer_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
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

    let mut line_count = 50f32;
    for line in reader.lines() {
        let line = line?;
        line_count += 0.5;
        progress_callback(line, line_count);
    }

    let status = child.wait()?;
    let stderr = stderr_handle
        .join()
        .unwrap_or_else(|_| vec!["Failed to join installer stderr reader".to_string()])
        .join("\n");

    if !status.success() {
        bail!("Command failed with error: {}", stderr);
    }

    Ok(())
}

fn resolve_everest_install_path(game_path: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let bundled_resources = game_path
            .join("Celeste.app")
            .join("Contents")
            .join("Resources");
        if bundled_resources.exists() {
            return bundled_resources;
        }

        let resources = game_path.join("Contents").join("Resources");
        if resources.exists() {
            return resources;
        }
    }

    game_path.to_path_buf()
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

pub fn download_and_install_everest(
    game_path: &str,
    url: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let generate_backup = false;

    let temp_path = std::env::temp_dir().join("everest.zip");
    let temp_path = temp_path.to_str().unwrap();
    let game_path = resolve_everest_install_path(std::path::Path::new(game_path));
    let cancel_flag = Arc::new(AtomicBool::new(false));

    ureq::download_file_with_progress(
        url,
        temp_path,
        &mut |callback| {
            progress_callback("Downloading Everest".to_string(), callback.progress);
        },
        false,
        &cancel_flag,
    )?;

    progress_callback("Installing Everest".to_string(), 50.0);

    // unzip everest/main/* to game_path and overwrite all
    let mut archive = zip::ZipArchive::new(std::fs::File::open(temp_path)?)?;
    let archive_len = archive.len();

    let backup_dir = game_path.join("backup");

    for i in 0..archive_len {
        let mut file = archive.by_index(i)?;
        let dist_name = file.mangled_name();
        // strip /main/ from the name
        let dist_name = dist_name.strip_prefix("main/")?;
        let outpath = game_path.join(dist_name);
        let status_str = format!("Extracting {}", outpath.display());
        progress_callback(status_str, 50.0 + (i as f32) / (archive_len as f32) * 40.0);
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)?;
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p)?;
            }

            if outpath.exists() && generate_backup {
                std::fs::create_dir_all(&backup_dir)?;
                let backpath = backup_dir.join(dist_name);
                std::fs::create_dir_all(backpath.parent().unwrap())?;
                if backpath.exists() {
                    std::fs::remove_file(&backpath)?;
                }
                std::fs::rename(&outpath, backpath)?;
            }

            let mut outfile = std::fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
            outfile.flush()?;
        }
    }

    progress_callback("Running Everest installer".to_string(), 90.0);
    let installer_path = game_path.join(installer_name()?);

    run_command(installer_path, progress_callback)
}
