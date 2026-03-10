#![feature(try_blocks)]
#![feature(slice_pattern)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

use anyhow::{Context, bail};
use ureq::DownloadCallbackInfo;
use dirs;
use everest::get_mod_cached_new;
use game_scanner::prelude::Game;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, atomic::{AtomicBool, AtomicUsize, Ordering}},
};

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

extern crate msgbox;

use sciter::{GFX_LAYER, Value, dispatch_script_call, make_args};

extern crate lazy_static;
extern crate sciter;

mod ureq;
mod blacklist;
mod everest;
mod wegfan;

#[macro_use]
extern crate include_bytes_zstd;

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

struct Handler;

fn extract_mod_for_yaml(path: &PathBuf) -> anyhow::Result<serde_yaml::Value> {
    let zipfile = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(zipfile)?;
    let everest_name = archive
        .file_names()
        .find(|name| name == &"everest.yaml" || name == &"everest.yml")
        .context("Failed to find everest.yaml")?
        .to_string();

    let everest = archive.by_name(&everest_name);
    if let Ok(mut file) = everest {
        use std::io::prelude::*;

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)?;
        let cache_dir = path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("celemod_yaml_cache");
        std::fs::create_dir_all(&cache_dir)?;

        let mut file = std::fs::File::create(
            cache_dir.join(path.with_extension("yaml").file_name().unwrap()),
        )?;
        file.write_all(&buffer)?;
        use strip_bom::StripBom;
        Ok(serde_yaml::from_str(
            String::from_utf8(buffer)?.strip_bom(),
        )?)
    } else {
        bail!("Failed to get everest.yaml")
    }
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

    for entry in fs::read_dir(mods_folder_path).unwrap() {
        let entry = entry.unwrap();
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
) -> anyhow::Result<Vec<(String, String)>> {
    ureq::download_file_with_progress(url, dest, progress_callback, multi_thread)?;

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

fn rm_mod(mods_folder_path: &str, mod_name: &str) -> anyhow::Result<()> {
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
}

fn make_path_compatible_name(name: &str) -> String {
    name.replace([' ', ':', '/', '\\', '?', '*', '\"', '<', '>', '|'], "_")
}

impl Handler {
    fn download_mod(
        &self,
        name: String,
        url: String,
        mods_dir: String,
        auto_disable_new_mods: bool,
        callback: sciter::Value,
        _use_cn_proxy: bool,
        multi_thread: bool,
    ) {
        let dest = Path::new(&mods_dir)
            .join(make_path_compatible_name(&name) + ".zip")
            .to_str()
            .unwrap()
            .to_string();
        std::thread::spawn(move || {
            // tasklist is shared across all download threads
            let tasklist: Arc<Mutex<Vec<DownloadInfo>>> = Arc::new(Mutex::new(Vec::new()));
            // track queued dep names to avoid duplicates
            let queued_deps: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
            // count of active download threads (including the root)
            let active_count: Arc<AtomicUsize> = Arc::new(AtomicUsize::new(0));
            // whether any task has failed
            let any_failed: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

            let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();

            {
                let mut tl = tasklist.lock().unwrap();
                tl.push(DownloadInfo {
                    name: name.clone(),
                    url: url.clone(),
                    dest: dest.clone(),
                    status: DownloadStatus::Waiting,
                    data: "".to_string(),
                });
                queued_deps.lock().unwrap().insert(name.clone());
            }

            let mod_data = match get_mod_cached_new() {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("Failed to get mod data: {}", e);
                    callback
                        .call(None, &make_args!(format!("Failed to get mod data: {}", e)), None)
                        .unwrap();
                    return;
                }
            };

            // post_callback is called with the current tasklist snapshot
            // Wrap callback in a newtype to make it Sync (sciter::Value is Send but not Sync;
            // Value::call posts to the UI thread internally so concurrent calls are safe)
            struct SyncCallback(sciter::Value);
            unsafe impl Sync for SyncCallback {}
            let sync_cb = Arc::new(SyncCallback(callback.clone()));
            let post_callback: Arc<dyn Fn(&Vec<DownloadInfo>, &str) + Send + Sync> = {
                let sync_cb = Arc::clone(&sync_cb);
                Arc::new(move |tasklist: &Vec<DownloadInfo>, state: &str| {
                    sync_cb.0
                        .call(
                            None,
                            &make_args!(serde_json::to_string(tasklist).unwrap(), state),
                            None,
                        )
                        .unwrap();
                })
            };

            // Spawn a download task for a single mod entry (by index in tasklist)
            // Returns the thread handle
            fn spawn_download_task(
                task_index: usize,
                tasklist: Arc<Mutex<Vec<DownloadInfo>>>,
                queued_deps: Arc<Mutex<HashSet<String>>>,
                active_count: Arc<AtomicUsize>,
                any_failed: Arc<AtomicBool>,
                mod_data: Arc<std::collections::HashMap<String, crate::everest::ModInfoCached>>,
                mods_dir: String,
                multi_thread: bool,
                post_callback: Arc<dyn Fn(&Vec<DownloadInfo>, &str) + Send + Sync>,
                done_tx: std::sync::mpsc::Sender<()>,
            ) {
                active_count.fetch_add(1, Ordering::SeqCst);
                std::thread::spawn(move || {
                    let task_info = {
                        let tl = tasklist.lock().unwrap();
                        tl[task_index].clone()
                    };

                    // Update status to Downloading
                    {
                        let mut tl = tasklist.lock().unwrap();
                        tl[task_index].status = DownloadStatus::Downloading;
                        post_callback(&tl, "pending");
                    }

                    let result = {
                        let tasklist_clone = Arc::clone(&tasklist);
                        let post_cb_clone = Arc::clone(&post_callback);
                        download_and_install_mod(
                            &task_info.url,
                            &task_info.dest,
                            &mut move |progress| {
                                let mut tl = tasklist_clone.lock().unwrap();
                                tl[task_index].data = format!("{:.2}", progress.progress);
                                tl[task_index].status = DownloadStatus::Downloading;
                                post_cb_clone(&tl, "pending");
                            },
                            multi_thread,
                        )
                    };

                    match result {
                        Ok(deps) => {
                            {
                                let mut tl = tasklist.lock().unwrap();
                                tl[task_index].status = DownloadStatus::Finished;
                                tl[task_index].data = "100".to_string();
                                post_callback(&tl, "pending");
                            }

                            println!("Deps for {}: {deps:#?}", task_info.name);

                            // Queue new dependency downloads
                            let installed_mods = get_installed_mods_sync(mods_dir.clone());
                            let new_tasks: Vec<DownloadInfo> = {
                                let mut queued = queued_deps.lock().unwrap();
                                deps.into_iter()
                                    .filter_map(|(dep, min_ver)| {
                                        if installed_mods.iter().any(|m| {
                                            m.name == dep && compare_version(&m.version, &min_ver) >= 0
                                        }) {
                                            return None;
                                        }
                                        if queued.contains(&dep) {
                                            return None;
                                        }
                                        if let Some(data) = mod_data.get(&dep) {
                                            queued.insert(dep.clone());
                                            let dep_dest = Path::new(&mods_dir)
                                                .join(make_path_compatible_name(&dep) + ".zip")
                                                .to_str()
                                                .unwrap()
                                                .to_string();
                                            Some(DownloadInfo {
                                                name: dep,
                                                url: data.download_url.clone(),
                                                dest: dep_dest,
                                                status: DownloadStatus::Waiting,
                                                data: "0".to_string(),
                                            })
                                        } else {
                                            println!("[ WARNING ] Failed to resolve {dep}");
                                            None
                                        }
                                    })
                                    .collect()
                            };

                            // Add new tasks to tasklist and spawn threads for each
                            let new_indices: Vec<usize> = {
                                let mut tl = tasklist.lock().unwrap();
                                let start = tl.len();
                                tl.extend(new_tasks);
                                (start..tl.len()).collect()
                            };

                            for idx in new_indices {
                                spawn_download_task(
                                    idx,
                                    Arc::clone(&tasklist),
                                    Arc::clone(&queued_deps),
                                    Arc::clone(&active_count),
                                    Arc::clone(&any_failed),
                                    Arc::clone(&mod_data),
                                    mods_dir.clone(),
                                    multi_thread,
                                    Arc::clone(&post_callback),
                                    done_tx.clone(),
                                );
                            }
                        }
                        Err(e) => {
                            any_failed.store(true, Ordering::SeqCst);
                            let mut tl = tasklist.lock().unwrap();
                            tl[task_index].status = DownloadStatus::Failed;
                            tl[task_index].data = e.to_string();
                            let _ = fs::remove_file(&tl[task_index].dest);
                            post_callback(&tl, "failed");
                        }
                    }

                    // Decrement active count; if zero, signal done
                    if active_count.fetch_sub(1, Ordering::SeqCst) == 1 {
                        let _ = done_tx.send(());
                    }
                });
            }

            // Kick off download for the root mod (index 0)
            spawn_download_task(
                0,
                Arc::clone(&tasklist),
                Arc::clone(&queued_deps),
                Arc::clone(&active_count),
                Arc::clone(&any_failed),
                Arc::clone(&mod_data),
                mods_dir.clone(),
                multi_thread,
                Arc::clone(&post_callback),
                done_tx,
            );

            // Wait for all downloads to complete
            let _ = done_rx.recv();

            if any_failed.load(Ordering::SeqCst) {
                // already reported "failed" from the failing thread
                return;
            }

            // Auto-disable new mods if enabled
            let res: anyhow::Result<()> = try {
                if auto_disable_new_mods {
                    let game_path = Path::new(&mods_dir)
                        .parent()
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .to_string();
                    let profiles = blacklist::get_mod_blacklist_profiles(&game_path);
                    let new_mods: Vec<String> = {
                        let tl = tasklist.lock().unwrap();
                        tl.iter()
                            .filter(|t| t.status == DownloadStatus::Finished)
                            .map(|t| t.name.clone())
                            .collect()
                    };
                    if !new_mods.is_empty() {
                        let installed_mods = get_installed_mods_sync(mods_dir.clone());
                        let mods_to_disable: Vec<(&String, &String)> = new_mods
                            .iter()
                            .filter_map(|name| {
                                installed_mods
                                    .iter()
                                    .find(|m| m.name == *name)
                                    .map(|m| (&m.name, &m.file))
                            })
                            .collect();
                        if !mods_to_disable.is_empty() {
                            for profile in profiles {
                                blacklist::switch_mod_blacklist_profile(
                                    &game_path,
                                    &profile.name,
                                    mods_to_disable.clone(),
                                    false,
                                )?;
                            }
                        }
                    }
                }
                println!("Download finished");
                let tl = tasklist.lock().unwrap();
                post_callback(&tl, "finished");
            };

            if let Err(e) = res {
                eprintln!("Failed post-download: {}", e);
                callback
                    .call(None, &make_args!(format!("Failed: {}", e)), None)
                    .unwrap();
            }
        });
    }

    fn get_celeste_dirs(&self) -> String {
        if is_test_mode() {
            return get_test_game_path().to_string_lossy().to_string();
        }
        get_celestes()
            .iter()
            .map(|game| game.path.clone().unwrap().to_str().unwrap().to_string())
            .collect::<Vec<String>>()
            .join("\n")
    }

    fn start_game(&self, path: String) {
        let celestes = get_celestes();
        let game = celestes
            .iter()
            .find(|game| game.path.clone().unwrap().to_str().unwrap() == path)
            .unwrap();
        game_scanner::manager::launch_game(game).unwrap();
    }

    fn start_game_directly(&self, path: String, origin: bool) {
        #[cfg(windows)]
        let file = "Celeste.exe";

        #[cfg(unix)]
        let file = "Celeste";

        let game = Path::new(&path).join(file);
        let game_origin = Path::new(&path).join("orig").join(file);

        if origin {
            if game_origin.exists() {
                std::process::Command::new(game_origin)
                    .arg("--vanilla")
                    .spawn()
                    .unwrap();
            } else {
                std::process::Command::new(game).spawn().unwrap();
            }
        } else {
            std::process::Command::new(game).spawn().unwrap();
        }
    }

    fn get_installed_mod_ids(&self, mods_folder_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let installed_mod_ids = get_installed_mods_sync(mods_folder_path)
                .into_iter()
                .map(|v| v.game_banana_id.to_string())
                .collect::<Vec<_>>();
            callback
                .call(None, &make_args!(installed_mod_ids.join("\n")), None)
                .unwrap();
        });
    }

    fn get_installed_miaonet(&self, mods_folder_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let installed = get_installed_mods_sync(mods_folder_path)
                .into_iter()
                .any(|p| p.name == "Miao.CelesteNet.Client");
            callback.call(None, &make_args!(installed), None).unwrap();
        });
    }

    fn get_installed_mods(&self, mods_folder_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let installed_mods = get_installed_mods_sync(mods_folder_path);
            callback
                .call(
                    None,
                    &make_args!(serde_json::to_string(&installed_mods).unwrap()),
                    None,
                )
                .unwrap();
        });
    }

    fn get_blacklist_profiles(&self, game_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let profiles = blacklist::get_mod_blacklist_profiles(&game_path);
            callback
                .call(
                    None,
                    &make_args!(serde_json::to_string(&profiles).unwrap()),
                    None,
                )
                .unwrap();
        });
    }

    fn apply_blacklist_profile(
        &self,
        game_path: String,
        profile_name: String,
        always_on_mods: String,
    ) -> String {
        let always_on_mods: Vec<String> = serde_json::from_str(&always_on_mods).unwrap();
        let result =
            blacklist::apply_mod_blacklist_profile(&game_path, &profile_name, &always_on_mods);
        if let Err(e) = result {
            eprintln!("Failed to apply blacklist profile: {}", e);
            format!("Failed to apply blacklist profile: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn switch_mod_blacklist_profile(
        &self,
        game_path: String,
        profile_name: String,
        mod_names: String,
        mod_files: String,
        enabled: bool,
    ) -> String {
        let mod_names: Vec<String> = serde_json::from_str(&mod_names).unwrap();
        let mod_files: Vec<String> = serde_json::from_str(&mod_files).unwrap();
        let mods: Vec<(&String, &String)> = mod_names.iter().zip(mod_files.iter()).collect();

        let result =
            blacklist::switch_mod_blacklist_profile(&game_path, &profile_name, mods, enabled);
        if let Err(e) = result {
            eprintln!("Failed to switch blacklist profile: {}", e);
            format!("Failed to switch blacklist profile: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn new_mod_blacklist_profile(&self, game_path: String, profile_name: String) -> String {
        let result = blacklist::new_mod_blacklist_profile(&game_path, &profile_name);
        if let Err(e) = result {
            eprintln!("Failed to create blacklist profile: {}", e);
            format!("Failed to create blacklist profile: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn get_current_profile(&self, game_path: String) -> String {
        let result = blacklist::get_current_profile(&game_path);
        if let Err(e) = result {
            eprintln!("Failed to get current profile: {}", e);
            format!("Failed to get current profile: {}", e)
        } else {
            result.unwrap()
        }
    }

    fn remove_mod_blacklist_profile(&self, game_path: String, profile_name: String) -> String {
        let result = blacklist::remove_mod_blacklist_profile(&game_path, &profile_name);
        if let Err(e) = result {
            eprintln!("Failed to remove blacklist profile: {}", e);
            format!("Failed to remove blacklist profile: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn get_current_blacklist_content(&self, game_path: String) -> String {
        let result = blacklist::get_current_blacklist_content(&game_path);
        if let Err(e) = result {
            eprintln!("Failed to get current blacklist content: {}", e);
            "".to_string()
        } else {
            result.unwrap()
        }
    }

    fn is_using_cache(&self) -> bool {
        everest::is_using_cache()
    }

    fn get_database_path(&self) -> String {
        use std::io::Read;

        // Get home directory
        let home_dir = match dirs::home_dir() {
            Some(dir) => dir,
            None => {
                // Fallback to current directory
                return "./cele-mod.db".to_string();
            }
        };

        let celemod_dir = home_dir.join(".celemod");
        let new_path = celemod_dir.join("cele-mod.db");

        // Old paths
        let old_cwd_path = Path::new("./cele-mod.db").to_path_buf();
        let old_parent_path = Path::new("../../cele-mod.db").to_path_buf();

        // Ensure ~/.celemod directory exists
        let _ = std::fs::create_dir_all(&celemod_dir);

        // Check if old database exists and new one doesn't
        let old_db_path = if old_parent_path.exists() {
            Some(old_parent_path)
        } else if old_cwd_path.exists() {
            Some(old_cwd_path)
        } else {
            None
        };

        if let Some(old_path) = old_db_path {
            if !new_path.exists() {
                // Migrate old database to new location
                println!("Migrating database from {:?} to {:?}", old_path, new_path);
                match std::fs::read(&old_path) {
                    Ok(data) => match std::fs::write(&new_path, &data) {
                        Ok(_) => {
                            let _ = std::fs::remove_file(&old_path);
                            println!("Database migration completed");
                        }
                        Err(e) => {
                            eprintln!("Failed to write new database: {}", e);
                            return old_path.to_string_lossy().to_string();
                        }
                    },
                    Err(e) => {
                        eprintln!("Failed to read old database: {}", e);
                        return old_path.to_string_lossy().to_string();
                    }
                }
            }
        }

        new_path.to_string_lossy().to_string()
    }

    fn sync_blacklist_profile_from_file(&self, game_path: String, profile_name: String) -> String {
        let result = blacklist::sync_blacklist_profile_from_file(&game_path, &profile_name);
        if let Err(e) = result {
            eprintln!("Failed to sync blacklist profile: {}", e);
            format!("Failed to sync blacklist profile: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn set_mod_options_order(&self, game_path: String, profile_name: String, order_json: String) -> String {
        let order: Vec<String> = match serde_json::from_str(&order_json) {
            Ok(v) => v,
            Err(e) => return format!("Failed to parse order: {}", e),
        };
        let result = blacklist::set_mod_options_order(&game_path, &profile_name, order);
        if let Err(e) = result {
            eprintln!("Failed to set mod options order: {}", e);
            format!("Failed to set mod options order: {}", e)
        } else {
            "Success".to_string()
        }
    }

    fn open_url(&self, url: String) {
        if let Err(e) = open::that(url) {
            eprintln!("Failed to open url: {}", e);
        }
    }

    fn get_mod_update(&self, name: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let res: anyhow::Result<(String, String)> = try {
                let mods = get_mod_cached_new()?;
                let name = &mods[&name];
                (name.game_banana_file_id.to_string(), name.version.clone())
            };

            let data = if let Ok(data) = res {
                serde_json::to_string(&data).unwrap()
            } else {
                "".to_string()
            };

            callback.call(None, &make_args!(data), None).unwrap();
        });
    }

    fn get_mod_latest_info(&self, callback: sciter::Value) {
        std::thread::spawn(move || {
            let res: anyhow::Result<Vec<(String, String, String, String)>> = try {
                let mods = get_mod_cached_new()?;
                mods.iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            v.version.clone(),
                            v.game_banana_file_id.to_string(),
                            v.download_url.clone(),
                        )
                    })
                    .collect()
            };

            let data = if let Ok(data) = res {
                serde_json::to_string(&data).unwrap()
            } else {
                "[]".to_string()
            };

            callback.call(None, &make_args!(data), None).unwrap();
        });
    }

    fn rm_mod(&self, mods_folder_path: String, mod_name: String) {
        std::thread::spawn(move || {
            if let Err(e) = rm_mod(&mods_folder_path, &mod_name) {
                eprintln!("Failed to remove mod: {}", e);
            }
        });
    }

    fn delete_mods(&self, game_path: String, mod_names: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let mods_folder_path = Path::new(&game_path)
                .join("Mods")
                .to_string_lossy()
                .to_string();
            let mod_names: Vec<String> = serde_json::from_str(&mod_names).unwrap();

            let mut failed_mods = Vec::new();

            for mod_name in &mod_names {
                if let Err(e) = rm_mod(&mods_folder_path, mod_name) {
                    eprintln!("Failed to remove mod {}: {}", mod_name, e);
                    failed_mods.push(format!("{}: {}", mod_name, e));
                }
            }

            let result = if failed_mods.is_empty() {
                "Success".to_string()
            } else {
                format!("Failed to remove some mods: {}", failed_mods.join(", "))
            };

            callback.call(None, &make_args!(result), None).unwrap();
        });
    }

    fn get_everest_version(&self, game_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let version = if is_test_mode() {
                "4000".to_string()
            } else {
                everest::get_everest_version(&game_path)
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            };
            callback.call(None, &make_args!(version), None).unwrap();
        });
    }

    fn download_and_install_everest(
        &self,
        game_path: String,
        url: String,
        callback: sciter::Value,
    ) {
        std::thread::spawn(move || {
            if is_test_mode() {
                callback.call(None, &make_args!("Success"), None).unwrap();
                return;
            }
            let callback2 = callback.clone();
            match everest::download_and_install_everest(&game_path, &url, &mut |msg, progress| {
                callback
                    .call(None, &make_args!(msg, progress as f64), None)
                    .unwrap();
            }) {
                Ok(()) => {
                    callback2.call(None, &make_args!("Success"), None).unwrap();
                }
                Err(e) => {
                    callback2
                        .call(None, &make_args!("Failed", e.to_string()), None)
                        .unwrap();
                }
            }
        });
    }

    fn celemod_version(&self) -> String {
        env!("VERSION").to_string()
    }

    fn celemod_hash(&self) -> String {
        env!("GIT_HASH").to_string()
    }

    fn do_self_update(&self, url: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let tmp = std::env::temp_dir().join("cele-mod.exe");
            match ureq::download_file_with_progress(
                &url,
                tmp.to_string_lossy().as_ref(),
                &mut |progress| {
                    callback
                        .call(
                            None,
                            &make_args!("downloading", progress.progress as f64),
                            None,
                        )
                        .unwrap();
                },
                false,
            ) {
                Ok(()) => {
                    // replace the current exe with the downloaded one
                    let current_exe = std::env::current_exe().unwrap();
                    let current_exe = current_exe.to_string_lossy().to_string();
                    let mut cmd = std::process::Command::new(&tmp);
                    cmd.arg("/update").arg(current_exe);
                    cmd.spawn().unwrap();
                    std::process::exit(0);
                }
                Err(e) => {
                    println!("Failed to download update: {}", e);
                    callback
                        .call(None, &make_args!("failed", e.to_string()), None)
                        .unwrap();
                }
            }
        });
    }

    fn verify_celeste_install(&self, path: String) -> bool {
        if is_test_mode() && path == get_test_game_path().to_string_lossy() {
            return true;
        }
        let path = Path::new(&path);
        let checklist = vec!["Celeste.exe", "Celeste"];
        for file in checklist {
            if path.join(file).exists() {
                return true;
            }
        }
        false
    }

    fn show_log_window(&self) {
        #[cfg(windows)]
        {
            #[cfg(not(debug_assertions))]
            {
                use winapi::um::winuser::{SW_SHOW, ShowWindow};
                unsafe {
                    ShowWindow(winapi::um::wincon::GetConsoleWindow(), SW_SHOW);
                }
            }
        }
    }
}

