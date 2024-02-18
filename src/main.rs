#![feature(try_blocks)]
#![feature(slice_pattern)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

use anyhow::{bail, Context};
use aria2c::DownloadCallbackInfo;
use everest::get_mod_cached_new;
use game_scanner::prelude::Game;
use std::{
    cell::RefCell,
    fs,
    path::{Path, PathBuf},
    rc::Rc,
};

extern crate msgbox;

use sciter::{dispatch_script_call, make_args, Value, GFX_LAYER};

extern crate lazy_static;
extern crate sciter;

mod aria2c;
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

fn get_installed_mods_sync(mods_folder_path: String) -> Vec<LocalMod> {
    let mut mods = Vec::new();
    let mod_data = get_mod_cached_new().unwrap();

    for entry in fs::read_dir(mods_folder_path).unwrap() {
        let entry = entry.unwrap();
        let res: anyhow::Result<_> = try {
            let yaml = if entry
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

                let mod_date = entry.metadata()?.modified().unwrap();
                let cache_date = cache_path.metadata().ok().map(|v| v.modified().unwrap());

                if !cache_path.exists() || cache_date.is_none() || cache_date.unwrap() < mod_date {
                    extract_mod_for_yaml(&entry.path())?;
                }
                read_to_string_bom(&cache_path)?
            } else if entry.file_type().unwrap().is_dir() {
                let cache_path = entry.path().read_dir()?.find(|v| {
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
            } else {
                println!(
                    "[ WARNING ] Failed to find yaml, skipping {:?}",
                    entry.file_name()
                );
                continue;
            };

            let yaml: serde_yaml::Value = serde_yaml::from_str(&yaml)?;

            let mut deps: Vec<ModDependency> = Vec::new();

            if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
                for dep in deps_yaml {
                    deps.push(ModDependency {
                        name: dep["Name"].as_str().unwrap().to_string(),
                        version: dep["Version"].as_str().unwrap_or("0.0.0").to_string(),
                        optional: false,
                    });
                }
            }

            if let Some(deps_yaml) = yaml[0]["OptionalDependencies"].as_sequence() {
                for dep in deps_yaml {
                    deps.push(ModDependency {
                        name: dep["Name"].as_str().unwrap().to_string(),
                        version: dep["Version"].as_str().unwrap_or("0.0.0").to_string(),
                        optional: true,
                    });
                }
            }

            let name = yaml[0]["Name"].as_str().context("")?.to_string();
            let version = yaml[0]["Version"].as_str().context("")?.to_string();
            if !mod_data.contains_key(&name) {
                continue;
            }
            let gbid = mod_data[&name].game_banana_id;

            mods.push(LocalMod {
                name,
                version,
                game_banana_id: gbid,
                deps,
                file: entry.file_name().to_str().unwrap().to_string(),
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
    aria2c::download_file_with_progress(url, dest, progress_callback, multi_thread)?;

    let yaml = extract_mod_for_yaml(&Path::new(&dest).to_path_buf())?;

    let mut deps: Vec<(String, String)> = Vec::new();

    if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
        for dep in deps_yaml {
            // FUCK YOU YAML
            let version = if dep["Version"].is_f64() {
                // this turns it into Number(1.1), let's parse it
                let ver = format!("{:?}", dep["Version"]);
                ver["Number(".len()..ver.len() - 1].to_string()
            } else {
                let v = dep["Version"].as_str().unwrap_or("1.0.0").to_string();

                if v.chars().all(|c| c.is_ascii_digit() || c == '.') {
                    v
                } else {
                    "1.0.0".to_string()
                }
            };

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

#[derive(Serialize, Deserialize, Debug, Clone)]
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
            let res: anyhow::Result<()> = try {
                let cbkc = callback.clone();

                let mut installed_deps: Vec<i64> = vec![];

                let tasklist: Rc<RefCell<Vec<DownloadInfo>>> = Rc::new(RefCell::new(Vec::new()));

                tasklist.try_borrow_mut().unwrap().push(DownloadInfo {
                    name: name.clone(),
                    url: url.clone(),
                    dest: dest.clone(),
                    status: DownloadStatus::Waiting,
                    data: "".to_string(),
                });

                let mod_data = get_mod_cached_new()?;

                let post_callback = |tasklist: &Vec<DownloadInfo>, state: &str| {
                    cbkc.call(
                        None,
                        &make_args!(serde_json::to_string(&tasklist).unwrap(), state),
                        None,
                    )
                    .unwrap();
                };

                let mut i_task = 0;
                while tasklist.borrow().len() != i_task {
                    let tasklist2 = Rc::clone(&tasklist);

                    let deps = {
                        let deps = {
                            let current_task = tasklist.borrow()[i_task].clone();

                            download_and_install_mod(
                                &current_task.url,
                                &current_task.dest,
                                &mut move |progress| {
                                    (tasklist2.try_borrow_mut().unwrap())[i_task].data =
                                        progress.progress.to_string();
                                    post_callback(&tasklist2.borrow(), "pending");
                                },
                                multi_thread,
                            )
                        };

                        match deps {
                            Ok(deps) => {
                                let task = &mut tasklist.try_borrow_mut().unwrap()[i_task];
                                task.status = DownloadStatus::Finished;
                                deps
                            }
                            Err(e) => {
                                let mut tasklist = tasklist.try_borrow_mut().unwrap();
                                let task = &mut tasklist[i_task];
                                task.status = DownloadStatus::Failed;
                                task.data = e.to_string();
                                let _ = fs::remove_file(&task.dest);
                                post_callback(&tasklist, "failed");
                                return;
                            }
                        }
                    };

                    println!("Deps: {deps:#?}");

                    post_callback(&tasklist.borrow(), "pending");

                    let installed_mods = get_installed_mods_sync(mods_dir.clone());
                    for (dep, min_ver) in deps {
                        // search in installed mods
                        let dep = dep.clone();
                        let min_ver = min_ver.clone();

                        if installed_mods.iter().any(|mod_| {
                            mod_.name == dep && compare_version(&mod_.version, &min_ver) >= 0
                        }) {
                            continue;
                        }

                        if mod_data.contains_key(&dep) {
                            let data = &mod_data[&dep];
                            let dest = Path::new(&dest)
                                .with_file_name(dep.clone() + ".zip")
                                .to_str()
                                .unwrap()
                                .to_string();

                            let id = data.game_banana_id;

                            if !installed_deps.contains(&id) {
                                let url = data.download_url.clone();

                                installed_deps.push(id);
                                tasklist.try_borrow_mut().unwrap().push(DownloadInfo {
                                    name: dep.clone(),
                                    url,
                                    dest,
                                    status: DownloadStatus::Waiting,
                                    data: "0".to_string(),
                                });
                            }
                        } else {
                            println!("[ WARNING ] Failed to resolve {dep}");
                        }
                    }

                    i_task += 1;
                    let mut tasklist = tasklist.try_borrow_mut().unwrap();
                    tasklist[i_task - 1].status = DownloadStatus::Finished;
                    tasklist[i_task - 1].data = "100".to_string();
                    if i_task < tasklist.len() {
                        tasklist[i_task].status = DownloadStatus::Downloading;
                    }
                }

                println!("Download finished");

                post_callback(&tasklist.borrow(), "finished");
            };

            if let Err(e) = res {
                eprintln!("Failed to download mod: {}", e);
                callback
                    .call(
                        None,
                        &make_args!(format!("Failed to download mod: {}", e)),
                        None,
                    )
                    .unwrap();
            }
        });
    }

    fn get_celeste_dirs(&self) -> String {
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
        let game = Path::new(&path).join("Celeste.exe");
        let game_origin = Path::new(&path).join("orig").join("Celeste.exe");

        if origin {
            if game_origin.exists() {
                std::process::Command::new(game_origin).arg("--vanilla").spawn().unwrap();
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

    fn get_everest_version(&self, game_path: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let version = everest::get_everest_version(&game_path);
            let version = if let Some(version) = version {
                version.to_string()
            } else {
                "".to_string()
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
            match aria2c::download_file_with_progress(
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
                    callback
                        .call(None, &make_args!("failed", e.to_string()), None)
                        .unwrap();
                }
            }
        });
    }

    fn verify_celeste_install(&self, path: String) -> bool {
        let path = Path::new(&path);
        let checklist = vec!["Celeste.exe"];
        for file in checklist {
            if path.join(file).exists() {
                return true;
            }
        }
        false
    }
}

impl sciter::EventHandler for Handler {
    dispatch_script_call! {
        fn download_mod(String, String, String, Value, bool, bool);
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
        fn get_everest_version(String, Value);
        fn download_and_install_everest(String, String, Value);
        fn celemod_version();
        fn celemod_hash();
        fn do_self_update(String, Value);
        fn start_game_directly(String, bool);
        fn verify_celeste_install(String);
        fn get_mod_latest_info(Value);
    }
}

fn main() {
    // parse /update command line argument
    let args: Vec<String> = std::env::args().collect();
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

    println!("CeleMod v{} ({})", env!("VERSION"), env!("GIT_HASH"));

    // windows only
    #[cfg(windows)]
    {
        use winapi::um::wincon::{AttachConsole, ATTACH_PARENT_PROCESS};
        use winapi::um::winuser::SetProcessDPIAware;
        unsafe {
            AttachConsole(ATTACH_PARENT_PROCESS);
            SetProcessDPIAware();
        }
        if !Path::new("./sciter.dll").exists() {
            let _ = msgbox::create("sciter.dll not found\nPlease extract all the files in the zip into a folder.\nIf you are using CI builds, obtain dependencies from the latest release build first.", "Dependency Missing", msgbox::IconType::Error);
            panic!("sciter.dll not found");
        }
    }

    #[cfg(target_os = "windows")]
    let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::D2D));

    #[cfg(target_os = "linux")]
    let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::SKIA_OPENGL));

    let mut frame = sciter::WindowBuilder::main()
        .with_size((800, 600))
        .glassy()
        .alpha()
        .closeable()
        .create();

    #[cfg(debug_assertions)]
    {
        sciter::set_options(sciter::RuntimeOptions::DebugMode(true)).unwrap();
        sciter::set_options(sciter::RuntimeOptions::ScriptFeatures(
            sciter::SCRIPT_RUNTIME_FEATURES::ALLOW_SOCKET_IO as u8,
        ))
        .unwrap();

        frame
            .set_options(sciter::window::Options::DebugMode(true))
            .unwrap();
    }

    frame.event_handler(Handler);
 
    #[cfg(debug_assertions)]
    frame.load_html(
        read_to_string_bom(Path::new("./src/celemod-ui/debug_index.html")).unwrap().as_bytes(),
        Some("app://index.html"),
    );
    #[cfg(not(debug_assertions))]
    {
        frame
            .archive_handler(include_bytes!("../resources/dist.rc"))
            .unwrap();
        frame.load_file("this://app/index.html");
    }

    frame.run_app();
}
