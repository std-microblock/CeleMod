use serde::{Deserialize, Serialize};

use aes::Aes256;
use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose};
use cbc::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use dirs;
use everest::get_mod_cached_new;
use game_scanner::prelude::Game;
use parking_lot::Mutex as ParkingMutex;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use ureq::DownloadCallbackInfo;

static TEST_MODE: AtomicBool = AtomicBool::new(false);
static MIAONET_OAUTH_ACTIVE: AtomicBool = AtomicBool::new(false);

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

extern crate lazy_static;

lazy_static::lazy_static! {
    static ref DOWNLOAD_CANCEL_FLAGS: Mutex<HashMap<String, Arc<AtomicBool>>> = Mutex::new(HashMap::new());
    static ref DOWNLOAD_DESTINATION_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> = Mutex::new(HashMap::new());
    static ref PENDING_DEEP_LINKS: ParkingMutex<Vec<String>> = ParkingMutex::new(Vec::new());
}

#[path = "blacklist.rs"]
mod blacklist;
#[path = "crash_analysis.rs"]
mod crash_analysis;
#[path = "everest.rs"]
mod everest;
#[path = "keybindings.rs"]
mod keybindings;
#[path = "miaonet_atlas.rs"]
mod miaonet_atlas;
#[path = "ureq.rs"]
mod ureq;
#[path = "wegfan.rs"]
mod wegfan;

use tauri::ipc::Channel;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

const DEEP_LINK_EVENT: &str = "celemod://open";

fn emit_deep_links(app: &tauri::AppHandle, urls: impl IntoIterator<Item = url::Url>) {
    let urls = urls
        .into_iter()
        .filter(|url| url.scheme() == "celemod")
        .map(|url| url.to_string())
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return;
    }
    PENDING_DEEP_LINKS.lock().extend(urls.clone());
    let _ = app.emit(DEEP_LINK_EVENT, &urls);
}

#[tauri::command]
fn take_pending_deep_links() -> Vec<String> {
    std::mem::take(&mut *PENDING_DEEP_LINKS.lock())
}

#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

type IpcEvent = serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MiaoNetLocalState {
    installed: bool,
    authenticated: bool,
    last_name: Option<String>,
}

const MIAONET_DEFAULT_EMOTES: [&str; 8] = [
    "i:collectables/heartgem/0/spin",
    "i:collectables/strawberry",
    "Hi!",
    "Too slow!",
    "p:madeline/normal04",
    "p:ghost/scoff03",
    "p:theo/yolo0 3 2 1 2 !",
    "p:granny/laugh",
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MiaoNetSettings {
    connect_on_game_start: bool,
    show_avatar: bool,
    show_own_name: bool,
    player_light: bool,
    player_interactions: bool,
    enable_emote_wheel: bool,
    player_presence_messages: bool,
    player_opacity: u8,
    player_name_opacity: u8,
    off_screen_player_name_opacity: u8,
    self_name_opacity: u8,
    distance_based_opacity: bool,
    min_player_opacity_multiplier: u8,
    emote_opacity: u8,
    emotes: Vec<String>,
    default_emotes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MiaoNetSettingsUpdate {
    connect_on_game_start: bool,
    show_avatar: bool,
    show_own_name: bool,
    player_light: bool,
    player_interactions: bool,
    enable_emote_wheel: bool,
    player_presence_messages: bool,
    player_opacity: u8,
    player_name_opacity: u8,
    off_screen_player_name_opacity: u8,
    self_name_opacity: u8,
    distance_based_opacity: bool,
    min_player_opacity_multiplier: u8,
    emote_opacity: u8,
    emotes: Vec<String>,
}

fn miaonet_settings_directories(game_path: &Path) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(override_path) = std::env::var_os("EVEREST_SAVEPATH") {
        directories.push(PathBuf::from(override_path).join("Saves"));
    }

    #[cfg(target_os = "windows")]
    directories.push(game_path.join("Saves"));

    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        directories.push(
            home.join("Library")
                .join("Application Support")
                .join("Celeste")
                .join("Saves"),
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
            directories.push(PathBuf::from(xdg_data_home).join("Celeste").join("Saves"));
        }
        if let Some(home) = dirs::home_dir() {
            directories.push(
                home.join(".local")
                    .join("share")
                    .join("Celeste")
                    .join("Saves"),
            );
        }
    }

    directories
}

fn yaml_property<'a>(value: &'a serde_yaml::Value, name: &str) -> Option<&'a serde_yaml::Value> {
    let serde_yaml::Value::Mapping(mapping) = value else {
        return None;
    };
    mapping.iter().find_map(|(key, value)| {
        key.as_str()
            .is_some_and(|key| key.eq_ignore_ascii_case(name))
            .then_some(value)
    })
}

fn yaml_string_property(value: &serde_yaml::Value, name: &str) -> Option<String> {
    yaml_property(value, name)?.as_str().map(str::to_owned)
}

fn miaonet_settings_path(game_path: &Path) -> Result<PathBuf, String> {
    let directories = miaonet_settings_directories(game_path);
    directories
        .iter()
        .map(|directory| directory.join("modsettings-MiaoNet.celeste"))
        .find(|path| path.is_file())
        .or_else(|| {
            directories
                .first()
                .map(|directory| directory.join("modsettings-MiaoNet.celeste"))
        })
        .ok_or_else(|| "找不到 Celeste 的设置目录。".to_string())
}

fn read_miaonet_settings_document(path: &Path) -> Result<serde_yaml::Value, String> {
    if !path.is_file() {
        return Ok(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("读取 MiaoNet 设置失败：{error}"))?;
    if content.trim().is_empty() {
        return Ok(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
    }
    serde_yaml::from_str(&content).map_err(|error| format!("解析 MiaoNet 设置失败：{error}"))
}

fn miaonet_settings_from_document(document: &serde_yaml::Value) -> Result<MiaoNetSettings, String> {
    if !matches!(document, serde_yaml::Value::Mapping(_)) {
        return Err("MiaoNet 设置文件格式不正确。".to_string());
    }
    let emotes = match yaml_property(document, "Emotes") {
        None => MIAONET_DEFAULT_EMOTES
            .iter()
            .map(|emote| (*emote).to_string())
            .collect(),
        Some(serde_yaml::Value::Null) => Vec::new(),
        Some(serde_yaml::Value::Sequence(values)) => values
            .iter()
            .map(|value| value.as_str().unwrap_or_default().to_string())
            .collect(),
        Some(_) => return Err("MiaoNet 的 Emotes 设置不是列表。".to_string()),
    };
    let opacity = |name: &str, default: u8, min: u8, max: u8| {
        yaml_property(document, name)
            .and_then(serde_yaml::Value::as_i64)
            .and_then(|value| u8::try_from(value).ok())
            .filter(|value| (min..=max).contains(value))
            .unwrap_or(default)
    };

    Ok(MiaoNetSettings {
        connect_on_game_start: yaml_property(document, "ConnectOnGameStart")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(false),
        show_avatar: yaml_property(document, "ShowAvatar")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(true),
        show_own_name: yaml_property(document, "ShowOwnName")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(true),
        player_light: yaml_property(document, "PlayerLight")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(false),
        player_interactions: yaml_property(document, "PlayerInteractions")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(true),
        enable_emote_wheel: yaml_property(document, "EnableEmoteWheel")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(true),
        player_presence_messages: yaml_property(document, "PlayerPresenceMessages")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(true),
        player_opacity: opacity("PlayerOpacity", 8, 1, 10),
        player_name_opacity: opacity("PlayerNameOpacity", 8, 1, 10),
        off_screen_player_name_opacity: opacity("OffScreenPlayerNameOpacity", 4, 0, 10),
        self_name_opacity: opacity("SelfNameOpacity", 8, 1, 10),
        distance_based_opacity: yaml_property(document, "DistanceBasedOpacity")
            .and_then(serde_yaml::Value::as_bool)
            .unwrap_or(false),
        min_player_opacity_multiplier: opacity("MinPlayerOpacityMultiplier", 2, 0, 9),
        emote_opacity: opacity("EmoteOpacity", 10, 1, 10),
        emotes,
        default_emotes: MIAONET_DEFAULT_EMOTES
            .iter()
            .map(|emote| (*emote).to_string())
            .collect(),
    })
}

fn load_miaonet_settings(game_path: &Path) -> Result<MiaoNetSettings, String> {
    let settings_path = miaonet_settings_path(game_path)?;
    let document = read_miaonet_settings_document(&settings_path)?;
    miaonet_settings_from_document(&document)
}

fn set_yaml_property(mapping: &mut serde_yaml::Mapping, name: &str, value: serde_yaml::Value) {
    remove_yaml_property(mapping, name);
    mapping.insert(serde_yaml::Value::String(name.to_string()), value);
}

fn apply_miaonet_settings_update(
    document: &mut serde_yaml::Value,
    update: &MiaoNetSettingsUpdate,
) -> Result<(), String> {
    if !(1..=10).contains(&update.player_opacity)
        || !(1..=10).contains(&update.player_name_opacity)
        || !(0..=10).contains(&update.off_screen_player_name_opacity)
        || !(1..=10).contains(&update.self_name_opacity)
        || !(0..=9).contains(&update.min_player_opacity_multiplier)
        || !(1..=10).contains(&update.emote_opacity)
    {
        return Err("MiaoNet 透明度设置超出允许范围。".to_string());
    }
    let serde_yaml::Value::Mapping(mapping) = document else {
        return Err("MiaoNet 设置文件格式不正确。".to_string());
    };

    set_yaml_property(
        mapping,
        "ConnectOnGameStart",
        serde_yaml::Value::Bool(update.connect_on_game_start),
    );
    set_yaml_property(
        mapping,
        "ShowAvatar",
        serde_yaml::Value::Bool(update.show_avatar),
    );
    set_yaml_property(
        mapping,
        "ShowOwnName",
        serde_yaml::Value::Bool(update.show_own_name),
    );
    set_yaml_property(
        mapping,
        "PlayerLight",
        serde_yaml::Value::Bool(update.player_light),
    );
    set_yaml_property(
        mapping,
        "PlayerInteractions",
        serde_yaml::Value::Bool(update.player_interactions),
    );
    set_yaml_property(
        mapping,
        "EnableEmoteWheel",
        serde_yaml::Value::Bool(update.enable_emote_wheel),
    );
    set_yaml_property(
        mapping,
        "PlayerPresenceMessages",
        serde_yaml::Value::Bool(update.player_presence_messages),
    );
    set_yaml_property(
        mapping,
        "PlayerOpacity",
        serde_yaml::Value::Number(u64::from(update.player_opacity).into()),
    );
    set_yaml_property(
        mapping,
        "PlayerNameOpacity",
        serde_yaml::Value::Number(u64::from(update.player_name_opacity).into()),
    );
    set_yaml_property(
        mapping,
        "OffScreenPlayerNameOpacity",
        serde_yaml::Value::Number(u64::from(update.off_screen_player_name_opacity).into()),
    );
    set_yaml_property(
        mapping,
        "SelfNameOpacity",
        serde_yaml::Value::Number(u64::from(update.self_name_opacity).into()),
    );
    set_yaml_property(
        mapping,
        "DistanceBasedOpacity",
        serde_yaml::Value::Bool(update.distance_based_opacity),
    );
    set_yaml_property(
        mapping,
        "MinPlayerOpacityMultiplier",
        serde_yaml::Value::Number(u64::from(update.min_player_opacity_multiplier).into()),
    );
    set_yaml_property(
        mapping,
        "EmoteOpacity",
        serde_yaml::Value::Number(u64::from(update.emote_opacity).into()),
    );
    set_yaml_property(
        mapping,
        "Emotes",
        serde_yaml::Value::Sequence(
            update
                .emotes
                .iter()
                .map(|emote| serde_yaml::Value::String(emote.clone()))
                .collect(),
        ),
    );
    Ok(())
}

fn save_miaonet_settings_update(
    game_path: &Path,
    update: &MiaoNetSettingsUpdate,
) -> Result<MiaoNetSettings, String> {
    let settings_path = miaonet_settings_path(game_path)?;
    let mut document = read_miaonet_settings_document(&settings_path)?;
    apply_miaonet_settings_update(&mut document, update)?;
    let parent = settings_path
        .parent()
        .ok_or_else(|| "MiaoNet 设置路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建 Celeste 设置目录失败：{error}"))?;
    let serialized = serde_yaml::to_string(&document)
        .map_err(|error| format!("保存 MiaoNet 设置失败：{error}"))?;
    fs::write(&settings_path, serialized)
        .map_err(|error| format!("写入 MiaoNet 设置失败：{error}"))?;
    miaonet_settings_from_document(&document)
}

fn read_miaonet_auth_state(game_path: &Path) -> (bool, Option<String>) {
    for directory in miaonet_settings_directories(game_path) {
        let path = directory.join("modsettings-MiaoNet.celeste");
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(settings) = serde_yaml::from_str::<serde_yaml::Value>(&content) else {
            continue;
        };
        let authenticated = yaml_string_property(&settings, "TokenDataEncrypted")
            .is_some_and(|token| !token.trim().is_empty());
        let last_name =
            yaml_string_property(&settings, "LastName").filter(|name| !name.trim().is_empty());
        return (authenticated, last_name);
    }
    (false, None)
}

#[tauri::command]
fn logout_miaonet(game_path: String) -> Result<(), String> {
    let game_path = normalize_game_path_impl(&game_path);
    let game_path = Path::new(&game_path);
    if is_celeste_running(game_path) {
        return Err("请先退出 Celeste，再清除 MiaoNet 登录信息。".to_string());
    }

    for directory in miaonet_settings_directories(game_path) {
        let path = directory.join("modsettings-MiaoNet.celeste");
        if !path.is_file() {
            continue;
        }

        let content =
            fs::read_to_string(&path).map_err(|error| format!("读取 MiaoNet 设置失败：{error}"))?;
        let mut settings = serde_yaml::from_str::<serde_yaml::Value>(&content)
            .map_err(|error| format!("解析 MiaoNet 设置失败：{error}"))?;
        let serde_yaml::Value::Mapping(mapping) = &mut settings else {
            return Err("MiaoNet 设置文件格式不正确。".to_string());
        };

        let keys_to_remove = mapping
            .keys()
            .filter(|key| {
                key.as_str().is_some_and(|key| {
                    key.eq_ignore_ascii_case("TokenDataEncrypted")
                        || key.eq_ignore_ascii_case("LastName")
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        for key in keys_to_remove {
            mapping.remove(&key);
        }

        let serialized = serde_yaml::to_string(&settings)
            .map_err(|error| format!("保存 MiaoNet 设置失败：{error}"))?;
        fs::write(&path, serialized).map_err(|error| format!("写入 MiaoNet 设置失败：{error}"))?;
        return Ok(());
    }

    Ok(())
}

#[tauri::command]
fn get_miaonet_local_state(game_path: String) -> MiaoNetLocalState {
    let game_path = normalize_game_path_impl(&game_path);
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"))
        .into_iter()
        .any(|item| item.name == "MiaoNet");
    let (authenticated, last_name) = read_miaonet_auth_state(Path::new(&game_path));
    MiaoNetLocalState {
        installed,
        authenticated,
        last_name,
    }
}

#[tauri::command]
fn get_miaonet_settings(game_path: String) -> Result<MiaoNetSettings, String> {
    let game_path = normalize_game_path_impl(&game_path);
    load_miaonet_settings(Path::new(&game_path))
}

#[tauri::command]
fn save_miaonet_settings(
    game_path: String,
    settings: MiaoNetSettingsUpdate,
) -> Result<MiaoNetSettings, String> {
    let game_path = normalize_game_path_impl(&game_path);
    let game_path = Path::new(&game_path);
    if is_celeste_running(game_path) {
        return Err("请先退出 Celeste，再保存 MiaoNet 设置。".to_string());
    }
    save_miaonet_settings_update(game_path, &settings)
}

fn installed_miaonet_protocol_version(game_path: &Path) -> Result<[u16; 3], String> {
    let installed = get_installed_mods_sync(game_path.join("Mods").to_string_lossy().into_owned())
        .into_iter()
        .find(|item| item.name == "MiaoNet")
        .ok_or_else(|| "当前游戏目录中没有安装 MiaoNet+。".to_string())?;
    let stable_version = installed
        .version
        .split(['-', '+'])
        .next()
        .unwrap_or(&installed.version);
    let mut components = stable_version.split('.');
    let mut version = [0u16; 3];
    for component in &mut version {
        *component = components
            .next()
            .ok_or_else(|| format!("无法识别 MiaoNet+ 版本：{}", installed.version))?
            .parse::<u16>()
            .map_err(|_| format!("无法识别 MiaoNet+ 版本：{}", installed.version))?;
    }
    Ok(version)
}

const MIAONET_OAUTH_CALLBACK: &str = "http://localhost:21472/auth";
const MIAONET_OAUTH_CLIENT_ID: &str = "bN8BOz8IjLk981LFLckBq3XzA6fsDC0d";
const MIAONET_SERVER_HOST: &str = "main.server.celemiao.com";
const MIAONET_SERVER_PORT: u16 = 21473;
const MIAONET_HANDSHAKE_HEAD: [u8; 16] = [
    6, 3, 0, 1, 4, b'M', b'i', b'a', b'o', b'N', b'e', b't', b'+', 2, 0, 2,
];

struct MiaoNetOauthGuard;

impl Drop for MiaoNetOauthGuard {
    fn drop(&mut self) {
        MIAONET_OAUTH_ACTIVE.store(false, Ordering::Release);
    }
}

fn miaonet_oauth_event(channel: &Channel<IpcEvent>, state: &str, detail: Option<&str>) {
    let mut args = vec![serde_json::json!(state)];
    if let Some(detail) = detail {
        args.push(serde_json::json!(detail));
    }
    send_event(channel, args);
}

fn make_miaonet_oauth_url(state: &str) -> Result<String, String> {
    let mut url = url::Url::parse("https://bbs.celemiao.com/oauth/authorize")
        .map_err(|error| format!("无法创建授权地址：{error}"))?;
    url.query_pairs_mut()
        .append_pair("client_id", MIAONET_OAUTH_CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", MIAONET_OAUTH_CALLBACK)
        .append_pair("scope", "celeste.read")
        .append_pair("state", state);
    Ok(url.into())
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| format!("设置回调读取超时失败：{error}"))?;
    let mut request = Vec::with_capacity(2048);
    let mut buffer = [0u8; 1024];
    while request.len() < 16 * 1024 {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| format!("读取浏览器回调失败：{error}"))?;
        if count == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..count]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8(request).map_err(|_| "浏览器回调不是有效的 HTTP 请求。".to_string())
}

fn write_http_page(stream: &mut TcpStream, status: &str, title: &str, message: &str) {
    let body = format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><style>body{{margin:0;background:#101114;color:#eee;font:16px system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}}main{{max-width:520px;padding:40px;text-align:center}}h1{{font-size:24px;margin:0 0 12px}}p{{color:#aeb2ba;line-height:1.7;margin:0}}</style></head><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn parse_miaonet_callback_target(request: &str) -> Result<&str, String> {
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "浏览器回调缺少请求行。".to_string())?;
    let mut parts = request_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("浏览器回调使用了不支持的请求方式。".to_string());
    }
    parts
        .next()
        .ok_or_else(|| "浏览器回调缺少请求地址。".to_string())
}

fn take_u8(data: &[u8], offset: &mut usize) -> Result<u8, String> {
    let value = *data
        .get(*offset)
        .ok_or_else(|| "MiaoNet 返回了不完整的认证数据。".to_string())?;
    *offset += 1;
    Ok(value)
}

fn take_u16(data: &[u8], offset: &mut usize) -> Result<u16, String> {
    let bytes = data
        .get(*offset..*offset + 2)
        .ok_or_else(|| "MiaoNet 返回了不完整的认证数据。".to_string())?;
    *offset += 2;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn take_bytes<'a>(data: &'a [u8], offset: &mut usize, length: usize) -> Result<&'a [u8], String> {
    let bytes = data
        .get(*offset..*offset + length)
        .ok_or_else(|| "MiaoNet 返回了不完整的认证数据。".to_string())?;
    *offset += length;
    Ok(bytes)
}

fn parse_miaonet_handshake_ack(payload: &[u8]) -> Result<Vec<u8>, String> {
    let mut offset = 0;
    let result_type = take_u8(payload, &mut offset)?;
    let authentication_data = if take_u8(payload, &mut offset)? != 0 {
        let length = take_u16(payload, &mut offset)? as usize;
        Some(take_bytes(payload, &mut offset, length)?.to_vec())
    } else {
        None
    };
    let denied_reason = if take_u8(payload, &mut offset)? != 0 {
        let length = take_u16(payload, &mut offset)? as usize;
        Some(String::from_utf8_lossy(take_bytes(payload, &mut offset, length)?).into_owned())
    } else {
        None
    };

    if result_type != 0 {
        let fallback = match result_type {
            1 => "该账号当前无法使用 MiaoNet。",
            2 => "登录授权已过期，请重新授权。",
            3 => "授权码无效或已被使用，请重新授权。",
            _ => "MiaoNet 服务器认证失败，请稍后重试。",
        };
        return Err(denied_reason.unwrap_or_else(|| fallback.to_string()));
    }

    authentication_data
        .filter(|data| !data.is_empty())
        .ok_or_else(|| "MiaoNet 服务器没有返回可保存的登录信息。".to_string())
}

fn read_miaonet_initial_username(
    stream: &mut StreamOwned<ClientConnection, TcpStream>,
) -> Option<String> {
    stream
        .get_ref()
        .set_read_timeout(Some(Duration::from_secs(3)))
        .ok()?;
    let mut head = [0u8; 4];
    stream.read_exact(&mut head).ok()?;
    let payload_length = u16::from_le_bytes([head[0], head[1]]) as usize;
    let packet_type = u16::from_le_bytes([head[2], head[3]]);
    if packet_type != 1 || payload_length < 14 || payload_length > u16::MAX as usize {
        return None;
    }
    let mut payload = vec![0u8; payload_length];
    stream.read_exact(&mut payload).ok()?;
    let mut offset = 12;
    let name_length = take_u16(&payload, &mut offset).ok()? as usize;
    let name = String::from_utf8(
        take_bytes(&payload, &mut offset, name_length)
            .ok()?
            .to_vec(),
    )
    .ok()?;
    (!name.trim().is_empty()).then_some(name)
}

fn connect_miaonet_server() -> Result<TcpStream, String> {
    let addresses = (MIAONET_SERVER_HOST, MIAONET_SERVER_PORT)
        .to_socket_addrs()
        .map_err(|error| format!("解析 MiaoNet 服务器地址失败：{error}"))?;
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(10)) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "无法连接 MiaoNet 服务器：{}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "没有可用的服务器地址".to_string())
    ))
}