impl sciter::EventHandler for Handler {
    dispatch_script_call! {
        fn download_mod(String, String, String, bool, Value, bool, bool);
        fn get_celeste_dirs();
        fn get_installed_mod_ids(String, Value);
        fn get_installed_mods(String, Value);
        fn get_installed_miaonet(String, Value);
        fn start_game(String);
        fn open_url(String);
        fn get_blacklist_profiles(String, Value);
        fn apply_blacklist_profile(String, String, String);
        fn switch_mod_blacklist_profile(String, String, String, String, bool);
        fn new_mod_blacklist_profile(String, String);
        fn get_current_profile(String);
        fn remove_mod_blacklist_profile(String, String);
        fn get_mod_update(String, Value);
        fn rm_mod(String, String);
        fn delete_mods(String, String, Value);
        fn get_everest_version(String, Value);
        fn download_and_install_everest(String, String, Value);
        fn celemod_version();
        fn celemod_hash();
        fn do_self_update(String, Value);
        fn start_game_directly(String, bool);
        fn verify_celeste_install(String);
        fn get_mod_latest_info(Value);
        fn show_log_window();
        fn get_current_blacklist_content(String);
        fn sync_blacklist_profile_from_file(String, String);
        fn is_using_cache();
        fn get_database_path();
        fn set_mod_options_order(String, String, String);
    }
}

