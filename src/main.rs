#![feature(try_blocks)]
#![feature(slice_pattern)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

use std::{
    fs::{self},
    path::{Path, PathBuf},
};

use anyhow::{bail, Context};
use aria2c::DownloadCallbackInfo;
use everest::get_mod_cached_new;
use game_scanner::prelude::Game;

use sciter::{dispatch_script_call, make_args, Value, GFX_LAYER};

extern crate lazy_static;
extern crate sciter;

mod aria2c;
mod blacklist;
mod everest;
mod wegfan;

#[macro_use]
extern crate include_bytes_zstd;

struct Handler;

fn extract_mod_for_yaml(path: &PathBuf) -> anyhow::Result<serde_yaml::Value> {
    let zipfile = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(zipfile)?;
    let everest_name = archive
        .file_names()
        .find(|name| name.starts_with("everest."))
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
            if entry
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

                if !cache_path.exists() {
                    extract_mod_for_yaml(&entry.path())?;
                }
                let yaml = read_to_string_bom(&cache_path)?;

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
                let gbid = mod_data[&name].game_banana_id;

                mods.push(LocalMod {
                    name,
                    version,
                    game_banana_id: gbid,
                    deps,
                    file: entry.file_name().to_str().unwrap().to_string(),
                });
            }
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
    progress_callback: &dyn Fn(DownloadCallbackInfo),
) -> Vec<String> {
    aria2c::download_file_with_progress(url, dest, progress_callback).unwrap();

    let yaml = extract_mod_for_yaml(&Path::new(&dest).to_path_buf()).unwrap();

    let mut deps: Vec<String> = Vec::new();

    if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
        for dep in deps_yaml {
            deps.push(dep["Name"].as_str().unwrap().to_string());
        }
    }
    deps
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

impl Handler {
    fn download_mod(&self, url: String, dest: String, callback: sciter::Value, use_cn_proxy: bool) {
        std::thread::spawn(move || {
            let res: anyhow::Result<()> = try {
                let cbkc = callback.clone();

                let mut installed_deps: Vec<i64> = vec![];

                let mut deps_to_install: Vec<(String, String)> = vec![(url, dest)];

                let mod_data = get_mod_cached_new().unwrap();

                while !deps_to_install.is_empty() {
                    let dlen = deps_to_install.len();
                    let (url, dest) = deps_to_install.pop().unwrap();

                    let callback = callback.clone();
                    let callback2 = callback.clone();

                    let deps = download_and_install_mod(&url, &dest, &move |progress| {
                        println!("Progress: {}", progress.progress);
                        callback
                            .call(
                                None,
                                &make_args!(format!("{}% ({})", progress.progress, dlen)),
                                None,
                            )
                            .unwrap();
                    });

                    println!("Deps: {deps:#?}");

                    callback2
                        .call(None, &make_args!(format!("100% ({})", dlen)), None)
                        .unwrap();

                    for dep in deps {
                        if mod_data.contains_key(&dep) {
                            let data = &mod_data[&dep];
                            let dest = Path::new(&dest)
                                .with_file_name(dep.clone() + ".zip")
                                .to_str()
                                .unwrap()
                                .to_string();

                            let id = data.game_banana_id;

                            let fileid = data.game_banana_file_id;

                            if !installed_deps.contains(&id) {
                                let url = data.download_url.clone();

                                installed_deps.push(id);
                                deps_to_install.push((url, dest));
                            }
                        } else {
                            println!("[ WARNING ] Failed to resolve {dep}");
                        }
                    }
                }

                println!("Download finished");

                cbkc.call(None, &make_args!(100), None).unwrap();
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

    fn apply_blacklist_profile(&self, game_path: String, profile_name: String) -> String {
        let result = blacklist::apply_mod_blacklist_profile(&game_path, &profile_name);
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

    fn get_mod_download_url(&self, name: String, callback: sciter::Value) {
        std::thread::spawn(move || {
            let res: anyhow::Result<String> = try {
                let mods = get_mod_cached_new()?;
                let name = &mods[&name];
                name.download_url.clone()
            };

            let data = if let Ok(data) = res {
                data
            } else {
                "".to_string()
            };

            callback.call(None, &make_args!(data), None).unwrap();
        });
    }
}

impl sciter::EventHandler for Handler {
    dispatch_script_call! {
        fn download_mod(String, String, Value, bool);
        fn get_celeste_dirs();
        fn get_installed_mod_ids(String, Value);
        fn get_installed_mods(String, Value);
        fn get_installed_miaonet(String, Value);
        fn start_game(String);
        fn open_url(String);
        fn get_blacklist_profiles(String, Value);
        fn apply_blacklist_profile(String, String);
        fn switch_mod_blacklist_profile(String, String, String, String, bool);
        fn new_mod_blacklist_profile(String, String);
        fn get_current_profile(String);
        fn remove_mod_blacklist_profile(String, String);
        fn get_mod_download_url(String, Value);
    }
}

fn main() {
    if !Path::new("./sciter.dll").exists() {
        #[cfg(not(debug_assertions))]
        {
            fs::write(
                "./sciter.dll",
                include_bytes_zstd!("./resources/sciter.dll", 21),
            )
            .unwrap();
        }
        #[cfg(debug_assertions)]
        {
            panic!("sciter.dll not found");
        }
    }

    let _ = sciter::set_options(sciter::RuntimeOptions::GfxLayer(GFX_LAYER::D2D));

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
        include_bytes!("./celemod-ui/debug_index.html"),
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