fn exchange_miaonet_oauth_code(
    code: &str,
    protocol_version: [u16; 3],
) -> Result<(Vec<u8>, Option<String>), String> {
    let code_bytes = code.as_bytes();
    let code_length = u16::try_from(code_bytes.len()).map_err(|_| "授权码过长。".to_string())?;

    let tcp = connect_miaonet_server()?;
    tcp.set_read_timeout(Some(Duration::from_secs(12)))
        .map_err(|error| format!("设置 MiaoNet 读取超时失败：{error}"))?;
    tcp.set_write_timeout(Some(Duration::from_secs(12)))
        .map_err(|error| format!("设置 MiaoNet 写入超时失败：{error}"))?;
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = MIAONET_SERVER_HOST
        .try_into()
        .map_err(|_| "MiaoNet 服务器名称无效。".to_string())?;
    let connection = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|error| format!("创建 MiaoNet TLS 连接失败：{error}"))?;
    let mut stream = StreamOwned::new(connection, tcp);

    stream
        .write_all(&MIAONET_HANDSHAKE_HEAD)
        .map_err(|error| format!("发送 MiaoNet 连接标识失败：{error}"))?;
    let version_bytes = [
        protocol_version[0].to_le_bytes()[0],
        protocol_version[0].to_le_bytes()[1],
        protocol_version[1].to_le_bytes()[0],
        protocol_version[1].to_le_bytes()[1],
        protocol_version[2].to_le_bytes()[0],
        protocol_version[2].to_le_bytes()[1],
    ];
    stream
        .write_all(&version_bytes)
        .map_err(|error| format!("发送 MiaoNet 协议版本失败：{error}"))?;
    let mut version_result = [0u8; 1];
    stream
        .read_exact(&mut version_result)
        .map_err(|error| format!("读取 MiaoNet 协议版本结果失败：{error}"))?;
    if version_result[0] == 0 {
        let mut server_version = [0u8; 6];
        stream
            .read_exact(&mut server_version)
            .map_err(|error| format!("读取 MiaoNet 服务器版本失败：{error}"))?;
        return Err(format!(
            "MiaoNet 协议版本不匹配，服务器需要 {}.{}.{}。",
            u16::from_le_bytes([server_version[0], server_version[1]]),
            u16::from_le_bytes([server_version[2], server_version[3]]),
            u16::from_le_bytes([server_version[4], server_version[5]])
        ));
    }

    let mut payload = Vec::with_capacity(code_bytes.len() + 6);
    payload.push(0); // 简体中文
    payload.push(1); // OAuth 授权码
    payload.extend_from_slice(&code_length.to_le_bytes());
    payload.extend_from_slice(code_bytes);
    payload.extend_from_slice(&0u16.to_le_bytes()); // 不声明额外网络 Mod
    let payload_length =
        u16::try_from(payload.len()).map_err(|_| "MiaoNet 握手数据过长。".to_string())?;
    stream
        .write_all(&payload_length.to_le_bytes())
        .and_then(|_| stream.write_all(&payload))
        .map_err(|error| format!("发送 MiaoNet 登录信息失败：{error}"))?;

    let mut ack_length_bytes = [0u8; 2];
    stream
        .read_exact(&mut ack_length_bytes)
        .map_err(|error| format!("读取 MiaoNet 认证结果失败：{error}"))?;
    let ack_length = u16::from_le_bytes(ack_length_bytes) as usize;
    let mut ack = vec![0u8; ack_length];
    stream
        .read_exact(&mut ack)
        .map_err(|error| format!("读取 MiaoNet 认证数据失败：{error}"))?;
    let authentication_data = parse_miaonet_handshake_ack(&ack)?;
    let username = read_miaonet_initial_username(&mut stream);
    Ok((authentication_data, username))
}

fn encrypt_miaonet_token(authentication_data: &[u8]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let user_name = std::env::var("USERNAME").unwrap_or_else(|_| whoami::username());
    #[cfg(not(target_os = "windows"))]
    let user_name = whoami::username();

    #[cfg(target_os = "windows")]
    let machine_name = match std::env::var("COMPUTERNAME") {
        Ok(name) => Ok(name),
        Err(_) => hostname::get()
            .map(|name| name.to_string_lossy().into_owned())
            .map_err(|error| error.to_string()),
    };
    #[cfg(not(target_os = "windows"))]
    let machine_name = hostname::get()
        .map(|name| name.to_string_lossy().into_owned())
        .map_err(|error| error.to_string());
    let machine_name = machine_name.map_err(|error| format!("读取计算机名称失败：{error}"))?;
    let environment = format!("{user_name}@{machine_name}");
    let mut key_and_iv = [0u8; 48];
    pbkdf2_hmac::<Sha256>(
        environment.as_bytes(),
        b"MiaoNet.TokenDataSalt",
        12,
        &mut key_and_iv,
    );
    let (key, iv) = key_and_iv.split_at(32);
    let mut buffer = vec![0u8; authentication_data.len() + 16];
    buffer[..authentication_data.len()].copy_from_slice(authentication_data);
    let encrypted = cbc::Encryptor::<Aes256>::new_from_slices(key, iv)
        .map_err(|_| "创建 MiaoNet 登录信息加密器失败。".to_string())?
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, authentication_data.len())
        .map_err(|_| "加密 MiaoNet 登录信息失败。".to_string())?;
    Ok(general_purpose::STANDARD.encode(encrypted))
}

fn remove_yaml_property(mapping: &mut serde_yaml::Mapping, name: &str) {
    let keys = mapping
        .keys()
        .filter(|key| {
            key.as_str()
                .is_some_and(|key| key.eq_ignore_ascii_case(name))
        })
        .cloned()
        .collect::<Vec<_>>();
    for key in keys {
        mapping.remove(&key);
    }
}

fn save_miaonet_login(
    game_path: &Path,
    authentication_data: &[u8],
    username: Option<&str>,
) -> Result<(), String> {
    let settings_path = miaonet_settings_path(game_path)?;
    let mut settings = read_miaonet_settings_document(&settings_path)?;
    let serde_yaml::Value::Mapping(mapping) = &mut settings else {
        return Err("MiaoNet 设置文件格式不正确。".to_string());
    };

    remove_yaml_property(mapping, "TokenDataEncrypted");
    remove_yaml_property(mapping, "LastName");
    mapping.insert(
        serde_yaml::Value::String("TokenDataEncrypted".to_string()),
        serde_yaml::Value::String(encrypt_miaonet_token(authentication_data)?),
    );
    if let Some(username) = username.filter(|name| !name.trim().is_empty()) {
        mapping.insert(
            serde_yaml::Value::String("LastName".to_string()),
            serde_yaml::Value::String(username.to_string()),
        );
    }

    let serialized = serde_yaml::to_string(&settings)
        .map_err(|error| format!("保存 MiaoNet 设置失败：{error}"))?;
    fs::write(&settings_path, serialized).map_err(|error| format!("写入 MiaoNet 设置失败：{error}"))
}

fn run_miaonet_oauth_listener(
    listener: TcpListener,
    expected_state: &str,
    game_path: &Path,
    protocol_version: [u16; 3],
    on_event: &Channel<IpcEvent>,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        let (mut stream, _) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(80));
                continue;
            }
            Err(error) => return Err(format!("接收浏览器授权回调失败：{error}")),
        };

        let request = match read_http_request(&mut stream) {
            Ok(request) => request,
            Err(error) => {
                write_http_page(&mut stream, "400 Bad Request", "授权请求无效", &error);
                continue;
            }
        };
        let target = match parse_miaonet_callback_target(&request) {
            Ok(target) => target,
            Err(error) => {
                write_http_page(&mut stream, "400 Bad Request", "授权请求无效", &error);
                continue;
            }
        };
        let callback_url = match url::Url::parse(&format!("http://localhost{target}")) {
            Ok(url) => url,
            Err(_) => {
                write_http_page(
                    &mut stream,
                    "400 Bad Request",
                    "授权请求无效",
                    "回调地址格式不正确。",
                );
                continue;
            }
        };
        if callback_url.path() != "/auth" {
            write_http_page(
                &mut stream,
                "404 Not Found",
                "页面不存在",
                "请返回 CeleMod 重新开始授权。",
            );
            continue;
        }
        let parameters = callback_url.query_pairs().collect::<HashMap<_, _>>();
        if parameters.get("state").map(|state| state.as_ref()) != Some(expected_state) {
            write_http_page(
                &mut stream,
                "400 Bad Request",
                "授权请求已失效",
                "请返回 CeleMod 重新开始授权。",
            );
            continue;
        }
        if let Some(error) = parameters.get("error") {
            let detail = parameters
                .get("error_description")
                .map(|value| value.as_ref())
                .unwrap_or(error.as_ref());
            write_http_page(
                &mut stream,
                "400 Bad Request",
                "未完成授权",
                "你可以关闭此页面并返回 CeleMod 重试。",
            );
            return Err(format!("论坛未完成授权：{detail}"));
        }
        let Some(code) = parameters.get("code") else {
            write_http_page(
                &mut stream,
                "400 Bad Request",
                "授权请求无效",
                "论坛没有返回授权码，请返回 CeleMod 重试。",
            );
            continue;
        };

        write_http_page(
            &mut stream,
            "200 OK",
            "MiaoNet+ 授权已收到",
            "CeleMod 正在验证并保存登录信息。你现在可以关闭此页面并返回 CeleMod。",
        );
        drop(stream);
        miaonet_oauth_event(on_event, "exchanging_code", None);
        let result = exchange_miaonet_oauth_code(code.as_ref(), protocol_version).and_then(
            |(authentication_data, username)| {
                miaonet_oauth_event(on_event, "saving_token", None);
                save_miaonet_login(game_path, &authentication_data, username.as_deref())
            },
        );
        match result {
            Ok(()) => {
                miaonet_oauth_event(on_event, "complete", None);
                return Ok(());
            }
            Err(error) => return Err(error),
        }
    }
    Err("等待浏览器授权超时，请重新开始。".to_string())
}

