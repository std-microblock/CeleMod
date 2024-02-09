use crate::wegfan;

use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfoCached {
    pub name: String,
    pub version: String,
    pub game_banana_id: i64,
    pub game_banana_file_id: i64,
    pub download_url: String,
}

lazy_static! {
    static ref MOD_INFO_CACHED: Arc<HashMap<String, ModInfoCached>> = {
        let mods = get_mod_online_wegfan().unwrap();
        let mods = mods.into_iter().map(|v| (v.name.clone(), v)).collect();
        Arc::new(mods)
    };
}

pub fn get_mod_online_wegfan() -> anyhow::Result<Vec<ModInfoCached>> {
    let mut response: serde_json::Value = 
        ureq::get("https://celeste-dev.weg.fan/api/v2/mod/list")
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
