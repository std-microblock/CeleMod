use lazy_static::lazy_static;
use std::{cell::RefCell, fs::File, io::Write, path::Path, sync::Mutex};

lazy_static! {
    static ref MOD_DATA_PATH: String = {
        std::env::current_dir()
            .unwrap()
            .join("mod-cache-official.yaml")
            .to_str()
            .unwrap()
            .to_string()
    };
}

pub fn update_mod_cache() -> anyhow::Result<serde_yaml::Value> {
    let mods: anyhow::Result<_> = try {
        if true {
            let response = ureq::get("https://everestapi.github.io/modupdater.txt").call()?.into_string()?;
            let url = response;

            let response = ureq::get(url.trim()).call()?.into_string()?;
            response
        } else {
            let response =ureq::get("https://celeste.wegfan.cn/api/v2/download/everest_update.yaml").call()?.into_string()?;
            response
        }
    };

    let mods = mods?;


    let mut file = File::create(&*MOD_DATA_PATH)?;
    file.write_all(mods.as_bytes())?;

    let mods: serde_yaml::Value = serde_yaml::from_str(&mods)?;

    Ok(mods)
}

static MOD_DATA: Mutex<serde_yaml::Value> = Mutex::new(serde_yaml::Value::Null);

fn read_mod_cache() -> anyhow::Result<serde_yaml::Value> {
    let data = std::fs::read_to_string(&*MOD_DATA_PATH)?;
    let mods: serde_yaml::Value = serde_yaml::from_str(&data)?;

    Ok(mods)
}

pub fn get_mod_cached() -> anyhow::Result<&'static serde_yaml::Value> {
    if !Path::new(&*MOD_DATA_PATH).exists()
        || Path::new(&*MOD_DATA_PATH).metadata()?.modified()?
            < std::time::SystemTime::now() - std::time::Duration::from_secs(60 * 60 * 24)
    {
        update_mod_cache()?;
        *MOD_DATA.lock().unwrap() = read_mod_cache()?;
    }

    if MOD_DATA.lock().unwrap().is_null() {
        *MOD_DATA.lock().unwrap() = read_mod_cache()?;
    }

    // unsafe create ref
    let data = unsafe { & *(&(*MOD_DATA.lock().unwrap()) as *const serde_yaml::Value)};
    Ok(data)
}