#[tauri::command]
fn start_miaonet_oauth(game_path: String, on_event: Channel<IpcEvent>) -> Result<(), String> {
    let game_path = PathBuf::from(normalize_game_path_impl(&game_path));
    if is_celeste_running(&game_path) {
        return Err("请先退出 Celeste，避免游戏覆盖新的登录信息。".to_string());
    }
    let protocol_version = installed_miaonet_protocol_version(&game_path)?;
    if MIAONET_OAUTH_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("已有一个 MiaoNet 授权流程正在进行。".to_string());
    }

    let listener = match TcpListener::bind(("127.0.0.1", 21472)) {
        Ok(listener) => listener,
        Err(error) => {
            MIAONET_OAUTH_ACTIVE.store(false, Ordering::Release);
            return Err(format!("无法启动本地授权回调（端口 21472）：{error}"));
        }
    };
    if let Err(error) = listener.set_nonblocking(true) {
        MIAONET_OAUTH_ACTIVE.store(false, Ordering::Release);
        return Err(format!("无法配置本地授权回调：{error}"));
    }

    let mut random = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut random);
    let state = general_purpose::URL_SAFE_NO_PAD.encode(random);
    let authorization_url = match make_miaonet_oauth_url(&state) {
        Ok(url) => url,
        Err(error) => {
            MIAONET_OAUTH_ACTIVE.store(false, Ordering::Release);
            return Err(error);
        }
    };

    std::thread::spawn(move || {
        let _guard = MiaoNetOauthGuard;
        miaonet_oauth_event(&on_event, "waiting_browser", None);
        if let Err(error) = open::that(&authorization_url) {
            miaonet_oauth_event(
                &on_event,
                "failed",
                Some(&format!("无法打开系统浏览器：{error}")),
            );
            return;
        }
        if let Err(error) =
            run_miaonet_oauth_listener(listener, &state, &game_path, protocol_version, &on_event)
        {
            miaonet_oauth_event(&on_event, "failed", Some(&error));
        }
    });
    Ok(())
}

fn send_event(channel: &Channel<IpcEvent>, args: Vec<IpcEvent>) {
    let _ = channel.send(IpcEvent::Array(args));
}

#[cfg(target_os = "macos")]
fn apply_macos_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};

    apply_vibrancy(
        window,
        NSVisualEffectMaterial::Titlebar,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    )
    .map_err(|error| format!("failed to apply macOS vibrancy: {error}"))
}

#[cfg(target_os = "windows")]
fn set_legacy_windows_acrylic(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    use std::ffi::c_void;
    use winapi::{
        shared::{minwindef::BOOL, windef::HWND},
        um::libloaderapi::{GetModuleHandleA, GetProcAddress},
    };

    #[repr(C)]
    struct AccentPolicy {
        state: i32,
        flags: i32,
        gradient_color: u32,
        animation_id: i32,
    }

    #[repr(C)]
    struct WindowCompositionAttributeData {
        attribute: i32,
        data: *mut c_void,
        size: usize,
    }

    type SetWindowCompositionAttribute =
        unsafe extern "system" fn(HWND, *mut WindowCompositionAttributeData) -> BOOL;

    const WCA_ACCENT_POLICY: i32 = 19;
    const ACCENT_DISABLED: i32 = 0;
    const ACCENT_ENABLE_ACRYLIC_BLUR_BEHIND: i32 = 4;

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to get the Windows window handle: {error}"))?
        .0 as HWND;

    unsafe {
        let user32 = GetModuleHandleA(c"user32.dll".as_ptr());
        if user32.is_null() {
            return Err("failed to load user32.dll".into());
        }

        let proc = GetProcAddress(user32, c"SetWindowCompositionAttribute".as_ptr());
        if proc.is_null() {
            return Err("SetWindowCompositionAttribute is unavailable".into());
        }

        let set_window_composition_attribute: SetWindowCompositionAttribute =
            std::mem::transmute(proc);
        let mut policy = AccentPolicy {
            state: if enabled {
                ACCENT_ENABLE_ACRYLIC_BLUR_BEHIND
            } else {
                ACCENT_DISABLED
            },
            flags: 0,
            // The alpha byte is the persistent dark mask used by the legacy UI.
            gradient_color: if enabled { 0x9905_0505 } else { 0 },
            animation_id: 0,
        };
        let mut data = WindowCompositionAttributeData {
            attribute: WCA_ACCENT_POLICY,
            data: (&mut policy as *mut AccentPolicy).cast(),
            size: std::mem::size_of::<AccentPolicy>(),
        };

        if set_window_composition_attribute(hwnd, &mut data) == 0 {
            return Err("SetWindowCompositionAttribute failed".into());
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::apply_mica;

    set_legacy_windows_acrylic(window, true).or_else(|acrylic_error| {
        apply_mica(window, Some(true)).map_err(|mica_error| {
            format!(
                "failed to apply Windows acrylic ({acrylic_error}); Mica fallback also failed: {mica_error}"
            )
        })
    })
}

#[cfg(target_os = "windows")]
fn clear_windows_vibrancy(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::{clear_acrylic, clear_mica};

    let legacy_acrylic_result = set_legacy_windows_acrylic(window, false);
    let mica_result = clear_mica(window);
    let acrylic_result = clear_acrylic(window);
    if legacy_acrylic_result.is_ok() || mica_result.is_ok() || acrylic_result.is_ok() {
        Ok(())
    } else {
        Err(format!(
            "failed to clear legacy Windows acrylic ({}); Mica cleanup failed ({}); modern acrylic cleanup also failed: {}",
            legacy_acrylic_result.unwrap_err(),
            mica_result.unwrap_err(),
            acrylic_result.unwrap_err()
        ))
    }
}

#[tauri::command]
fn set_window_vibrancy(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            apply_macos_vibrancy(&window)
        } else {
            window_vibrancy::clear_vibrancy(&window)
                .map(|_| ())
                .map_err(|error| format!("failed to clear macOS vibrancy: {error}"))
        }
    }

    #[cfg(target_os = "windows")]
    {
        if enabled {
            apply_windows_vibrancy(&window)
        } else {
            clear_windows_vibrancy(&window)
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, enabled);
        Ok(())
    }
}

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

fn read_mod_yaml_bytes(path: &Path) -> anyhow::Result<Vec<u8>> {
    let zipfile = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(zipfile)?;
    let everest_name = archive
        .file_names()
        .find(|name| name == &"everest.yaml" || name == &"everest.yml")
        .context("Failed to find everest.yaml")?
        .to_string();

    let mut file = archive
        .by_name(&everest_name)
        .context("Failed to get everest.yaml")?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    Ok(buffer)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EverestModDependency {
    name: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EverestModMetadata {
    name: Option<String>,
    version: Option<String>,
    dependencies: Option<Vec<EverestModDependency>>,
    optional_dependencies: Option<Vec<EverestModDependency>>,
    #[serde(rename = "DLL")]
    dll: Option<String>,
}

fn parse_mod_yaml_document(content: &str) -> Result<Vec<EverestModMetadata>, serde_yaml::Error> {
    serde_yaml::from_str(content)
}

fn parse_mod_yaml(path: &Path) -> anyhow::Result<Vec<EverestModMetadata>> {
    use strip_bom::StripBom;
    let buffer = read_mod_yaml_bytes(path)?;
    Ok(parse_mod_yaml_document(
        String::from_utf8(buffer)?.strip_bom(),
    )?)
}

fn extract_mod_for_yaml(path: &Path) -> anyhow::Result<Vec<EverestModMetadata>> {
    use std::io::Write;
    use strip_bom::StripBom;

    let buffer = read_mod_yaml_bytes(path)?;
    let cache_dir = path
        .parent()
        .context("Mod archive has no parent folder")?
        .parent()
        .context("Mods folder has no parent folder")?
        .join("celemod_yaml_cache");
    std::fs::create_dir_all(&cache_dir)?;

    let mut file =
        std::fs::File::create(cache_dir.join(path.with_extension("yaml").file_name().unwrap()))?;
    file.write_all(&buffer)?;
    Ok(parse_mod_yaml_document(
        String::from_utf8(buffer)?.strip_bom(),
    )?)
}

fn is_valid_zip_archive(path: &Path) -> bool {
    std::fs::File::open(path)
        .ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some()
}

fn get_invalid_zip_mod_files_sync(mods_folder_path: &str) -> Vec<String> {
    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|v| v.is_file()).unwrap_or(false))
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|v| v == "zip")
                .unwrap_or(false)
        })
        .filter(|entry| !is_valid_zip_archive(&entry.path()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

#[derive(Debug, Serialize, Clone)]
struct FullModCheckIssue {
    file: String,
    error: String,
}

#[derive(Debug, Serialize)]
struct FullModCheckProgress {
    current: usize,
    total: usize,
    file: String,
    done: bool,
    issues: Vec<FullModCheckIssue>,
}

fn get_zip_mod_entries(mods_folder_path: &str) -> Vec<fs::DirEntry> {
    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|v| v.is_file()).unwrap_or(false))
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|v| v.eq_ignore_ascii_case("zip"))
                .unwrap_or(false)
        })
        .collect()
}

fn check_zip_mod_file_content(path: &Path) -> anyhow::Result<()> {
    let file = fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut buffer = vec![0_u8; 64 * 1024];

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
        }
    }

    Ok(())
}

fn check_all_mod_contents_sync(
    mods_folder_path: &str,
    progress_callback: &mut dyn FnMut(FullModCheckProgress),
) {
    let entries = get_zip_mod_entries(mods_folder_path);
    let total = entries.len();
    let mut issues = Vec::new();

    progress_callback(FullModCheckProgress {
        current: 0,
        total,
        file: String::new(),
        done: total == 0,
        issues: Vec::new(),
    });

    if total == 0 {
        return;
    }

    for (index, entry) in entries.into_iter().enumerate() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Err(err) = check_zip_mod_file_content(&path) {
            issues.push(FullModCheckIssue {
                file: file_name.clone(),
                error: format!("{err:#}"),
            });
        }

        progress_callback(FullModCheckProgress {
            current: index + 1,
            total,
            file: file_name,
            done: index + 1 == total,
            issues: if index + 1 == total {
                issues.clone()
            } else {
                Vec::new()
            },
        });
    }
}

fn delete_mod_files_sync(mods_folder_path: &str, file_names: &[String]) -> anyhow::Result<()> {
    for file_name in file_names {
        let safe_name = Path::new(file_name)
            .file_name()
            .context("Invalid mod file name")?;
        let path = Path::new(mods_folder_path).join(safe_name);
        if path.exists() {
            if path.is_dir() {
                fs::remove_dir_all(path)?;
            } else {
                fs::remove_file(path)?;
            }
        }
    }
    Ok(())
}

fn download_mod_archive_with_cancel(
    url: &str,
    dest: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let destination = Path::new(dest);
    let destination_lock = DOWNLOAD_DESTINATION_LOCKS
        .lock()
        .unwrap()
        .entry(dest.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    let _destination_guard = loop {
        match destination_lock.try_lock() {
            Ok(guard) => break guard,
            Err(std::sync::TryLockError::WouldBlock) => {
                if cancel_flag.load(Ordering::Relaxed) {
                    bail!("Download canceled");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(std::sync::TryLockError::Poisoned(error)) => break error.into_inner(),
        }
    };
    let mut temporary_name = destination.as_os_str().to_os_string();
    temporary_name.push(".celemod");
    let temporary = PathBuf::from(temporary_name);

    let result: anyhow::Result<()> = try {
        ureq::download_file_to_path_with_progress(
            url,
            temporary.to_string_lossy().as_ref(),
            progress_callback,
            multi_thread,
            cancel_flag,
        )?;

        if !is_valid_zip_archive(&temporary) {
            bail!("Downloaded file is not a valid zip archive");
        }

        if destination.exists() {
            std::fs::remove_file(destination)
                .with_context(|| format!("Failed to replace Mod archive at {dest}"))?;
        }
        std::fs::rename(&temporary, destination)
            .with_context(|| format!("Failed to finish Mod archive at {dest}"))?;
    };

    result
}

fn cleanup_mod_download_temp_files_impl(mods_dir: &Path) -> anyhow::Result<usize> {
    if !mods_dir.is_dir() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(mods_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !file_name.ends_with(".zip.celemod") {
            continue;
        }
        fs::remove_file(entry.path())?;
        removed += 1;
    }
    Ok(removed)
}

fn cleanup_game_mod_download_temp_files(game_path: &Path) -> anyhow::Result<usize> {
    cleanup_mod_download_temp_files_impl(&normalize_game_path_buf(game_path).join("Mods"))
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
    modified_at: u64,
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

fn parse_version(mod_version: Option<&str>) -> String {
    let v_str = mod_version.unwrap_or("1.0.0");
    let start_idx = v_str.find(|c: char| c.is_ascii_digit()).unwrap_or(0);
    let trimmed = &v_str[start_idx..];

    if !trimmed.is_empty() && trimmed.chars().next().unwrap().is_ascii_digit() {
        trimmed.to_string()
    } else {
        "1.0.0".to_string()
    }
}

fn parse_mod_dependencies(metadata: &EverestModMetadata) -> Vec<ModDependency> {
    let mut dependencies = Vec::new();
    for (items, optional) in [
        (&metadata.dependencies, false),
        (&metadata.optional_dependencies, true),
    ] {
        let Some(items) = items else {
            continue;
        };
        for dependency in items {
            let Some(name) = dependency.name.as_ref() else {
                continue;
            };
            dependencies.push(ModDependency {
                name: name.clone(),
                version: parse_version(dependency.version.as_deref()),
                optional,
            });
        }
    }
    dependencies
}

fn get_installed_mods_sync_with_catalog(
    mods_folder_path: String,
    mod_data: Option<Arc<HashMap<String, everest::ModInfoCached>>>,
) -> Vec<LocalMod> {
    let mut mods = Vec::new();

    let Ok(entries) = fs::read_dir(mods_folder_path) else {
        return mods;
    };

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
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
                continue;
            };

            let metadata_entries = match parse_mod_yaml_document(&yaml) {
                Ok(metadata_entries) => metadata_entries,
                Err(error) => {
                    println!(
                        "[ WARNING ] Failed to parse {:?}: {}",
                        entry.file_name(),
                        error
                    );
                    continue;
                }
            };

            let metadata = entry.metadata().context("Failed to read Mod metadata")?;
            let size = metadata.len();
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64)
                .unwrap_or_default();

            let file = entry.file_name().to_string_lossy().to_string();
            for metadata_entry in &metadata_entries {
                let Some(name) = metadata_entry.name.as_ref() else {
                    println!(
                        "[ WARNING ] Skipping unnamed metadata in {:?}",
                        entry.file_name()
                    );
                    continue;
                };
                let name = name.clone();
                let gbid = mod_data
                    .as_ref()
                    .and_then(|catalog| catalog.get(&name))
                    .map(|item| item.game_banana_id)
                    .unwrap_or(-1);

                mods.push(LocalMod {
                    name,
                    version: parse_version(metadata_entry.version.as_deref()),
                    game_banana_id: gbid,
                    deps: parse_mod_dependencies(metadata_entry),
                    file: file.clone(),
                    size,
                    modified_at,
                });
            }
        };

        if let Err(e) = res {
            println!("[ WARNING ] Failed to parse {:?}: {}", entry.file_name(), e)
        }
    }
    mods
}

fn get_installed_mods_sync(mods_folder_path: String) -> Vec<LocalMod> {
    let mod_data = get_mod_cached_new().unwrap_or_else(|error| {
        eprintln!("Failed to load Mod catalog while scanning installed Mods: {error:#}");
        Arc::new(HashMap::new())
    });
    get_installed_mods_sync_with_catalog(mods_folder_path, Some(mod_data))
}

fn get_installed_mods_without_catalog_sync(mods_folder_path: String) -> Vec<LocalMod> {
    get_installed_mods_sync_with_catalog(mods_folder_path, None)
}

fn download_and_install_mod(
    url: &str,
    dest: &String,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<Vec<(String, String)>> {
    download_mod_archive_with_cancel(url, dest, progress_callback, multi_thread, cancel_flag)?;

    let metadata_entries = extract_mod_for_yaml(Path::new(dest))?;

    let mut deps: Vec<(String, String)> = Vec::new();

    for metadata_entry in &metadata_entries {
        if let Some(dependencies) = &metadata_entry.dependencies {
            for dependency in dependencies {
                let dependency = (
                    dependency
                        .name
                        .clone()
                        .context("Interrupted yaml dependency")?,
                    parse_version(dependency.version.as_deref()),
                );
                if !deps.contains(&dependency) {
                    deps.push(dependency);
                }
            }
        }
    }
    Ok(deps)
}

fn rm_mod_sync(mods_folder_path: &str, mod_name: &str) -> anyhow::Result<()> {
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

fn normalize_game_path_impl(path: &str) -> String {
    normalize_game_path_buf(Path::new(path))
        .to_string_lossy()
        .to_string()
}

fn normalize_game_path_buf(path: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        fn has_game_artifact(path: &Path) -> bool {
            path.join("Celeste.exe").is_file()
                || path.join("Celeste.dll").is_file()
                || path.join("Celeste").is_file()
        }

        fn is_named(path: &Path, name: &str) -> bool {
            path.file_name().and_then(|v| v.to_str()) == Some(name)
        }

        fn resources_if_valid(path: PathBuf) -> Option<PathBuf> {
            if path.is_dir()
                && (has_game_artifact(&path)
                    || path
                        .parent()
                        .map(|contents| contents.join("MacOS").join("Celeste").is_file())
                        .unwrap_or(false))
            {
                Some(path)
            } else {
                None
            }
        }

        let path = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };

        if is_named(path, "Resources") {
            if let Some(resources) = resources_if_valid(path.to_path_buf()) {
                return resources;
            }
        }

        if is_named(path, "MacOS") {
            if let Some(contents) = path.parent() {
                if let Some(resources) = resources_if_valid(contents.join("Resources")) {
                    return resources;
                }
            }
        }

        if is_named(path, "Contents") {
            if let Some(resources) = resources_if_valid(path.join("Resources")) {
                return resources;
            }
        }

        if path.extension().and_then(|v| v.to_str()) == Some("app") {
            if let Some(resources) = resources_if_valid(path.join("Contents").join("Resources")) {
                return resources;
            }
        }

        if let Some(resources) =
            resources_if_valid(path.join("Celeste.app").join("Contents").join("Resources"))
        {
            return resources;
        }

        if has_game_artifact(path) {
            if let Some(parent) = path.parent() {
                if is_named(parent, "Contents") {
                    if let Some(resources) = resources_if_valid(parent.join("Resources")) {
                        return resources;
                    }
                }
            }
        }
    }

    path.to_path_buf()
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
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_sec: f64,
}

