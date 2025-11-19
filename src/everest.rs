use crate::{aria2c, wegfan};

use anyhow::bail;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{atomic::AtomicBool, Arc},
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
    let mut response: serde_json::Value = ureq::get("https://celeste.weg.fan/api/v2/mod/list")
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
    fn check_file(path: String) -> Option<i32> {
        println!("Checking {path}");
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

    check_file(game_path.to_owned() + "/Celeste.exe")
        .or_else(|| {
            if let Ok(data) = std::fs::read(game_path.to_owned() + "/Celeste.exe")
                && data
                    .windows(MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes().len())
                    .any(|window| window == MAGIC_STR_ONLY_ORIGIN_EXE.as_bytes())
            {
                None
            } else {
                check_file(game_path.to_owned() + "/Celeste.dll")
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
    const DETACHED_PROCESS: u32 = 0x00000008;
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    #[cfg(target_os = "windows")]
    let cmd = cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.current_dir(
        installer_path
            .parent()
            .ok_or_else(|| anyhow::anyhow!("Invalid installer path"))?,
    );

    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);

    let mut line_count = 50f32;
    for line in reader.lines() {
        let line = line?;
        line_count += 0.5;
        progress_callback(line, line_count);
    }

    let output = child.wait_with_output()?;

    let stderr = String::from_utf8(output.stderr)?;

    if !output.status.success() {
        bail!("Command failed with error: {}", stderr);
    }

    Ok(())
}

pub fn download_and_install_everest(
    game_path: &str,
    url: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let generate_backup = false;

    let temp_path = std::env::temp_dir().join("everest.zip");
    let game_path = std::path::Path::new(game_path);

    let temp_path = temp_path.to_str().unwrap();
    let game_path = game_path.to_str().unwrap();

    aria2c::download_file_with_progress(
        url,
        temp_path,
        &mut |callback| {
            progress_callback("Downloading Everest".to_string(), callback.progress);
        },
        false,
    )?;

    progress_callback("Installing Everest".to_string(), 50.0);

    // unzip everest/main/* to game_path and overwrite all
    let mut archive = zip::ZipArchive::new(std::fs::File::open(temp_path)?)?;
    let archive_len = archive.len();

    let backup_dir = std::path::Path::new(game_path).join("backup");

    for i in 0..archive_len {
        let mut file = archive.by_index(i)?;
        let dist_name = file.mangled_name();
        // strip /main/ from the name
        let dist_name = dist_name.strip_prefix("main/")?;
        let outpath = std::path::Path::new(game_path).join(dist_name);
        let status_str = format!("Extracting {}", outpath.display());
        progress_callback(
            status_str,
            (i as f32) / (archive_len as f32) / 2f32 * 100f32,
        );
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
        }
    }

    let target = match std::env::consts::ARCH {
        "x86_64" => "win-x64",
        "x86" => "win-x86",
        _ => unimplemented!("Unsupported target"),
    };

    let installer_name = match target {
        "win-x64" => "MiniInstaller-win64.exe",
        "win-x86" => "MiniInstaller-win.exe",
        _ => unimplemented!("Unsupported target"),
    };

    let installer_path = std::path::Path::new(game_path).join(installer_name);

    run_command(installer_path, progress_callback)
}
