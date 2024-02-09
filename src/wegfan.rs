
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
    pub submission_type: SubmissionType,
    pub submitter: String,
    pub page_url: Option<String>,
    pub game_banana_section: Option<GameBananaSection>,
    pub game_banana_id: Option<i64>,
    pub category_id: Option<i64>,
    pub category_name: Option<CategoryName>,
    pub sub_category_id: Option<i64>,
    pub sub_category_name: Option<SubCategoryName>,
    pub latest_update_added_time: String,
}

#[derive(Serialize, Deserialize)]
pub enum CategoryName {
    #[serde(rename = "Ahorn Plugin")]
    AhornPlugin,
    Assets,
    Dialog,
    Effects,
    Helpers,
    #[serde(rename = "Lönn Plugin")]
    LnnPlugin,
    Map,
    Maps,
    Mechanics,
    #[serde(rename = "Other/Misc")]
    OtherMisc,
    Skins,
    #[serde(rename = "Twitch Integration")]
    TwitchIntegration,
    #[serde(rename = "UI")]
    Ui,
}

#[derive(Serialize, Deserialize)]
pub enum GameBananaSection {
    Mod,
    Tool,
    Wip,
}

#[derive(Serialize, Deserialize)]
pub enum SubCategoryName {
    Audio,
    Campaign,
    #[serde(rename = "Collab/Contest")]
    CollabContest,
    Collectibles,
    Graphics,
    Multiplayer,
    #[serde(rename = "Other/Misc")]
    OtherMisc,
    Player,
    Standalone,
    Translations,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SubmissionType {
    #[serde(rename = "EXCLUSIVE_MOD")]
    ExclusiveMod,
    #[serde(rename = "GAME_BANANA_MOD")]
    GameBananaMod,
}