enum DownloadWorkerMessage {
    Progress {
        index: usize,
        progress: DownloadCallbackInfo,
    },
    Finished {
        index: usize,
        result: Result<Vec<(String, String)>, String>,
    },
}

fn emit_download_tasks(tasks: &[DownloadInfo], on_event: &Channel<IpcEvent>, state: &'static str) {
    let snapshot = serde_json::to_string(tasks).unwrap_or_else(|_| "[]".to_string());
    send_event(
        on_event,
        vec![serde_json::json!(snapshot), serde_json::json!(state)],
    );
}

fn enqueue_missing_dependencies(
    tasks: &mut Vec<DownloadInfo>,
    queued: &mut HashMap<String, usize>,
    dependencies: Vec<(String, String)>,
    installed: &[LocalMod],
    mod_data: &HashMap<String, everest::ModInfoCached>,
    mods_dir: &str,
) -> usize {
    let mut added = 0;
    for (dependency, min_version) in dependencies {
        // queued 记录 Waiting / Downloading / Finished / Failed 的整个任务队列，
        // 任意父依赖重复发现同一个名字时都不会再次入队。
        if queued.contains_key(&dependency)
            || installed.iter().any(|item| {
                item.name == dependency && compare_version(&item.version, &min_version) >= 0
            })
        {
            continue;
        }
        let Some(data) = mod_data.get(&dependency) else {
            eprintln!("Failed to resolve dependency {dependency} in Mod data");
            continue;
        };

        let index = tasks.len();
        queued.insert(dependency.clone(), index);
        tasks.push(DownloadInfo {
            name: dependency.clone(),
            url: data.download_url.clone(),
            dest: Path::new(mods_dir)
                .join(format!("{}.zip", make_path_compatible_name(&dependency)))
                .to_string_lossy()
                .to_string(),
            status: DownloadStatus::Waiting,
            data: "0".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0.0,
        });
        added += 1;
    }
    added
}

fn start_waiting_mod_downloads(
    tasks: &mut [DownloadInfo],
    started_or_finished: &mut HashSet<String>,
    sender: &std::sync::mpsc::Sender<DownloadWorkerMessage>,
    handles: &mut Vec<std::thread::JoinHandle<()>>,
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> usize {
    let waiting = tasks
        .iter()
        .enumerate()
        .filter_map(|(index, task)| (task.status == DownloadStatus::Waiting).then_some(index))
        .collect::<Vec<_>>();
    let mut started = 0;

    for index in waiting {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        // 即使入队阶段已经去重，真正启动前仍再次检查，避免同一个名字出现两个
        // Downloading / Finished 任务。
        if started_or_finished.contains(&tasks[index].name) {
            continue;
        }
        started_or_finished.insert(tasks[index].name.clone());
        tasks[index].status = DownloadStatus::Downloading;
        tasks[index].data = "0".to_string();

        let sender = sender.clone();
        let task_url = tasks[index].url.clone();
        let task_dest = tasks[index].dest.clone();
        let cancel_flag = Arc::clone(cancel_flag);
        handles.push(std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let progress_sender = sender.clone();
                download_and_install_mod(
                    &task_url,
                    &task_dest,
                    &mut |progress| {
                        let _ = progress_sender
                            .send(DownloadWorkerMessage::Progress { index, progress });
                    },
                    multi_thread,
                    &cancel_flag,
                )
                .map_err(|error| format!("{error:#}"))
            }))
            .unwrap_or_else(|_| Err("Download worker stopped unexpectedly".to_string()));
            let _ = sender.send(DownloadWorkerMessage::Finished { index, result });
        }));
        started += 1;
    }

    started
}

