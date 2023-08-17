#![feature(try_blocks)]

use std::{
    fs::{self, write},
    path::{Path, PathBuf},
    process,
};

use anyhow::{anyhow, bail, Context};
use aria2c::DownloadCallbackInfo;
use everest::get_mod_cached;
use game_scanner::{epicgames, prelude::Game};
use lazy_static::lazy_static;
use sciter::{dispatch_script_call, make_args, Value};

extern crate lazy_static;
extern crate sciter;

mod aria2c;
mod everest;

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
        let cache_dir = path.parent().unwrap().join("celemod_yaml_cache");
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

struct LocalMod {
    game_banana_id: i64,
    name: String,
    deps: Vec<String>,
    version: String,
}

fn get_installed_mods_sync(mods_folder_path: String) -> Vec<LocalMod> {
    let mut mods = Vec::new();
    let mod_data = get_mod_cached().unwrap();
    for entry in fs::read_dir(mods_folder_path).unwrap() {
        let entry = entry.unwrap();
        let _: anyhow::Result<_> = try {
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
                    .join("celemod_yaml_cache")
                    .join(entry.path().with_extension("yaml").file_name().unwrap());

                if !cache_path.exists() {
                    extract_mod_for_yaml(&entry.path())?;
                }
                let yaml = fs::read_to_string(cache_path)?;

                let yaml: serde_yaml::Value = serde_yaml::from_str(&yaml)?;

                let mut deps: Vec<String> = Vec::new();

                if let Some(deps_yaml) = yaml[0]["Dependencies"].as_sequence() {
                    for dep in deps_yaml {
                        deps.push(dep["Name"].as_str().unwrap().to_string());
                    }
                }

                let name = yaml[0]["Name"].as_str().context("")?.to_string();
                let version = yaml[0]["Version"].as_str().context("")?.to_string();
                let gbid = mod_data[&name]["GameBananaId"].as_i64().context("")?;

                mods.push(LocalMod {
                    name,
                    version,
                    game_banana_id: gbid,
                    deps,
                });
            }
        };
    }
    mods
}

fn download_and_install_mod(
    url: &String,
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
            let cbkc = callback.clone();

            let mut installed_deps: Vec<i64> = vec![];

            let mut deps_to_install: Vec<(String, String)> = vec![(url, dest)];

            let mod_data = get_mod_cached().unwrap();

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
                    let data = &mod_data[&dep];
                    let dest = Path::new(&dest)
                        .with_file_name(dep.clone() + ".zip")
                        .to_str()
                        .unwrap()
                        .to_string();

                    let id = data["GameBananaId"].as_i64();

                    if let Some(id) = id {
                        let fileid = data["GameBananaFileId"].as_i64().unwrap();

                        if !installed_deps.contains(&id) {
                            let url = if use_cn_proxy {
                                format!("https://celeste.weg.fan/api/v2/download/gamebanana-files/{fileid}")
                            } else {
                                data["MirrorURL"].as_str().unwrap().to_string()
                            };

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
        game_scanner::manager::launch_game(&game).unwrap();
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
}

impl sciter::EventHandler for Handler {
    dispatch_script_call! {
        fn download_mod(String, String, Value, bool);
        fn get_celeste_dirs();
        fn get_installed_mod_ids(String, Value);
        fn start_game(String);
    }
}

fn main() {
    write("./sciter.dll", include_bytes!("../resources/sciter.dll")).unwrap();

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