fn main() {
    // parse command line arguments
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--test-mode".to_string()) {
        TEST_MODE.store(true, Ordering::Relaxed);
        println!("Running in test mode (no game required)");
    }

    if args.len() == 3 && args[1] == "/update" {
        // sleep for a bit to let the old process exit
        std::thread::sleep(std::time::Duration::from_secs_f32(0.5));

        let current_exe = std::env::current_exe().unwrap();
        let current_exe = current_exe.to_string_lossy().to_string();
        let new_exe = &args[2];
        std::fs::remove_file(new_exe).unwrap();
        std::fs::copy(current_exe, new_exe).unwrap();
        std::process::Command::new(new_exe).spawn().unwrap();
        return;
    }

    // set cwd to exe directory
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            std::env::set_current_dir(dir).unwrap();
        }
    }

    println!("CeleMod v{} ({})", env!("VERSION"), env!("GIT_HASH"));

    // windows only
    #[cfg(windows)]
    {
        use winapi::um::winuser::SetProcessDPIAware;
        use winapi::um::winuser::ShowWindow;
        unsafe {
            SetProcessDPIAware();
            #[cfg(debug_assertions)]
            {
                use winapi::um::wincon::{ATTACH_PARENT_PROCESS, AttachConsole};
                AttachConsole(ATTACH_PARENT_PROCESS);
            }
            #[cfg(not(debug_assertions))]
            {
                use winapi::um::consoleapi::AllocConsole;
                AllocConsole();
                ShowWindow(
                    winapi::um::wincon::GetConsoleWindow(),
                    winapi::um::winuser::SW_HIDE,
                );
            }
        }
        if !std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .join("sciter.dll")
            .exists()
            && !Path::new("./sciter.dll").exists()
        {
            let _ = msgbox::create(
                "sciter.dll not found\nPlease extract all the files in the zip into a folder.\nIf you are using CI builds, obtain dependencies from the latest release build first.",
                "Dependency Missing",
                msgbox::IconType::Error,
            );
            panic!("sciter.dll not found");
        }
    }

    #[cfg(target_os = "windows")]
    let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::D2D));

    #[cfg(target_os = "linux")]
    let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::SKIA_OPENGL));

    // #[cfg(target_os = "macos")]
    // let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::SKIA_VULKAN));

    let mut builder = sciter::WindowBuilder::main().with_size((800, 640));

    #[cfg(not(target_os = "windows"))]
    {
        builder = builder.with_title().resizeable().closeable();
    }

    #[cfg(target_os = "windows")]
    {
        builder = builder.glassy().alpha().closeable();
    }

    let mut frame = builder.create();

    #[cfg(debug_assertions)]
    {
        sciter::set_options(sciter::RuntimeOptions::DebugMode(true)).unwrap();
        sciter::set_options(sciter::RuntimeOptions::ScriptFeatures(
            sciter::SCRIPT_RUNTIME_FEATURES::ALLOW_SOCKET_IO.bits(),
        ))
        .unwrap();

        frame
            .set_options(sciter::window::Options::DebugMode(true))
            .unwrap();
    }

    frame.event_handler(Handler);

    #[cfg(target_os = "windows")]
    const INDEX_HTML: &str = "index_windows.html";

    #[cfg(not(target_os = "windows"))]
    const INDEX_HTML: &str = "index.html";


    #[cfg(debug_assertions)]
    frame.load_html(
        read_to_string_bom(Path::new("../../src/celemod-ui/debug_index.html"))
            .unwrap()
            .as_bytes(), Some(
                &format!("app://{}", INDEX_HTML)
            ));
    #[cfg(not(debug_assertions))]
    {
        frame
            .archive_handler(include_bytes!("../resources/dist.rc"))
            .unwrap();
        
        frame.load_file(&format!("this://app/{}", INDEX_HTML));
    }

    frame.run_app();
}