/// 事件驱动的依赖队列：任意 Mod 一完成就立即解析 YAML、去重入队它的新依赖，
/// 并马上启动所有 Waiting 项，不等待同一层的其他下载结束。
fn download_mod_queue(
    tasks: &mut Vec<DownloadInfo>,
    installed: &[LocalMod],
    mod_data: &HashMap<String, everest::ModInfoCached>,
    mods_dir: &str,
    on_event: &Channel<IpcEvent>,
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> bool {
    let mut queued = tasks
        .iter()
        .enumerate()
        .map(|(index, task)| (task.name.clone(), index))
        .collect::<HashMap<_, _>>();
    let mut started_or_finished = HashSet::new();
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut handles = Vec::new();
    let mut failed = false;
    let mut active = start_waiting_mod_downloads(
        tasks,
        &mut started_or_finished,
        &sender,
        &mut handles,
        multi_thread,
        cancel_flag,
    );
    emit_download_tasks(tasks, on_event, "pending");

    while active > 0 {
        let Ok(message) = receiver.recv() else {
            failed = true;
            break;
        };
        match message {
            DownloadWorkerMessage::Progress { index, progress } => {
                tasks[index].data = format!("{:.2}", progress.progress);
                tasks[index].downloaded_bytes = progress.downloaded_bytes;
                tasks[index].total_bytes = progress.total_bytes;
                tasks[index].speed_bytes_per_sec = progress.speed_bytes_per_sec;
                emit_download_tasks(tasks, on_event, "pending");
            }
            DownloadWorkerMessage::Finished { index, result } => {
                active -= 1;
                match result {
                    Ok(task_dependencies) => {
                        tasks[index].status = DownloadStatus::Finished;
                        tasks[index].data = "100".to_string();
                        tasks[index].speed_bytes_per_sec = 0.0;
                        if !cancel_flag.load(Ordering::Relaxed) {
                            enqueue_missing_dependencies(
                                tasks,
                                &mut queued,
                                task_dependencies,
                                installed,
                                mod_data,
                                mods_dir,
                            );
                        }
                    }
                    Err(error) => {
                        tasks[index].status = DownloadStatus::Failed;
                        tasks[index].data = error;
                        tasks[index].speed_bytes_per_sec = 0.0;
                        let _ = fs::remove_file(&tasks[index].dest);
                        failed = true;
                    }
                }

                // 新依赖一入队就立即启动；不等待其他 active 任务结束。
                active += start_waiting_mod_downloads(
                    tasks,
                    &mut started_or_finished,
                    &sender,
                    &mut handles,
                    multi_thread,
                    cancel_flag,
                );
                emit_download_tasks(tasks, on_event, "pending");
            }
        }
    }

    drop(sender);
    for handle in handles {
        if handle.join().is_err() {
            failed = true;
        }
    }

    if cancel_flag.load(Ordering::Relaxed) {
        for task in tasks
            .iter_mut()
            .filter(|task| task.status == DownloadStatus::Waiting)
        {
            task.status = DownloadStatus::Failed;
            task.data = "Download canceled".to_string();
        }
    }

    failed || cancel_flag.load(Ordering::Relaxed)
}

fn make_path_compatible_name(name: &str) -> String {
    name.replace([' ', ':', '/', '\\', '?', '*', '\"', '<', '>', '|'], "_")
}

#[derive(Debug, Clone, Copy)]
enum LocalPackageKind {
    Mod,
    Everest,
}

impl LocalPackageKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Everest => "everest",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPackageInstallResult {
    file: String,
    package_type: String,
    success: bool,
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPackageInstallProgress {
    current: usize,
    total: usize,
    file: String,
    detail: String,
    progress: f32,
}

fn is_celeste_running(game_path: &Path) -> bool {
    use sysinfo::{ProcessExt, System, SystemExt};

    fn comparable_path(path: &Path) -> String {
        let value = path.to_string_lossy().replace('/', "\\");
        #[cfg(target_os = "windows")]
        let value = value.strip_prefix(r"\\?\").unwrap_or(&value).to_lowercase();
        value.trim_end_matches('\\').to_string()
    }

    let game_directory = comparable_path(game_path);
    let mut system = System::new();
    system.refresh_processes();

    system.processes().values().any(|process| {
        let process_name = process.name().to_ascii_lowercase();
        if process_name != "celeste" && process_name != "celeste.exe" {
            return false;
        }

        let executable = process.exe();
        if executable.as_os_str().is_empty() {
            return false;
        }

        let executable_directory = executable.parent().map(comparable_path).unwrap_or_default();
        if executable_directory == game_directory {
            return true;
        }

        #[cfg(target_os = "macos")]
        if game_path.file_name().and_then(|name| name.to_str()) == Some("Resources") {
            let macos_directory = game_path
                .parent()
                .map(|contents| contents.join("MacOS"))
                .map(|path| comparable_path(&path))
                .unwrap_or_default();
            return executable_directory == macos_directory;
        }

        false
    })
}

fn classify_local_package(path: &Path) -> anyhow::Result<LocalPackageKind> {
    if !path.is_file() {
        bail!("Package is not a file");
    }
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        bail!("Only zip packages are supported");
    }

    let file = fs::File::open(path)?;
    let archive = zip::ZipArchive::new(file)?;
    if archive
        .file_names()
        .any(|name| name == "everest.yaml" || name == "everest.yml")
    {
        return Ok(LocalPackageKind::Mod);
    }
    drop(archive);

    if everest::is_everest_install_archive(path)? {
        Ok(LocalPackageKind::Everest)
    } else {
        bail!("The zip is neither a Mod nor an Everest package for this platform")
    }
}

fn replace_local_mod_archive(source: &Path, destination: &Path) -> anyhow::Result<()> {
    let file_name = destination
        .file_name()
        .context("Failed to resolve Mod archive file name")?
        .to_string_lossy();
    let install_id = std::process::id();
    let temporary =
        destination.with_file_name(format!(".{file_name}.celemod-installing-{install_id}"));
    let backup = destination.with_file_name(format!(".{file_name}.celemod-backup-{install_id}"));

    fs::remove_file(&temporary).ok();
    fs::remove_file(&backup).ok();
    fs::copy(source, &temporary).with_context(|| {
        format!(
            "Failed to copy package into {}",
            destination.parent().unwrap_or(destination).display()
        )
    })?;

    let had_existing = destination.exists();
    if had_existing {
        if let Err(error) = fs::rename(destination, &backup) {
            fs::remove_file(&temporary).ok();
            return Err(error).context("Failed to back up the existing Mod archive");
        }
    }

    if let Err(error) = fs::rename(&temporary, destination) {
        if had_existing {
            fs::rename(&backup, destination).ok();
        }
        fs::remove_file(&temporary).ok();
        return Err(error).context("Failed to finish installing the Mod archive");
    }

    fs::remove_file(&backup).ok();
    Ok(())
}

fn install_local_mod(game_path: &Path, package_path: &Path) -> anyhow::Result<(String, String)> {
    let metadata = parse_mod_yaml(package_path)?;
    let mod_name = metadata
        .first()
        .and_then(|metadata| metadata.name.clone())
        .context("everest.yaml is missing the Mod name")?;
    let source_name = package_path
        .file_name()
        .context("Package path has no file name")?;
    let destination_name = source_name.to_string_lossy().to_string();
    let mods_path = game_path.join("Mods");
    fs::create_dir_all(&mods_path)?;
    let destination = mods_path.join(source_name);

    replace_local_mod_archive(package_path, &destination)?;
    Ok((mod_name, destination_name))
}

fn replace_installed_mod_with_fix(
    game_path: &Path,
    package_path: &Path,
    expected_mod_name: &str,
    affected_versions: &[String],
    fixed_version: &str,
) -> anyhow::Result<String> {
    let metadata = parse_mod_yaml(package_path)?;
    let package_metadata = metadata
        .first()
        .context("Fix package everest.yaml contains no Mod metadata")?;
    let package_name = package_metadata
        .name
        .as_deref()
        .context("Fix package everest.yaml is missing the Mod name")?;
    let package_version = package_metadata
        .version
        .as_deref()
        .context("Fix package everest.yaml is missing the Mod version")?;
    if package_name != expected_mod_name {
        bail!("Fix package contains {package_name}, expected {expected_mod_name}");
    }
    if package_version != fixed_version {
        bail!("Fix package version is {package_version}, expected {fixed_version}");
    }

    let installed = get_installed_mods_without_catalog_sync(
        game_path.join("Mods").to_string_lossy().into_owned(),
    );
    let local_mod = installed
        .iter()
        .find(|item| item.name.eq_ignore_ascii_case(expected_mod_name))
        .context("The affected Mod is not installed")?;
    if !affected_versions
        .iter()
        .any(|version| version == &local_mod.version)
    {
        bail!(
            "Installed {expected_mod_name} version {} is not affected",
            local_mod.version
        );
    }

    let destination = game_path.join("Mods").join(&local_mod.file);
    if !destination.is_file()
        || !destination
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        bail!("Automatic repair currently supports zip-installed Mods only");
    }
    replace_local_mod_archive(package_path, &destination)?;
    Ok(local_mod.file.clone())
}

fn download_and_install_crash_mod_fix_impl(
    game_path: &Path,
    mod_name: &str,
    affected_versions: &[String],
    fixed_version: &str,
    url: &str,
    sha256: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<String> {
    let cache_root = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .context("Failed to find a cache directory")?
        .join("CeleMod")
        .join("mod-fixes");
    fs::create_dir_all(&cache_root)?;
    let download_path = cache_root.join(format!(
        ".{}-{}.download.zip",
        mod_name
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .collect::<String>(),
        std::process::id()
    ));
    fs::remove_file(&download_path).ok();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let result = (|| {
        ureq::download_file_with_progress(
            url,
            download_path.to_string_lossy().as_ref(),
            &mut |callback| progress_callback("download".to_string(), callback.progress),
            false,
            &cancel_flag,
        )?;
        progress_callback("verify".to_string(), 0.0);
        verify_file_sha256(&download_path, sha256)?;
        progress_callback("verify".to_string(), 100.0);
        classify_local_package(&download_path)
            .context("Downloaded fix is not a valid Mod package")?;
        progress_callback("install".to_string(), 0.0);
        let replaced = replace_installed_mod_with_fix(
            game_path,
            &download_path,
            mod_name,
            affected_versions,
            fixed_version,
        )?;
        progress_callback("install".to_string(), 100.0);
        Ok(replaced)
    })();
    fs::remove_file(download_path).ok();
    result
}

fn disable_installed_local_mods(
    game_path: &String,
    installed_mods: &[(String, String)],
    profile_enabled: bool,
    current_profile_name: &str,
    always_on_mods: &[String],
) -> anyhow::Result<()> {
    let installed_mods = installed_mods
        .iter()
        .filter(|(name, _)| !always_on_mods.contains(name))
        .collect::<Vec<_>>();
    if installed_mods.is_empty() {
        return Ok(());
    }
    if !profile_enabled {
        let files = installed_mods
            .iter()
            .map(|installed| installed.1.clone())
            .collect::<Vec<_>>();
        return blacklist::switch_direct_blacklist(game_path, &files, false);
    }

    let names = installed_mods
        .iter()
        .map(|(name, _)| (*name).clone())
        .collect::<Vec<_>>();
    for profile in blacklist::get_mod_blacklist_profiles(game_path) {
        blacklist::switch_mod_profile_mods(game_path, &profile.name, &names, false)?;
    }
    let profiles = if current_profile_name.is_empty() {
        blacklist::get_current_profiles(game_path)
    } else {
        vec![current_profile_name.to_string()]
    };
    blacklist::apply_mod_blacklist_profiles(game_path, &profiles, always_on_mods)?;
    Ok(())
}

/// Enables freshly downloaded Mods in the active profile (or removes them from
/// the direct blacklist). The UI re-applies profiles after every download, and
/// `apply_mod_blacklist_profiles` rebuilds blacklist.txt as a whitelist: a Mod
/// that is never added to `enabled_mods` would be blacklisted on the very next
/// reload, defeating the "enable by default" download setting.
fn enable_installed_local_mods(
    game_path: &String,
    installed_mods: &[(String, String)],
    profile_enabled: bool,
    current_profile_name: &str,
    always_on_mods: &[String],
) -> anyhow::Result<()> {
    let installed_mods = installed_mods
        .iter()
        .filter(|(name, _)| !always_on_mods.contains(name))
        .collect::<Vec<_>>();
    if installed_mods.is_empty() {
        return Ok(());
    }
    if !profile_enabled {
        let files = installed_mods
            .iter()
            .map(|installed| installed.1.clone())
            .collect::<Vec<_>>();
        return blacklist::switch_direct_blacklist(game_path, &files, true);
    }

    let names = installed_mods
        .iter()
        .map(|(name, _)| (*name).clone())
        .collect::<Vec<_>>();
    let profiles = if current_profile_name.is_empty() {
        blacklist::get_current_profiles(game_path)
    } else {
        vec![current_profile_name.to_string()]
    };
    for profile_name in &profiles {
        blacklist::switch_mod_profile_mods(game_path, profile_name, &names, true)?;
    }
    blacklist::apply_mod_blacklist_profiles(game_path, &profiles, always_on_mods)?;
    Ok(())
}

fn collect_required_installed_mods(
    root_names: &[String],
    installed: &[LocalMod],
) -> Vec<(String, String)> {
    let installed_by_name = installed
        .iter()
        .map(|item| (item.name.as_str(), item))
        .collect::<HashMap<_, _>>();
    let mut result = Vec::new();
    let mut visited = HashSet::new();
    let mut pending = root_names.to_vec();
    while let Some(name) = pending.pop() {
        if !visited.insert(name.clone()) {
            continue;
        }
        let Some(item) = installed_by_name.get(name.as_str()) else {
            continue;
        };
        result.push((item.name.clone(), item.file.clone()));
        pending.extend(
            item.deps
                .iter()
                .filter(|dependency| !dependency.optional)
                .map(|dependency| dependency.name.clone()),
        );
    }
    result
}

#[cfg(test)]
mod local_package_tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::write::SimpleFileOptions;

    fn test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("celemod-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn identifies_and_installs_mod_archives() {
        let root = test_dir("drop-mod");
        let package = root.join("Test Mod.zip");
        let game_path = root.join("game");
        fs::create_dir_all(&game_path).unwrap();
        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: DropInstallTest\n  Version: 1.0.0\n",
            )],
        );

        assert!(matches!(
            classify_local_package(&package).unwrap(),
            LocalPackageKind::Mod
        ));
        let installed = install_local_mod(&game_path, &package).unwrap();
        assert_eq!(installed.0, "DropInstallTest");
        assert_eq!(installed.1, "Test Mod.zip");
        let installed_path = game_path.join("Mods").join(installed.1);
        assert!(installed_path.is_file());

        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: DropInstallReplacement\n  Version: 2.0.0\n",
            )],
        );
        install_local_mod(&game_path, &package).unwrap();
        assert_eq!(
            parse_mod_yaml(&installed_path).unwrap()[0].name.as_deref(),
            Some("DropInstallReplacement")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_unquoted_numeric_names_and_versions() {
        let root = test_dir("numeric-mod-metadata");
        let mods_path = root.join("Mods");
        fs::create_dir_all(&mods_path).unwrap();
        let package = mods_path.join("Numeric.zip");
        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: 1234\n  Version: 1.20\n  Dependencies:\n    - Name: 5678\n      Version: 2.00\n",
            )],
        );

        let metadata = parse_mod_yaml(&package).unwrap();
        assert_eq!(metadata[0].name.as_deref(), Some("1234"));
        assert_eq!(metadata[0].version.as_deref(), Some("1.20"));
        let dependency = &metadata[0].dependencies.as_ref().unwrap()[0];
        assert_eq!(dependency.name.as_deref(), Some("5678"));
        assert_eq!(dependency.version.as_deref(), Some("2.00"));

        let installed =
            get_installed_mods_sync_with_catalog(mods_path.to_string_lossy().into_owned(), None);
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].name, "1234");
        assert_eq!(installed[0].version, "1.20");
        assert_eq!(installed[0].deps.len(), 1);
        assert_eq!(installed[0].deps[0].name, "5678");
        assert_eq!(installed[0].deps[0].version, "2.00");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scans_every_metadata_entry_in_one_mod_archive() {
        let root = test_dir("multi-metadata-mod");
        let mods_path = root.join("Mods");
        fs::create_dir_all(&mods_path).unwrap();
        write_zip(
            &mods_path.join("Bundle.zip"),
            &[(
                "everest.yaml",
                b"- Name: Bundle.Main\n  Version: 1.2.0\n  Dependencies:\n    - Name: MainDependency\n      Version: 2.0.0\n- Name: Bundle.Extra\n  Version: 3.4.0\n  OptionalDependencies:\n    - Name: ExtraDependency\n      Version: 1.0.0\n",
            )],
        );

        let installed =
            get_installed_mods_sync_with_catalog(mods_path.to_string_lossy().into_owned(), None);
        assert_eq!(installed.len(), 2);
        let main = installed
            .iter()
            .find(|item| item.name == "Bundle.Main")
            .unwrap();
        assert_eq!(main.file, "Bundle.zip");
        assert_eq!(main.version, "1.2.0");
        assert_eq!(main.deps.len(), 1);
        assert_eq!(main.deps[0].name, "MainDependency");
        assert!(!main.deps[0].optional);

        let extra = installed
            .iter()
            .find(|item| item.name == "Bundle.Extra")
            .unwrap();
        assert_eq!(extra.file, "Bundle.zip");
        assert_eq!(extra.version, "3.4.0");
        assert_eq!(extra.deps.len(), 1);
        assert_eq!(extra.deps[0].name, "ExtraDependency");
        assert!(extra.deps[0].optional);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replaces_affected_mod_archive_with_verified_fix_package() {
        let root = test_dir("crash-mod-fix");
        let game_path = root.join("game");
        let mods_path = game_path.join("Mods");
        fs::create_dir_all(&mods_path).unwrap();
        let installed = mods_path.join("RushHelper.zip");
        write_zip(
            &installed,
            &[(
                "everest.yaml",
                b"- Name: RushHelper\n  Version: 1.1.1\n  DLL: RushHelper.dll\n",
            )],
        );
        let package = root.join("RushHelper-fix.zip");
        write_zip(
            &package,
            &[(
                "everest.yaml",
                b"- Name: RushHelper\n  Version: 1.1.1+celemodfix.1\n  DLL: RushHelper.dll\n",
            )],
        );

        let replaced = replace_installed_mod_with_fix(
            &game_path,
            &package,
            "RushHelper",
            &["1.1.1".to_string()],
            "1.1.1+celemodfix.1",
        )
        .unwrap();
        assert_eq!(replaced, "RushHelper.zip");
        let metadata = parse_mod_yaml(&installed).unwrap();
        assert_eq!(metadata[0].version.as_deref(), Some("1.1.1+celemodfix.1"));
        assert!(!mods_path.join("RushHelper-fix.zip").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn identifies_platform_everest_archives() {
        #[cfg(target_os = "windows")]
        let installer = if std::env::consts::ARCH == "x86" {
            "main/MiniInstaller-win.exe"
        } else {
            "main/MiniInstaller-win64.exe"
        };
        #[cfg(target_os = "macos")]
        let installer = "main/MiniInstaller-osx";
        #[cfg(target_os = "linux")]
        let installer = "main/MiniInstaller-linux";

        let root = test_dir("drop-everest");
        let package = root.join("everest.zip");
        write_zip(&package, &[(installer, b"installer")]);

        assert!(matches!(
            classify_local_package(&package).unwrap(),
            LocalPackageKind::Everest
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_loenn_archives_and_rejects_unsafe_paths() {
        let root = test_dir("loenn-archive");
        let package = root.join("loenn.zip");
        let destination = root.join("install");
        write_zip(&package, &[("L\u{00f6}nn.exe", b"executable")]);

        extract_loenn_zip(&package, &destination, &mut |_| {}).unwrap();
        assert_eq!(
            fs::read(destination.join("L\u{00f6}nn.exe")).unwrap(),
            b"executable"
        );

        let unsafe_package = root.join("unsafe.zip");
        write_zip(&unsafe_package, &[("../outside.exe", b"unsafe")]);
        assert!(
            extract_loenn_zip(&unsafe_package, &destination, &mut |_| {}).is_err(),
            "path traversal entries must be rejected"
        );
        assert!(!root.join("outside.exe").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uses_a_custom_loenn_install_root() {
        let root = test_dir("custom-loenn-root");
        let root_string = root.to_string_lossy().into_owned();
        // New layout: the install lives directly under the chosen root (no `/current`).
        fs::write(root.join("Loenn.exe"), b"executable").unwrap();
        fs::write(
            root.join("celemod-loenn.json"),
            serde_json::to_vec(&LoennInstallMetadata {
                version: "test-version".to_string(),
                executable: "Loenn.exe".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        let state = get_loenn_state_impl(&root_string);
        assert!(state.installed);
        assert_eq!(state.version.as_deref(), Some("test-version"));
        assert_eq!(state.path.as_deref(), Some(root.to_string_lossy().as_ref()));
        assert!(loenn_root_dir("relative/path").is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_legacy_loenn_install_under_current() {
        let root = test_dir("legacy-loenn-root");
        let root_string = root.to_string_lossy().into_owned();
        let legacy = root.join("current");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("Loenn.exe"), b"executable").unwrap();
        fs::write(
            legacy.join("celemod-loenn.json"),
            serde_json::to_vec(&LoennInstallMetadata {
                version: "legacy-version".to_string(),
                executable: "Loenn.exe".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        let state = get_loenn_state_impl(&root_string);
        assert!(state.installed);
        assert_eq!(state.version.as_deref(), Some("legacy-version"));
        assert_eq!(
            state.path.as_deref(),
            Some(legacy.to_string_lossy().as_ref())
        );
        assert_eq!(
            managed_loenn_executable(&root).unwrap(),
            legacy.join("Loenn.exe")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adopts_an_existing_loenn_install_without_metadata() {
        let root = test_dir("adopted-loenn-root");
        let root_string = root.to_string_lossy().into_owned();

        #[cfg(target_os = "windows")]
        let expected = {
            fs::write(root.join("L\u{00f6}nn.exe"), b"executable").unwrap();
            root.join("L\u{00f6}nn.exe")
        };
        #[cfg(target_os = "linux")]
        let expected = {
            fs::write(root.join("Loenn.AppImage"), b"executable").unwrap();
            root.join("Loenn.AppImage")
        };
        #[cfg(target_os = "macos")]
        let expected = {
            let inner = root.join("L\u{00f6}nn.app").join("Contents/MacOS");
            fs::create_dir_all(&inner).unwrap();
            fs::write(inner.join("love"), b"executable").unwrap();
            inner.join("love")
        };

        assert_eq!(detect_loenn_executable(&root), Some(expected.clone()));
        let state = get_loenn_state_impl(&root_string);
        assert!(state.installed);
        assert_eq!(state.version, None);
        assert_eq!(state.path.as_deref(), Some(root.to_string_lossy().as_ref()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unrecognized_zip_archives() {
        let root = test_dir("drop-unknown");
        let package = root.join("unknown.zip");
        write_zip(&package, &[("readme.txt", b"not a package")]);

        assert!(classify_local_package(&package).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleans_stale_mod_download_sidecars() {
        let root = test_dir("download-cleanup");
        let mods = root.join("Mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("Example.zip.celemod"), b"partial").unwrap();
        fs::write(mods.join("Keep.zip"), b"installed").unwrap();
        fs::write(mods.join("Keep.celemod"), b"unrelated").unwrap();

        assert_eq!(cleanup_mod_download_temp_files_impl(&mods).unwrap(), 1);
        assert!(!mods.join("Example.zip.celemod").exists());
        assert!(mods.join("Keep.zip").exists());
        assert!(mods.join("Keep.celemod").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletes_mod_archives_and_directories() {
        let root = test_dir("delete-mod-files");
        let archive = root.join("Archive.zip");
        let directory = root.join("DirectoryMod");
        fs::write(&archive, b"archive").unwrap();
        fs::create_dir_all(directory.join("nested")).unwrap();
        fs::write(directory.join("nested").join("file.txt"), b"folder mod").unwrap();

        delete_mod_files_sync(
            root.to_str().unwrap(),
            &["Archive.zip".to_string(), "DirectoryMod".to_string()],
        )
        .unwrap();

        assert!(!archive.exists());
        assert!(!directory.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dependency_queue_deduplicates_all_task_states() {
        let root = test_dir("dependency-queue");
        let mut tasks = Vec::new();
        let mut queued = HashMap::new();
        let mod_data = HashMap::from([(
            "SharedDependency".to_string(),
            everest::ModInfoCached {
                name: "SharedDependency".to_string(),
                version: "1.0.0".to_string(),
                game_banana_id: 1,
                game_banana_file_id: 2,
                download_url: "https://example.invalid/dependency.zip".to_string(),
            },
        )]);
        let dependencies = vec![
            ("SharedDependency".to_string(), "1.0.0".to_string()),
            ("SharedDependency".to_string(), "1.0.0".to_string()),
        ];

        assert_eq!(
            enqueue_missing_dependencies(
                &mut tasks,
                &mut queued,
                dependencies.clone(),
                &[],
                &mod_data,
                root.to_string_lossy().as_ref(),
            ),
            1
        );
        assert_eq!(tasks.len(), 1);

        for status in [
            DownloadStatus::Waiting,
            DownloadStatus::Downloading,
            DownloadStatus::Finished,
            DownloadStatus::Failed,
        ] {
            tasks[0].status = status;
            assert_eq!(
                enqueue_missing_dependencies(
                    &mut tasks,
                    &mut queued,
                    dependencies.clone(),
                    &[],
                    &mod_data,
                    root.to_string_lossy().as_ref(),
                ),
                0
            );
            assert_eq!(tasks.len(), 1);
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enable_downloaded_mod_adds_it_to_active_profile() {
        let root = test_dir("download-default-enable-profile");
        let game_path = root.join("game");
        fs::create_dir_all(game_path.join("Mods")).unwrap();
        let game_path_string = game_path.to_string_lossy().into_owned();

        blacklist::new_mod_blacklist_profile(&game_path_string, "Default").unwrap();
        blacklist::apply_mod_blacklist_profiles(&game_path_string, &["Default".into()], &[])
            .unwrap();

        let package = root.join("New Mod.zip");
        write_zip(
            &package,
            &[("everest.yaml", b"- Name: NewMod\n  Version: 1.0.0\n")],
        );
        let installed = install_local_mod(&game_path, &package).unwrap();

        enable_installed_local_mods(
            &game_path_string,
            &[installed.clone()],
            true,
            "Default",
            &[],
        )
        .unwrap();

        let profiles = blacklist::get_mod_blacklist_profiles(&game_path_string);
        let default_profile = profiles
            .iter()
            .find(|profile| profile.name == "Default")
            .unwrap();
        assert!(
            default_profile
                .enabled_mods
                .iter()
                .any(|name| name == &installed.0),
            "downloaded Mod should be enabled in the active profile"
        );
        let blacklist = fs::read_to_string(game_path.join("Mods").join("blacklist.txt")).unwrap();
        assert!(
            !blacklist
                .lines()
                .any(|line| line.trim().eq_ignore_ascii_case(&installed.1)),
            "enabled Mod must not be blacklisted"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enabling_downloaded_mod_also_enables_installed_required_dependencies() {
        let root = test_dir("download-default-enable-dependencies");
        let game_path = root.join("game");
        fs::create_dir_all(game_path.join("Mods")).unwrap();
        let game_path_string = game_path.to_string_lossy().into_owned();

        blacklist::new_mod_blacklist_profile(&game_path_string, "Default").unwrap();
        blacklist::apply_mod_blacklist_profiles(&game_path_string, &["Default".into()], &[])
            .unwrap();

        let dependency_package = root.join("Dependency.zip");
        write_zip(
            &dependency_package,
            &[("everest.yaml", b"- Name: Dependency\n  Version: 1.0.0\n")],
        );
        install_local_mod(&game_path, &dependency_package).unwrap();

        let root_package = root.join("Root.zip");
        write_zip(
            &root_package,
            &[(
                "everest.yaml",
                b"- Name: Root\n  Version: 1.0.0\n  Dependencies:\n    - Name: Dependency\n      Version: 1.0.0\n",
            )],
        );
        install_local_mod(&game_path, &root_package).unwrap();

        let installed = get_installed_mods_sync(game_path.join("Mods").to_string_lossy().into());
        let enabled = collect_required_installed_mods(&["Root".to_string()], &installed);
        enable_installed_local_mods(&game_path_string, &enabled, true, "Default", &[]).unwrap();

        let profiles = blacklist::get_mod_blacklist_profiles(&game_path_string);
        let default_profile = profiles
            .iter()
            .find(|profile| profile.name == "Default")
            .unwrap();
        assert!(
            default_profile
                .enabled_mods
                .iter()
                .any(|name| name == "Root")
        );
        assert!(
            default_profile
                .enabled_mods
                .iter()
                .any(|name| name == "Dependency")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn disable_downloaded_mod_blacklists_it_in_profile_mode() {
        let root = test_dir("download-default-disable-profile");
        let game_path = root.join("game");
        fs::create_dir_all(game_path.join("Mods")).unwrap();
        let game_path_string = game_path.to_string_lossy().into_owned();

        blacklist::new_mod_blacklist_profile(&game_path_string, "Default").unwrap();
        blacklist::apply_mod_blacklist_profiles(&game_path_string, &["Default".into()], &[])
            .unwrap();

        let package = root.join("New Mod.zip");
        write_zip(
            &package,
            &[("everest.yaml", b"- Name: NewMod\n  Version: 1.0.0\n")],
        );
        let installed = install_local_mod(&game_path, &package).unwrap();

        disable_installed_local_mods(
            &game_path_string,
            &[installed.clone()],
            true,
            "Default",
            &[],
        )
        .unwrap();

        let blacklist = fs::read_to_string(game_path.join("Mods").join("blacklist.txt")).unwrap();
        assert!(
            blacklist
                .lines()
                .any(|line| line.trim().eq_ignore_ascii_case(&installed.1)),
            "disabled Mod must be blacklisted"
        );
        let profiles = blacklist::get_mod_blacklist_profiles(&game_path_string);
        let default_profile = profiles
            .iter()
            .find(|profile| profile.name == "Default")
            .unwrap();
        assert!(
            !default_profile
                .enabled_mods
                .iter()
                .any(|name| name == &installed.0),
            "disabled Mod must leave the active profile"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enable_downloaded_mod_removes_direct_blacklist_entry() {
        let root = test_dir("download-default-enable-direct");
        let game_path = root.join("game");
        fs::create_dir_all(game_path.join("Mods")).unwrap();
        let game_path_string = game_path.to_string_lossy().into_owned();

        let package = root.join("New Mod.zip");
        write_zip(
            &package,
            &[("everest.yaml", b"- Name: NewMod\n  Version: 1.0.0\n")],
        );
        let installed = install_local_mod(&game_path, &package).unwrap();
        fs::write(
            game_path.join("Mods").join("blacklist.txt"),
            format!("{}\n", installed.1),
        )
        .unwrap();

        enable_installed_local_mods(&game_path_string, &[installed.clone()], false, "", &[])
            .unwrap();

        let blacklist = fs::read_to_string(game_path.join("Mods").join("blacklist.txt")).unwrap();
        assert!(
            !blacklist
                .lines()
                .any(|line| line.trim().eq_ignore_ascii_case(&installed.1)),
            "enabled Mod must be removed from the direct blacklist"
        );

        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
fn cancel_download_mod(name: String) -> bool {
    if let Some(flag) = DOWNLOAD_CANCEL_FLAGS.lock().unwrap().get(&name) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

#[tauri::command]
fn cleanup_mod_download_temp_files(game_path: String) -> Result<usize, String> {
    cleanup_game_mod_download_temp_files(Path::new(&game_path))
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn get_celeste_dirs() -> String {
    if is_test_mode() {
        return get_test_game_path().to_string_lossy().to_string();
    }
    get_celestes()
        .iter()
        .filter_map(|game| game.path.as_ref())
        .map(|path| normalize_game_path_buf(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn start_game_directly_with_loader_impl(
    path: String,
    origin: bool,
    legacy_loader: bool,
) -> anyhow::Result<()> {
    let path = normalize_game_path_impl(&path);
    let path = Path::new(&path);

    #[cfg(windows)]
    let game = path.join("Celeste.exe");
    #[cfg(all(unix, not(target_os = "macos")))]
    let game = path.join("Celeste");
    #[cfg(target_os = "macos")]
    let game = {
        let direct = path.join("Celeste");
        if direct.exists() {
            direct
        } else if path.file_name().and_then(|name| name.to_str()) == Some("Resources") {
            path.parent().unwrap_or(path).join("MacOS").join("Celeste")
        } else {
            direct
        }
    };

    let game_origin = path.join("orig").join(
        game.file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("Celeste")),
    );
    let executable = if origin && game_origin.exists() {
        &game_origin
    } else {
        &game
    };
    let mut command = std::process::Command::new(executable);
    if origin && game_origin.exists() {
        command.arg("--vanilla");
    }
    if legacy_loader {
        // EverestUltra's accelerated loader can be disabled for one launch through
        // these environment switches, without changing the user's normal setup.
        command
            .env("EVEREST_PARALLEL_LOAD", "0")
            .env("EVEREST_ILHOOK_STARTUP_TRANSACTION", "0")
            .env("EVEREST_LOADER_PGO_REORDER", "0");
    }
    command.spawn()?;
    Ok(())
}

fn start_game_directly_impl(path: String, origin: bool) -> anyhow::Result<()> {
    start_game_directly_with_loader_impl(path, origin, false)
}

fn stop_celeste_for_restart(game_path: &Path) -> anyhow::Result<usize> {
    use sysinfo::{ProcessExt, System, SystemExt};

    fn comparable_path(path: &Path) -> String {
        let value = path.to_string_lossy().replace('/', "\\");
        #[cfg(target_os = "windows")]
        let value = value.strip_prefix(r"\\?\").unwrap_or(&value).to_lowercase();
        value.trim_end_matches('\\').to_string()
    }

    let game_directory = comparable_path(game_path);
    let mut system = System::new();
    system.refresh_processes();
    let mut stopped = 0;
    for process in system.processes().values() {
        let process_name = process.name().to_ascii_lowercase();
        if process_name != "celeste" && process_name != "celeste.exe" {
            continue;
        }
        let executable = process.exe();
        let executable_directory = executable.parent().map(comparable_path).unwrap_or_default();
        let matches_game = executable_directory == game_directory || {
            #[cfg(target_os = "macos")]
            {
                game_path.file_name().and_then(|name| name.to_str()) == Some("Resources")
                    && game_path
                        .parent()
                        .map(|contents| comparable_path(&contents.join("MacOS")))
                        .is_some_and(|directory| executable_directory == directory)
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        };
        if matches_game && process.kill() {
            stopped += 1;
        }
    }
    if stopped > 0 {
        std::thread::sleep(Duration::from_millis(450));
    }
    Ok(stopped)
}

fn restart_game_with_loader_impl(game_path: String, legacy_loader: bool) -> anyhow::Result<()> {
    let game_path = normalize_game_path_impl(&game_path);
    stop_celeste_for_restart(Path::new(&game_path))?;
    start_game_directly_with_loader_impl(game_path, false, legacy_loader)
}

#[derive(Deserialize, Serialize)]
struct LoennInstallMetadata {
    version: String,
    executable: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoennState {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
}

fn default_loenn_root_dir() -> anyhow::Result<PathBuf> {
    let data_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .context("Failed to find the local application data directory")?;
    Ok(data_dir.join("CeleMod").join("Loenn"))
}

fn loenn_root_dir(install_root: &str) -> anyhow::Result<PathBuf> {
    let install_root = install_root.trim();
    if install_root.is_empty() {
        return default_loenn_root_dir();
    }
    let path = PathBuf::from(install_root);
    if !path.is_absolute() {
        bail!("Loenn installation path must be absolute");
    }
    if path.is_file() {
        bail!(
            "Loenn installation path points to a file: {}",
            path.display()
        );
    }
    Ok(path)
}

const LOENN_METADATA_FILE: &str = "celemod-loenn.json";

fn read_loenn_metadata_at(install_dir: &Path) -> anyhow::Result<LoennInstallMetadata> {
    let metadata_path = install_dir.join(LOENN_METADATA_FILE);
    let metadata = std::fs::read_to_string(&metadata_path)
        .with_context(|| format!("Failed to read {}", metadata_path.display()))?;
    serde_json::from_str(&metadata).context("Invalid Loenn installation metadata")
}

fn safe_relative_path(value: &str) -> anyhow::Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        bail!("Invalid relative path: {value}");
    }
    Ok(path.to_path_buf())
}

/// Resolves the executable of a CeleMod-managed Lönn install. The current layout
/// keeps everything directly under `root`; older CeleMod builds nested it under
/// `root/current`, so fall back to that for forward compatibility.
fn managed_loenn_executable(root: &Path) -> Option<PathBuf> {
    let legacy = root.join("current");
    for install_dir in [root, legacy.as_path()] {
        if let Ok(metadata) = read_loenn_metadata_at(install_dir) {
            if let Ok(relative) = safe_relative_path(&metadata.executable) {
                let executable = install_dir.join(relative);
                if executable.is_file() {
                    return Some(executable);
                }
            }
        }
    }
    None
}

/// Best-effort detection of an existing Lönn install CeleMod did not create (no
/// `celemod-loenn.json`), so the user can adopt a folder they already have.
fn detect_loenn_executable(dir: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        for name in ["L\u{00f6}nn.exe", "Lonn.exe"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_appimage = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(".AppImage"));
                if path.is_file() && is_appimage {
                    return Some(path);
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let candidate = dir.join("L\u{00f6}nn.app").join("Contents/MacOS/love");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn get_loenn_state_impl(install_root: &str) -> LoennState {
    let Ok(root) = loenn_root_dir(install_root) else {
        return LoennState {
            installed: false,
            version: None,
            path: None,
        };
    };

    let legacy = root.join("current");
    for install_dir in [root.as_path(), legacy.as_path()] {
        if let Ok(metadata) = read_loenn_metadata_at(install_dir) {
            let executable = safe_relative_path(&metadata.executable)
                .ok()
                .map(|relative| install_dir.join(relative));
            return LoennState {
                installed: executable.as_ref().is_some_and(|path| path.is_file()),
                version: Some(metadata.version),
                path: Some(install_dir.to_string_lossy().into_owned()),
            };
        }
    }

    // Adopt an existing install: recognizable executable, no CeleMod metadata.
    if detect_loenn_executable(&root).is_some() {
        return LoennState {
            installed: true,
            version: None,
            path: Some(root.to_string_lossy().into_owned()),
        };
    }

    LoennState {
        installed: false,
        version: None,
        path: Some(root.to_string_lossy().into_owned()),
    }
}

fn verify_file_sha256(path: &Path, expected: &str) -> anyhow::Result<()> {
    if expected.trim().is_empty() {
        return Ok(());
    }
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected.trim()) {
        bail!("SHA-256 mismatch: expected {expected}, got {actual}");
    }
    Ok(())
}

fn extract_loenn_zip(
    archive_path: &Path,
    destination: &Path,
    on_progress: &mut dyn FnMut(f32),
) -> anyhow::Result<()> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(archive_path)?)?;
    let count = archive.len().max(1);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let relative_path = entry
            .enclosed_name()
            .context("Loenn package contains an unsafe path")?
            .to_path_buf();
        let output_path = destination.join(relative_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&output_path)?;
        } else {
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut output = std::fs::File::create(&output_path)?;
            std::io::copy(&mut entry, &mut output)?;
            output.flush()?;
        }
        on_progress(((index + 1) as f32 / count as f32) * 100.0);
    }
    Ok(())
}

fn install_loenn(
    install_root: &str,
    version: &str,
    url: &str,
    package_type: &str,
    file_name: &str,
    executable: &str,
    sha256: &str,
    progress_callback: &mut dyn FnMut(String, f32),
) -> anyhow::Result<()> {
    let root = loenn_root_dir(install_root)?;
    let parent = root
        .parent()
        .context("Loenn install path must be inside a directory")?;
    std::fs::create_dir_all(parent)?;

    // Stage the download and extraction in a workspace beside `root` so the final
    // swap (rename) stays on the same filesystem; cross-volume renames are not atomic.
    let unique = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let workspace = parent.join(format!(".celemod-loenn-{unique}"));
    let download_path = workspace.join("loenn.download");
    let staging_dir = workspace.join("installing");
    std::fs::create_dir_all(&staging_dir)?;

    let cancel_flag = Arc::new(AtomicBool::new(false));
    ureq::download_file_with_progress(
        url,
        download_path.to_string_lossy().as_ref(),
        &mut |callback| {
            progress_callback("download".to_string(), callback.progress);
        },
        false,
        &cancel_flag,
    )?;
    progress_callback("verify".to_string(), 0.0);
    verify_file_sha256(&download_path, sha256)?;
    progress_callback("verify".to_string(), 100.0);

    match package_type {
        "zip" => extract_loenn_zip(&download_path, &staging_dir, &mut |progress| {
            progress_callback("extract".to_string(), progress);
        })?,
        "file" => {
            let relative_file = safe_relative_path(file_name)?;
            let destination = staging_dir.join(relative_file);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::rename(&download_path, &destination)?;
            progress_callback("extract".to_string(), 100.0);
        }
        value => bail!("Unsupported Loenn package type: {value}"),
    }

    let executable_relative = safe_relative_path(executable)?;
    let staged_executable = staging_dir.join(&executable_relative);
    if !staged_executable.is_file() {
        bail!(
            "Loenn executable was not found after extraction: {}",
            staged_executable.display()
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&staged_executable)?.permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        std::fs::set_permissions(&staged_executable, permissions)?;
    }

    let metadata = LoennInstallMetadata {
        version: version.to_string(),
        executable: executable.to_string(),
    };
    std::fs::write(
        staging_dir.join(LOENN_METADATA_FILE),
        serde_json::to_vec_pretty(&metadata)?,
    )?;

    if root.exists() {
        let backup = parent.join(format!(".celemod-loenn-backup-{unique}"));
        std::fs::rename(&root, &backup)
            .context("Failed to move the existing Loenn install aside")?;
        if let Err(error) = std::fs::rename(&staging_dir, &root) {
            let _ = std::fs::rename(&backup, &root);
            return Err(error).context("Failed to move the staged Loenn install into place");
        }
        let _ = std::fs::remove_dir_all(&backup);
    } else {
        std::fs::rename(&staging_dir, &root)
            .context("Failed to move the staged Loenn install into place")?;
    }
    let _ = std::fs::remove_dir_all(&workspace);
    progress_callback("install".to_string(), 100.0);
    Ok(())
}

#[tauri::command]
fn runtime_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
fn get_loenn_state(install_root: String) -> LoennState {
    get_loenn_state_impl(&install_root)
}

#[tauri::command]
fn download_and_install_loenn(
    install_root: String,
    version: String,
    url: String,
    package_type: String,
    file_name: String,
    executable: String,
    sha256: String,
    on_event: Channel<IpcEvent>,
) {
    std::thread::spawn(move || {
        if is_test_mode() {
            send_event(
                &on_event,
                vec![serde_json::json!("success"), serde_json::json!(100.0)],
            );
            return;
        }
        let result = install_loenn(
            &install_root,
            &version,
            &url,
            &package_type,
            &file_name,
            &executable,
            &sha256,
            &mut |state, progress| {
                send_event(
                    &on_event,
                    vec![serde_json::json!(state), serde_json::json!(progress)],
                );
            },
        );
        match result {
            Ok(()) => send_event(
                &on_event,
                vec![serde_json::json!("success"), serde_json::json!(100.0)],
            ),
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!(format!("{error:#}")),
                ],
            ),
        }
    });
}

#[tauri::command]
fn start_loenn(install_root: String) -> Result<(), String> {
    let root = loenn_root_dir(&install_root).map_err(|error| format!("{error:#}"))?;
    let executable = managed_loenn_executable(&root)
        .or_else(|| detect_loenn_executable(&root))
        .ok_or_else(|| format!("No Lönn executable found in {}", root.display()))?;
    let working_dir = executable.parent().unwrap_or(&root);
    std::process::Command::new(&executable)
        .current_dir(working_dir)
        .spawn()
        .map_err(|error| format!("Failed to start {}: {error}", executable.display()))?;
    Ok(())
}

#[tauri::command]
fn start_game(path: String) -> Result<(), String> {
    let path = normalize_game_path_impl(&path);
    let celestes = get_celestes();
    if let Some(game) = celestes.iter().find(|game| {
        game.path
            .as_ref()
            .map(|game_path| normalize_game_path_buf(game_path).to_string_lossy() == path)
            .unwrap_or(false)
    }) {
        game_scanner::manager::launch_game(game).map_err(|error| error.to_string())
    } else {
        start_game_directly_impl(path, false).map_err(|error| format!("{error:#}"))
    }
}

#[tauri::command]
fn start_game_directly(path: String, origin: bool) -> Result<(), String> {
    start_game_directly_impl(path, origin).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
async fn check_everest_crash(
    game_path: String,
) -> Result<Option<crash_analysis::CrashAnalysis>, String> {
    let game_path = normalize_game_path_impl(&game_path);
    tauri::async_runtime::spawn_blocking(move || crash_analysis::analyze_latest_crash(&game_path))
        .await
        .map_err(|error| format!("Crash analysis worker failed: {error}"))?
        .map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn stop_game_for_restart(game_path: String) -> Result<usize, String> {
    let game_path = normalize_game_path_impl(&game_path);
    stop_celeste_for_restart(Path::new(&game_path)).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn restart_game_with_loader(game_path: String, legacy_loader: bool) -> Result<(), String> {
    restart_game_with_loader_impl(game_path, legacy_loader).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn reveal_crash_report(path: String) -> Result<(), String> {
    crash_analysis::reveal_report(&path).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn verify_celeste_install(path: String) -> bool {
    if is_test_mode() && path == get_test_game_path().to_string_lossy() {
        return true;
    }
    let path = normalize_game_path_impl(&path);
    let path = Path::new(&path);
    if ["Celeste.exe", "Celeste", "Celeste.dll"]
        .iter()
        .any(|file| path.join(file).exists())
    {
        return true;
    }
    #[cfg(target_os = "macos")]
    if path.file_name().and_then(|name| name.to_str()) == Some("Resources")
        && path
            .parent()
            .map(|contents| contents.join("MacOS").join("Celeste").exists())
            .unwrap_or(false)
    {
        return true;
    }
    false
}

#[tauri::command]
fn normalize_game_path(path: String) -> String {
    normalize_game_path_impl(&path)
}

#[tauri::command]
fn celemod_version() -> String {
    env!("VERSION").to_string()
}

#[tauri::command]
fn celemod_hash() -> String {
    env!("GIT_HASH").to_string()
}

#[tauri::command]
fn enable_window_controls(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_window_controls::WindowControlsExt;

        window
            .set_title_bar_height(45)
            .map_err(|error| error.to_string())?;
        window
            .set_title_bar_overlay(true)
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = window;

    Ok(())
}

#[tauri::command]
fn is_using_cache() -> bool {
    everest::is_using_cache()
}

#[tauri::command]
fn configure_mod_cache(ttl_seconds: u64) {
    everest::set_mod_cache_ttl(ttl_seconds);
}

#[tauri::command]
fn get_mod_catalog(force_refresh: bool) -> Result<String, String> {
    everest::get_mod_catalog_json(force_refresh).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn get_mod_cache_status() -> Result<everest::ModCacheStatus, String> {
    everest::get_mod_catalog_status().map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn show_log_window() {
    #[cfg(windows)]
    unsafe {
        use winapi::um::winuser::{IsWindowVisible, SW_HIDE, SW_SHOW, ShowWindow};

        let console = winapi::um::wincon::GetConsoleWindow();
        if console.is_null() {
            return;
        }
        let command = if IsWindowVisible(console) == 0 {
            SW_SHOW
        } else {
            SW_HIDE
        };
        ShowWindow(console, command);
    }
}

#[cfg(all(windows, not(debug_assertions)))]
fn initialize_windows_console() {
    unsafe {
        use winapi::um::{
            consoleapi::AllocConsole,
            winuser::{SW_HIDE, ShowWindow},
        };

        if AllocConsole() != 0 {
            ShowWindow(winapi::um::wincon::GetConsoleWindow(), SW_HIDE);
        }
    }
}

#[tauri::command]
fn get_database_path() -> String {
    let Some(home_dir) = dirs::home_dir() else {
        return "./cele-mod.db".to_string();
    };
    let celemod_dir = home_dir.join(".celemod");
    let new_path = celemod_dir.join("cele-mod.db");
    let old_cwd_path = Path::new("./cele-mod.db").to_path_buf();
    let old_parent_path = Path::new("../../cele-mod.db").to_path_buf();
    let _ = fs::create_dir_all(&celemod_dir);
    let old_db_path = if old_parent_path.exists() {
        Some(old_parent_path)
    } else if old_cwd_path.exists() {
        Some(old_cwd_path)
    } else {
        None
    };
    if let Some(old_path) = old_db_path
        && !new_path.exists()
        && fs::copy(&old_path, &new_path).is_ok()
    {
        let _ = fs::remove_file(old_path);
    }
    new_path.to_string_lossy().to_string()
}

#[tauri::command]
fn get_installed_mod_ids(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let ids = get_installed_mods_sync(mods_folder_path)
            .into_iter()
            .map(|item| item.game_banana_id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        send_event(&on_event, vec![serde_json::json!(ids)]);
    });
}

#[tauri::command]
fn get_installed_miaonet(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let installed = get_installed_mods_sync(mods_folder_path)
            .into_iter()
            .any(|item| item.name == "MiaoNet");
        send_event(&on_event, vec![serde_json::json!(installed)]);
    });
}

#[tauri::command]
fn get_installed_mods(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let installed = get_installed_mods_sync(mods_folder_path);
        let payload = serde_json::to_string(&installed).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn get_invalid_zip_mod_files(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let invalid = get_invalid_zip_mod_files_sync(&mods_folder_path);
        let payload = serde_json::to_string(&invalid).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn check_all_mod_contents(mods_folder_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        check_all_mod_contents_sync(&mods_folder_path, &mut |progress| {
            if let Ok(payload) = serde_json::to_string(&progress) {
                send_event(&on_event, vec![serde_json::json!(payload)]);
            }
        });
    });
}

#[tauri::command]
fn get_blacklist_profiles(game_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let profiles = blacklist::get_mod_blacklist_profiles(&game_path);
        let payload = serde_json::to_string(&profiles).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn get_blacklist_profile_count(game_path: String) -> usize {
    let game_path = normalize_game_path_impl(&game_path);
    blacklist::get_blacklist_profile_count(&game_path)
}

#[tauri::command]
fn get_direct_blacklist_profile(game_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let profile = blacklist::get_direct_blacklist_profile(&game_path);
        let payload = profile
            .and_then(|profile| serde_json::to_string(&profile).map_err(Into::into))
            .unwrap_or_default();
        send_event(&on_event, vec![serde_json::json!(payload)]);
    });
}

#[tauri::command]
fn switch_direct_blacklist(game_path: String, mod_files: String, enabled: bool) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let mod_files: Vec<String> = match serde_json::from_str(&mod_files) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse Mod files: {error}"),
    };
    match blacklist::switch_direct_blacklist(&game_path, &mod_files, enabled) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to update blacklist.txt: {error}"),
    }
}

#[tauri::command]
fn update_blacklist_mod_file(
    game_path: String,
    mod_name: String,
    old_file: String,
    new_file: String,
    profile_enabled: bool,
    always_on_mods: String,
) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let always_on_mods: Vec<String> = match serde_json::from_str(&always_on_mods) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse always-on Mods: {error}"),
    };
    match blacklist::update_blacklist_mod_file(
        &game_path,
        &mod_name,
        &old_file,
        &new_file,
        profile_enabled,
        &always_on_mods,
    ) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to update blacklist Mod file: {error}"),
    }
}

#[tauri::command]
fn apply_mod_profiles(game_path: String, profile_names: String, always_on_mods: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let profile_names: Vec<String> = match serde_json::from_str(&profile_names) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse profile names: {error}"),
    };
    let always_on_mods: Vec<String> = match serde_json::from_str(&always_on_mods) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse always-on Mods: {error}"),
    };
    match blacklist::apply_mod_blacklist_profiles(&game_path, &profile_names, &always_on_mods) {
        Ok(_) => "Success".to_string(),
        Err(error) => format!("Failed to apply profiles: {error}"),
    }
}

#[tauri::command]
fn get_active_profile_mods(game_path: String, always_on_mods: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let always_on_mods: Vec<String> = match serde_json::from_str(&always_on_mods) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse always-on Mods: {error}"),
    };
    serde_json::to_string(&blacklist::get_active_profile_mods(
        &game_path,
        &always_on_mods,
    ))
    .unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
fn switch_mod_profile_mods(
    game_path: String,
    profile_name: String,
    mod_names: String,
    enabled: bool,
) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let mod_names: Vec<String> = match serde_json::from_str(&mod_names) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse Mod names: {error}"),
    };
    match blacklist::switch_mod_profile_mods(&game_path, &profile_name, &mod_names, enabled) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to update profile: {error}"),
    }
}

#[tauri::command]
fn get_current_profiles(game_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    serde_json::to_string(&blacklist::get_current_profiles(&game_path))
        .unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
fn get_olympus_presets(game_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::get_olympus_presets(&game_path) {
        Ok(profiles) => serde_json::to_string(&profiles).unwrap_or_else(|_| "[]".to_string()),
        Err(_) => "[]".to_string(),
    }
}

#[tauri::command]
fn preview_olympus_profiles(game_path: String, profile_names: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let profile_names: Vec<String> = match serde_json::from_str(&profile_names) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse Olympus profile names: {error}"),
    };
    match blacklist::preview_olympus_profiles(&game_path, &profile_names) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        Err(error) => format!("Failed to preview Olympus presets: {error}"),
    }
}

#[tauri::command]
fn preview_mod_profiles_json(game_path: String, contents: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::preview_mod_profiles_json(&game_path, &contents) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        Err(error) => format!("Failed to preview profiles: {error}"),
    }
}

#[tauri::command]
fn preview_mod_profiles(game_path: String, source_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::preview_mod_profiles(&game_path, &source_path) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        Err(error) => format!("Failed to preview profiles: {error}"),
    }
}

#[tauri::command]
fn commit_mod_profiles(game_path: String, profiles: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let profiles = match serde_json::from_str::<Vec<blacklist::ModBlacklistProfile>>(&profiles) {
        Ok(value) => value,
        Err(error) => return format!("Failed to parse profiles: {error}"),
    };
    match blacklist::commit_profile_import(&game_path, profiles) {
        Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
        Err(error) => format!("Failed to import profiles: {error}"),
    }
}

#[tauri::command]
fn export_mod_profile(
    game_path: String,
    profile_name: String,
    destination: String,
    enabled_mods: Option<String>,
    auto_deps: bool,
) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    let enabled_mods = match enabled_mods {
        Some(value) => match serde_json::from_str::<Vec<String>>(&value) {
            Ok(value) => Some(value),
            Err(error) => return format!("Failed to parse exported Mod names: {error}"),
        },
        None => None,
    };
    match blacklist::export_mod_profile(
        &game_path,
        &profile_name,
        &destination,
        enabled_mods,
        auto_deps,
    ) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to export profile: {error}"),
    }
}

#[tauri::command]
fn expand_mod_profile_dependencies(game_path: String, profile_name: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::expand_mod_profile_dependencies(&game_path, &profile_name) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to expand profile dependencies: {error}"),
    }
}

#[tauri::command]
fn new_mod_blacklist_profile(game_path: String, profile_name: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::new_mod_blacklist_profile(&game_path, &profile_name) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to create blacklist profile: {error}"),
    }
}

#[tauri::command]
fn get_current_profile(game_path: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    blacklist::get_current_profile(&game_path)
        .unwrap_or_else(|error| format!("Failed to get current profile: {error}"))
}

#[tauri::command]
fn remove_mod_blacklist_profile(game_path: String, profile_name: String) -> String {
    let game_path = normalize_game_path_impl(&game_path);
    match blacklist::remove_mod_blacklist_profile(&game_path, &profile_name) {
        Ok(()) => "Success".to_string(),
        Err(error) => format!("Failed to remove profile: {error}"),
    }
}

#[tauri::command]
fn get_mod_update(name: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let data = get_mod_cached_new()
            .ok()
            .and_then(|mods| {
                mods.get(&name).map(|item| {
                    (
                        item.game_banana_file_id.to_string(),
                        item.version.clone(),
                        item.download_url.clone(),
                    )
                })
            })
            .and_then(|value| serde_json::to_string(&value).ok())
            .unwrap_or_default();
        send_event(&on_event, vec![serde_json::json!(data)]);
    });
}

#[tauri::command]
fn get_mod_latest_info(on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let values: Vec<(String, String, String, String)> = get_mod_cached_new()
            .map(|mods| {
                mods.iter()
                    .map(|(name, item)| {
                        (
                            name.clone(),
                            item.version.clone(),
                            item.game_banana_file_id.to_string(),
                            item.download_url.clone(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        let data = serde_json::to_string(&values).unwrap_or_else(|_| "[]".to_string());
        send_event(&on_event, vec![serde_json::json!(data)]);
    });
}

#[tauri::command]
fn rm_mod(mods_folder_path: String, mod_name: String) -> Result<(), String> {
    rm_mod_sync(&mods_folder_path, &mod_name).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
fn delete_mods(game_path: String, mod_names: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let mods_folder_path = Path::new(&game_path)
            .join("Mods")
            .to_string_lossy()
            .to_string();
        let names: Vec<String> = serde_json::from_str(&mod_names).unwrap_or_default();
        let failed = names
            .iter()
            .filter_map(|name| {
                rm_mod_sync(&mods_folder_path, name)
                    .err()
                    .map(|error| format!("{name}: {error}"))
            })
            .collect::<Vec<_>>();
        let result = if failed.is_empty() {
            "Success".to_string()
        } else {
            format!("Failed to remove some Mods: {}", failed.join(", "))
        };
        send_event(&on_event, vec![serde_json::json!(result)]);
    });
}

#[tauri::command]
fn delete_mod_files(mods_folder_path: String, file_names: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let names: Vec<String> = serde_json::from_str(&file_names).unwrap_or_default();
        let result = delete_mod_files_sync(&mods_folder_path, &names)
            .map(|_| "Success".to_string())
            .unwrap_or_else(|error| format!("Failed to remove some files: {error}"));
        send_event(&on_event, vec![serde_json::json!(result)]);
    });
}

#[tauri::command]
fn get_everest_version(game_path: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let game_path = normalize_game_path_impl(&game_path);
        let (version, is_ultra) = if is_test_mode() {
            ("4000".to_string(), false)
        } else {
            (
                everest::get_everest_version(&game_path)
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                everest::is_everest_ultra(Path::new(&game_path)),
            )
        };
        send_event(
            &on_event,
            vec![serde_json::json!(version), serde_json::json!(is_ultra)],
        );
    });
}

fn new_keyboard_input_enabled(content: &str) -> bool {
    content.lines().any(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return false;
        }
        line.split_once('=').is_some_and(|(key, value)| {
            key.trim() == "EVEREST_NEW_KEYBOARD_INPUT" && value.trim() == "1"
        })
    })
}

fn without_new_keyboard_input_enabled(content: &str) -> String {
    let lines = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            trimmed.starts_with('#')
                || !trimmed
                    .split_once('=')
                    .is_some_and(|(key, _)| key.trim() == "EVEREST_NEW_KEYBOARD_INPUT")
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

#[tauri::command]
fn has_new_keyboard_input_enabled(game_path: String) -> bool {
    let game_path = normalize_game_path_impl(&game_path);
    fs::read_to_string(Path::new(&game_path).join("everest-env.txt"))
        .is_ok_and(|content| new_keyboard_input_enabled(&content))
}

#[tauri::command]
fn remove_new_keyboard_input(game_path: String) -> Result<(), String> {
    let game_path = normalize_game_path_impl(&game_path);
    let path = Path::new(&game_path).join("everest-env.txt");
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    fs::write(path, without_new_keyboard_input_enabled(&content)).map_err(|error| error.to_string())
}

#[tauri::command]
fn download_and_install_everest(game_path: String, url: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        if is_test_mode() {
            send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(100.0)],
            );
            return;
        }
        let game_path = normalize_game_path_impl(&game_path);
        let result =
            everest::download_and_install_everest(&game_path, &url, &mut |message, progress| {
                send_event(
                    &on_event,
                    vec![serde_json::json!(message), serde_json::json!(progress)],
                );
            });
        match result {
            Ok(()) => send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(100.0)],
            ),
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("Failed"),
                    serde_json::json!(error.to_string()),
                ],
            ),
        }
    });
}

#[tauri::command]
fn download_and_install_crash_mod_fix(
    game_path: String,
    mod_name: String,
    affected_versions: String,
    fixed_version: String,
    url: String,
    sha256: String,
    on_event: Channel<IpcEvent>,
) {
    std::thread::spawn(move || {
        if is_test_mode() {
            send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(100.0)],
            );
            return;
        }
        let game_path = normalize_game_path_impl(&game_path);
        let affected_versions =
            serde_json::from_str::<Vec<String>>(&affected_versions).unwrap_or_default();
        let result = download_and_install_crash_mod_fix_impl(
            Path::new(&game_path),
            &mod_name,
            &affected_versions,
            &fixed_version,
            &url,
            &sha256,
            &mut |state, progress| {
                send_event(
                    &on_event,
                    vec![serde_json::json!(state), serde_json::json!(progress)],
                );
            },
        );
        match result {
            Ok(file) => send_event(
                &on_event,
                vec![serde_json::json!("Success"), serde_json::json!(file)],
            ),
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("Failed"),
                    serde_json::json!(format!("{error:#}")),
                ],
            ),
        }
    });
}

#[tauri::command]
fn install_local_packages(
    game_path: String,
    package_paths: String,
    auto_disable_new_mods: bool,
    profile_enabled: bool,
    current_profile_name: String,
    always_on_mods: String,
    on_event: Channel<IpcEvent>,
) {
    std::thread::spawn(move || {
        let always_on_mods: Vec<String> = serde_json::from_str(&always_on_mods).unwrap_or_default();
        let paths: Vec<String> = match serde_json::from_str(&package_paths) {
            Ok(paths) => paths,
            Err(error) => {
                send_event(
                    &on_event,
                    vec![
                        serde_json::json!("failed"),
                        serde_json::json!(format!("Invalid package list: {error}")),
                    ],
                );
                return;
            }
        };
        if paths.is_empty() {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!("No packages were dropped"),
                ],
            );
            return;
        }
        let game_path = normalize_game_path_impl(&game_path);
        let normalized_game_path = Path::new(&game_path);
        if !normalized_game_path.is_dir() {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!("The selected Celeste folder does not exist"),
                ],
            );
            return;
        }
        if !is_test_mode() && is_celeste_running(normalized_game_path) {
            send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!(
                        "Celeste is currently running. Exit the game before installing packages."
                    ),
                ],
            );
            return;
        }
        let total = paths.len();
        let mut results = Vec::with_capacity(total);
        let mut installed_mods = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            let package_path = Path::new(path);
            let file_name = package_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let current = index + 1;
            let progress = LocalPackageInstallProgress {
                current,
                total,
                file: file_name.clone(),
                detail: "Inspecting package".to_string(),
                progress: 0.0,
            };
            send_event(
                &on_event,
                vec![
                    serde_json::json!("progress"),
                    serde_json::json!(serde_json::to_string(&progress).unwrap()),
                ],
            );
            let kind = classify_local_package(package_path);
            let package_type = kind
                .as_ref()
                .map(|kind| kind.as_str())
                .unwrap_or("unknown")
                .to_string();
            let install_result = match kind {
                Ok(LocalPackageKind::Mod) => install_local_mod(normalized_game_path, package_path)
                    .map(|installed| installed_mods.push(installed)),
                Ok(LocalPackageKind::Everest) if is_test_mode() => Ok(()),
                Ok(LocalPackageKind::Everest) => everest::install_everest_archive(
                    &game_path,
                    package_path,
                    &mut |detail, value| {
                        let progress = LocalPackageInstallProgress {
                            current,
                            total,
                            file: file_name.clone(),
                            detail,
                            progress: value,
                        };
                        send_event(
                            &on_event,
                            vec![
                                serde_json::json!("progress"),
                                serde_json::json!(serde_json::to_string(&progress).unwrap()),
                            ],
                        );
                    },
                ),
                Err(error) => Err(error),
            };
            results.push(match install_result {
                Ok(()) => LocalPackageInstallResult {
                    file: file_name,
                    package_type,
                    success: true,
                    error: String::new(),
                },
                Err(error) => LocalPackageInstallResult {
                    file: file_name,
                    package_type,
                    success: false,
                    error: format!("{error:#}"),
                },
            });
        }
        if auto_disable_new_mods {
            if let Err(error) = disable_installed_local_mods(
                &game_path,
                &installed_mods,
                profile_enabled,
                &current_profile_name,
                &always_on_mods,
            ) {
                eprintln!("Failed to auto-disable dropped Mods: {error:#}");
            }
        }
        send_event(
            &on_event,
            vec![
                serde_json::json!("finished"),
                serde_json::json!(serde_json::to_string(&results).unwrap()),
            ],
        );
    });
}

