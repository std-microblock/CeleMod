
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: String,
    pub create_time: String,
    pub update_time: String,
    pub delete_time: Option<serde_json::Value>,
    pub name: String,
    pub version: String,
    pub xx_hash: Vec<String>,
    pub submission_file: SubmissionFile,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionFile {
    pub id: String,
    pub create_time: String,
    pub update_time: String,
    pub delete_time: Option<serde_json::Value>,
    pub url: String,
    pub description: String,
    pub downloads: i64,
    pub size: i64,
    pub game_banana_id: Option<i64>,
    pub submission: Submission,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub id: String,
    pub create_time: String,
    pub update_time: String,
    pub delete_time: Option<serde_json::Value>,
    pub name: String,
    pub submission_type: String,
    pub submitter: String,
    pub page_url: Option<String>,
    pub game_banana_section: Option<String>,
    pub game_banana_id: Option<i64>,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub sub_category_id: Option<i64>,
    pub sub_category_name: Option<String>,
    pub latest_update_added_time: String,
}
