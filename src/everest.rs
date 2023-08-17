use lazy_static::lazy_static;
use std::{fs::File, io::Write, path::Path};

lazy_static! {
    static ref MOD_DATA_PATH: String = {
        std::env::current_dir()
            .unwrap()
            .join("mod-cache.yaml")
            .to_str()
            .unwrap()
            .to_string()
    };
}

pub fn update_mod_cache() -> anyhow::Result<serde_yaml::Value> {
    let mods: anyhow::Result<_> = try {
        if true {
            let response = minreq::get("https://everestapi.github.io/modupdater.txt").send()?;
            let url = response.as_str()?;

            let response = minreq::get(url.trim()).send()?;
            response.as_str()?.to_string()
        } else {
            let response = minreq::get("https://celeste.wegfan.cn/api/v2/download/everest_update.yaml").send()?;
            response.as_str()?.to_string()
        }
    };

    let mods = mods?;


    let mut file = File::create(&*MOD_DATA_PATH)?;
    file.write_all(mods.as_bytes())?;

    let mods: serde_yaml::Value = serde_yaml::from_str(&mods)?;

    Ok(mods)
}

pub fn get_mod_cached() -> anyhow::Result<serde_yaml::Value> {
    if !Path::new(&*MOD_DATA_PATH).exists()
        || Path::new(&*MOD_DATA_PATH).metadata()?.modified()?
            < std::time::SystemTime::now() - std::time::Duration::from_secs(60 * 60 * 24)
    {
        update_mod_cache()?;
    }

    let file = File::open(&*MOD_DATA_PATH)?;
    let mods: serde_yaml::Value = serde_yaml::from_reader(file)?;

    Ok(mods)
}