#[tauri::command]
fn download_mod(
    name: String,
    url: String,
    mods_dir: String,
    download_type_defaults: String,
    profile_enabled: bool,
    current_profile_name: String,
    always_on_mods: String,
    on_event: Channel<IpcEvent>,
    use_cn_proxy: bool,
    multi_thread: bool,
) {
    let _ = use_cn_proxy;
    std::thread::spawn(move || {
        let always_on_mods: Vec<String> = serde_json::from_str(&always_on_mods).unwrap_or_default();
        let download_type_defaults =
            serde_json::from_str::<HashMap<String, bool>>(&download_type_defaults)
                .unwrap_or_default();
        let default_enabled = download_type_defaults
            .get("__default")
            .copied()
            .unwrap_or(true);
        if let Err(error) = fs::create_dir_all(&mods_dir) {
            send_event(
                &on_event,
                vec![serde_json::json!(format!(
                    "Failed to create Mods directory: {error}"
                ))],
            );
            return;
        }
        let cancel_flag = Arc::new(AtomicBool::new(false));
        DOWNLOAD_CANCEL_FLAGS
            .lock()
            .unwrap()
            .insert(name.clone(), Arc::clone(&cancel_flag));
        let mod_data = match get_mod_cached_new() {
            Ok(data) => data,
            Err(error) => {
                send_event(
                    &on_event,
                    vec![serde_json::json!(format!(
                        "Failed to get Mod data: {error}"
                    ))],
                );
                DOWNLOAD_CANCEL_FLAGS.lock().unwrap().remove(&name);
                return;
            }
        };
        let mut tasks = vec![DownloadInfo {
            name: name.clone(),
            url,
            dest: Path::new(&mods_dir)
                .join(format!("{}.zip", make_path_compatible_name(&name)))
                .to_string_lossy()
                .to_string(),
            status: DownloadStatus::Waiting,
            data: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0.0,
        }];
        let installed = get_installed_mods_sync(mods_dir.clone());
        let failed = download_mod_queue(
            &mut tasks,
            &installed,
            &mod_data,
            &mods_dir,
            &on_event,
            multi_thread,
            &cancel_flag,
        );
        if !failed {
            let game_path = Path::new(&mods_dir)
                .parent()
                .unwrap_or(Path::new(&mods_dir))
                .to_string_lossy()
                .to_string();
            let installed = get_installed_mods_sync(mods_dir.clone());
            let mut to_disable = Vec::new();
            let mut to_enable = Vec::new();
            for task in tasks
                .iter()
                .filter(|task| task.status == DownloadStatus::Finished)
            {
                let enabled = everest::get_mod_category(&task.name)
                    .and_then(|category| download_type_defaults.get(&category).copied())
                    .unwrap_or(default_enabled);
                let Some(item) = installed.iter().find(|item| item.name == task.name) else {
                    continue;
                };
                let entry = (item.name.clone(), item.file.clone());
                if enabled {
                    to_enable.push(entry);
                } else {
                    to_disable.push(entry);
                }
            }
            if let Err(error) = disable_installed_local_mods(
                &game_path,
                &to_disable,
                profile_enabled,
                &current_profile_name,
                &always_on_mods,
            ) {
                eprintln!("Failed to apply downloaded Mod defaults: {error:#}");
            }
            let enabled_with_dependencies = collect_required_installed_mods(
                &to_enable
                    .iter()
                    .map(|(name, _)| name.clone())
                    .collect::<Vec<_>>(),
                &installed,
            );
            if let Err(error) = enable_installed_local_mods(
                &game_path,
                &enabled_with_dependencies,
                profile_enabled,
                &current_profile_name,
                &always_on_mods,
            ) {
                eprintln!("Failed to enable downloaded Mods: {error:#}");
            }
        }
        emit_download_tasks(
            &tasks,
            &on_event,
            if failed { "failed" } else { "finished" },
        );
        DOWNLOAD_CANCEL_FLAGS.lock().unwrap().remove(&name);
    });
}

#[tauri::command]
fn do_self_update(url: String, on_event: Channel<IpcEvent>) {
    std::thread::spawn(move || {
        let tmp = std::env::temp_dir().join(if cfg!(windows) {
            "cele-mod.exe"
        } else {
            "cele-mod"
        });
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let result = ureq::download_file_with_progress(
            &url,
            tmp.to_string_lossy().as_ref(),
            &mut |progress| {
                send_event(
                    &on_event,
                    vec![
                        serde_json::json!("downloading"),
                        serde_json::json!(progress.progress),
                    ],
                )
            },
            false,
            &cancel_flag,
        );
        match result {
            Ok(()) => {
                let current_exe = match std::env::current_exe() {
                    Ok(path) => path,
                    Err(error) => {
                        send_event(
                            &on_event,
                            vec![
                                serde_json::json!("failed"),
                                serde_json::json!(error.to_string()),
                            ],
                        );
                        return;
                    }
                };
                let mut command = std::process::Command::new(&tmp);
                command.arg("/update").arg(current_exe);
                if let Err(error) = command.spawn() {
                    send_event(
                        &on_event,
                        vec![
                            serde_json::json!("failed"),
                            serde_json::json!(error.to_string()),
                        ],
                    );
                } else {
                    std::process::exit(0);
                }
            }
            Err(error) => send_event(
                &on_event,
                vec![
                    serde_json::json!("failed"),
                    serde_json::json!(error.to_string()),
                ],
            ),
        }
    });
}
#[cfg(test)]
mod miaonet_settings_tests {
    use super::*;

    fn sample_update() -> MiaoNetSettingsUpdate {
        MiaoNetSettingsUpdate {
            connect_on_game_start: true,
            show_avatar: false,
            show_own_name: false,
            player_light: true,
            player_interactions: false,
            enable_emote_wheel: false,
            player_presence_messages: false,
            player_opacity: 7,
            player_name_opacity: 6,
            off_screen_player_name_opacity: 3,
            self_name_opacity: 9,
            distance_based_opacity: true,
            min_player_opacity_multiplier: 2,
            emote_opacity: 6,
            emotes: vec!["Hi!".to_string(), "p:granny/laugh".to_string()],
        }
    }

    #[test]
    fn reads_upstream_defaults_when_settings_are_missing() {
        let document = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
        let settings =
            miaonet_settings_from_document(&document).expect("default settings should load");

        assert!(settings.show_avatar);
        assert!(settings.show_own_name);
        assert!(settings.player_interactions);
        assert!(settings.enable_emote_wheel);
        assert_eq!(settings.player_opacity, 8);
        assert_eq!(settings.min_player_opacity_multiplier, 2);
        assert_eq!(settings.emote_opacity, 10);
        assert_eq!(settings.emotes, settings.default_emotes);
        assert_eq!(settings.emotes.len(), 8);
    }

    #[test]
    fn updates_managed_settings_without_removing_login_or_unknown_values() {
        let mut document: serde_yaml::Value = serde_yaml::from_str(
            "TokenDataEncrypted: secret\nLastName: Maddy\nUnknownOption: keep\nshowavatar: true\n",
        )
        .expect("test yaml should parse");

        apply_miaonet_settings_update(&mut document, &sample_update())
            .expect("settings update should apply");

        assert_eq!(
            yaml_string_property(&document, "TokenDataEncrypted").as_deref(),
            Some("secret")
        );
        assert_eq!(
            yaml_string_property(&document, "LastName").as_deref(),
            Some("Maddy")
        );
        assert_eq!(
            yaml_string_property(&document, "UnknownOption").as_deref(),
            Some("keep")
        );
        let settings =
            miaonet_settings_from_document(&document).expect("updated settings should load");
        assert_eq!(settings.emotes, vec!["Hi!", "p:granny/laugh"]);
        assert_eq!(settings.emote_opacity, 6);
        assert_eq!(settings.player_opacity, 7);
        assert_eq!(settings.player_name_opacity, 6);
        assert!(settings.distance_based_opacity);
        assert_eq!(settings.min_player_opacity_multiplier, 2);
        assert!(!settings.show_avatar);
        assert!(!settings.enable_emote_wheel);
    }

    #[test]
    fn rejects_out_of_range_emote_opacity() {
        let mut document = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
        let mut update = sample_update();
        update.emote_opacity = 0;
        assert!(apply_miaonet_settings_update(&mut document, &update).is_err());
    }
}

#[cfg(test)]
mod keyboard_input_tests {
    use super::{new_keyboard_input_enabled, without_new_keyboard_input_enabled};

    #[test]
    fn parses_new_keyboard_input_environment_setting() {
        assert!(new_keyboard_input_enabled(
            "# Everest settings\nEVEREST_NEW_KEYBOARD_INPUT = 1\n"
        ));
        assert!(!new_keyboard_input_enabled(
            "EVEREST_NEW_KEYBOARD_INPUT=0\n"
        ));
        assert!(!new_keyboard_input_enabled(
            "# EVEREST_NEW_KEYBOARD_INPUT=1\n"
        ));
    }

    #[test]
    fn removes_new_keyboard_input_without_touching_comments() {
        let updated = without_new_keyboard_input_enabled(
            "# Everest settings\nEVEREST_NEW_KEYBOARD_INPUT=1\n# EVEREST_NEW_KEYBOARD_INPUT=1\nEVEREST_NEW_KEYBOARD_INPUT=0\nOTHER=1\n",
        );
        assert!(!new_keyboard_input_enabled(&updated));
        assert_eq!(
            updated,
            "# Everest settings\n# EVEREST_NEW_KEYBOARD_INPUT=1\nOTHER=1\n"
        );
        assert_eq!(
            without_new_keyboard_input_enabled("EVEREST_NEW_KEYBOARD_INPUT=1\n"),
            ""
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(windows, not(debug_assertions)))]
    initialize_windows_console();

    let args = std::env::args().collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--test-mode") {
        TEST_MODE.store(true, Ordering::Relaxed);
    }
    if args.len() == 3 && args[1] == "/update" {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let replacement = &args[2];
        if let Ok(current_exe) = std::env::current_exe() {
            let _ = fs::remove_file(replacement);
            if fs::copy(&current_exe, replacement).is_ok() {
                let _ = std::process::Command::new(replacement).spawn();
            }
        }
        return;
    }

    if !crate::webview_runtime::ensure_available() {
        return;
    }

    println!("CeleMod v{} ({})", env!("VERSION"), env!("GIT_HASH"));
    let startup_game_paths = if is_test_mode() {
        vec![get_test_game_path()]
    } else {
        get_celestes()
            .iter()
            .filter_map(|game| game.path.as_ref())
            .map(|path| normalize_game_path_buf(path))
            .collect()
    };
    for game_path in startup_game_paths {
        match cleanup_game_mod_download_temp_files(&game_path) {
            Ok(removed) if removed > 0 => {
                println!("Removed {removed} stale Mod download temporary file(s)");
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!(
                    "Failed to clean stale Mod downloads in {}: {error:#}",
                    game_path.display()
                );
            }
        }
    }
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register_all()?;

            if let Some(urls) = app.deep_link().get_current()? {
                emit_deep_links(app.handle(), urls);
            }
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                focus_main_window(&app_handle);
                emit_deep_links(&app_handle, event.urls());
            });

            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").ok_or_else(|| {
                    std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "main webview window was not created",
                    )
                })?;
                apply_macos_vibrancy(&window).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .plugin(tauri_plugin_system_symbols::init())
        .plugin(tauri_plugin_window_controls::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            take_pending_deep_links,
            download_mod,
            cancel_download_mod,
            cleanup_mod_download_temp_files,
            get_celeste_dirs,
            get_installed_mod_ids,
            get_installed_mods,
            get_invalid_zip_mod_files,
            check_all_mod_contents,
            get_installed_miaonet,
            start_game,
            runtime_platform,
            get_loenn_state,
            download_and_install_loenn,
            start_loenn,
            open_url,
            get_blacklist_profiles,
            get_blacklist_profile_count,
            get_direct_blacklist_profile,
            switch_direct_blacklist,
            update_blacklist_mod_file,
            apply_mod_profiles,
            get_active_profile_mods,
            switch_mod_profile_mods,
            get_current_profiles,
            get_olympus_presets,
            write_text_file,
            preview_olympus_profiles,
            preview_mod_profiles,
            preview_mod_profiles_json,
            commit_mod_profiles,
            export_mod_profile,
            new_mod_blacklist_profile,
            get_current_profile,
            remove_mod_blacklist_profile,
            get_mod_update,
            rm_mod,
            expand_mod_profile_dependencies,
            delete_mods,
            delete_mod_files,
            get_everest_version,
            has_new_keyboard_input_enabled,
            remove_new_keyboard_input,
            download_and_install_everest,
            download_and_install_crash_mod_fix,
            install_local_packages,
            celemod_version,
            celemod_hash,
            enable_window_controls,
            do_self_update,
            start_game_directly,
            check_everest_crash,
            stop_game_for_restart,
            restart_game_with_loader,
            reveal_crash_report,
            verify_celeste_install,
            normalize_game_path,
            get_mod_latest_info,
            show_log_window,
            is_using_cache,
            configure_mod_cache,
            get_mod_catalog,
            get_mod_cache_status,
            get_database_path,
            set_window_vibrancy,
            get_miaonet_local_state,
            get_miaonet_settings,
            save_miaonet_settings,
            miaonet_atlas::get_miaonet_atlas_previews,
            miaonet_atlas::get_miaonet_emote_previews,
            logout_miaonet,
            start_miaonet_oauth,
            keybindings::get_key_bindings,
            keybindings::update_key_binding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CeleMod");
}
