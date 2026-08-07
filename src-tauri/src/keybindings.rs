use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use super::{
    get_installed_mods_without_catalog_sync, is_celeste_running, miaonet_settings_directories,
    normalize_game_path_impl,
};

const VANILLA_ACTIONS: &[&str] = &[
    "Left",
    "Right",
    "Down",
    "Up",
    "MenuLeft",
    "MenuRight",
    "MenuDown",
    "MenuUp",
    "Grab",
    "Jump",
    "Dash",
    "Talk",
    "Pause",
    "Confirm",
    "Cancel",
    "Journal",
    "QuickRestart",
    "DemoDash",
    "RightMoveOnly",
    "LeftMoveOnly",
    "UpMoveOnly",
    "DownMoveOnly",
    "RightDashOnly",
    "LeftDashOnly",
    "UpDashOnly",
    "DownDashOnly",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct KeyBindingCatalog {
    entries: Vec<KeyBindingEntry>,
    game_running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyBindingEntry {
    source: String,
    source_kind: String,
    action_path: String,
    action: String,
    label: String,
    description: Option<String>,
    format: String,
    enabled: bool,
    installed: bool,
    keyboard: Vec<Vec<String>>,
    controller: Vec<Vec<String>>,
    mouse: Vec<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateKeyBindingRequest {
    source: String,
    action_path: String,
    format: String,
    keyboard: Vec<Vec<String>>,
    controller: Vec<Vec<String>>,
    mouse: Vec<Vec<String>>,
}

#[derive(Default)]
struct DialogEntry {
    label: String,
    description: String,
}

#[derive(Default)]
struct DialogCatalog {
    entries: Vec<(String, DialogEntry)>,
}

impl DialogCatalog {
    fn find(&self, action: &str) -> (Option<String>, Option<String>) {
        let action_tokens = word_tokens(action);
        if action_tokens.is_empty() {
            return (None, None);
        }

        let mut labels = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                if entry.label.trim().is_empty() || is_description_key(key) {
                    return None;
                }
                dialog_match_score(key, &action_tokens).map(|score| (score, entry))
            })
            .collect::<Vec<_>>();
        labels.sort_by_key(|(score, _)| std::cmp::Reverse(*score));

        let mut descriptions = self
            .entries
            .iter()
            .filter_map(|(key, entry)| {
                if !is_description_key(key) && entry.description.trim().is_empty() {
                    return None;
                }
                let text = if entry.description.trim().is_empty() {
                    entry.label.trim()
                } else {
                    entry.description.trim()
                };
                if text.is_empty() {
                    return None;
                }
                dialog_match_score(key, &action_tokens).map(|score| {
                    (
                        score + usize::from(is_description_key(key)) * 20,
                        text.to_string(),
                    )
                })
            })
            .collect::<Vec<_>>();
        descriptions.sort_by_key(|(score, _)| std::cmp::Reverse(*score));

        (
            labels
                .first()
                .map(|(_, entry)| clean_dialog_text(&entry.label)),
            descriptions
                .first()
                .map(|(_, description)| clean_dialog_text(description))
                .filter(|description| !description.is_empty()),
        )
    }
}

fn is_description_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower.ends_with("_description") || lower.ends_with("_desc") || lower.contains("subtext")
}

fn dialog_match_score(key: &str, action_tokens: &[String]) -> Option<usize> {
    let key_tokens = word_tokens(key);
    if !action_tokens.iter().all(|token| key_tokens.contains(token)) {
        return None;
    }
    let action_joined = action_tokens.join("");
    let key_joined = key_tokens.join("");
    let mut score = action_tokens.len() * 30;
    if key_joined.ends_with(&action_joined) {
        score += 50;
    }
    if key_joined.contains(&action_joined) {
        score += 25;
    }
    score = score.saturating_sub(key_tokens.len().saturating_sub(action_tokens.len()) * 3);
    Some(score)
}

fn word_tokens(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let chars = value.chars().collect::<Vec<_>>();
    for (index, character) in chars.iter().copied().enumerate() {
        if !character.is_ascii_alphanumeric() {
            if !current.is_empty() {
                tokens.push(current.to_ascii_lowercase());
                current.clear();
            }
            continue;
        }
        let previous_is_lower = index > 0 && chars[index - 1].is_ascii_lowercase();
        if character.is_ascii_uppercase() && previous_is_lower && !current.is_empty() {
            tokens.push(current.to_ascii_lowercase());
            current.clear();
        }
        current.push(character);
    }
    if !current.is_empty() {
        tokens.push(current.to_ascii_lowercase());
    }
    tokens
}

fn clean_dialog_text(value: &str) -> String {
    let mut result = String::new();
    let mut in_command = false;
    for character in value.replace("\\n", " ").chars() {
        match character {
            '{' => in_command = true,
            '}' if in_command => in_command = false,
            _ if !in_command => result.push(character),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_dialog(content: &str) -> DialogCatalog {
    let mut catalog = DialogCatalog::default();
    let mut current: Option<usize> = None;
    for raw_line in content.trim_start_matches('\u{feff}').lines() {
        let line = raw_line.trim_end();
        if line.trim_start().starts_with('#') {
            continue;
        }
        if !line.starts_with([' ', '\t']) {
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim().to_string();
                if !key.is_empty() {
                    catalog.entries.push((
                        key,
                        DialogEntry {
                            label: value.trim().to_string(),
                            description: String::new(),
                        },
                    ));
                    current = Some(catalog.entries.len() - 1);
                    continue;
                }
            }
            current = None;
        } else if let Some(index) = current {
            let continuation = line.trim();
            if !continuation.is_empty() {
                let entry = &mut catalog.entries[index].1;
                if !entry.description.is_empty() {
                    entry.description.push(' ');
                }
                entry.description.push_str(continuation);
            }
        }
    }
    catalog
}

fn save_directory(game_path: &Path) -> PathBuf {
    let directories = miaonet_settings_directories(game_path);
    directories
        .iter()
        .find(|directory| directory.join("settings.celeste").is_file())
        .cloned()
        .or_else(|| directories.into_iter().find(|directory| directory.is_dir()))
        .unwrap_or_else(|| game_path.join("Saves"))
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))
}

fn extract_xml_values(content: &str, action: &str, device: &str, item: &str) -> Vec<String> {
    let Some(action_body) = xml_element_body(content, action) else {
        return Vec::new();
    };
    let Some(device_body) = xml_element_body(action_body, device) else {
        return Vec::new();
    };
    extract_repeated_xml_text(device_body, item)
}

fn extract_mouse_values(content: &str, action: &str) -> Vec<String> {
    let Some(action_body) = xml_element_body(content, action) else {
        return Vec::new();
    };
    extract_repeated_xml_text(action_body, "MouseButtons")
}

fn xml_element_body<'a>(content: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = content.find(&open)? + open.len();
    let close = format!("</{tag}>");
    let end = content[start..].find(&close)? + start;
    Some(&content[start..end])
}

fn extract_repeated_xml_text(content: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut values = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find(&open) {
        let value_start = start + open.len();
        let Some(end_relative) = rest[value_start..].find(&close) else {
            break;
        };
        let end = value_start + end_relative;
        let value = rest[value_start..end].trim();
        if !value.is_empty() {
            values.push(value.to_string());
        }
        rest = &rest[end + close.len()..];
    }
    values
}

fn alternative_groups(values: Vec<String>) -> Vec<Vec<String>> {
    values
        .into_iter()
        .filter(|value| !value.eq_ignore_ascii_case("none"))
        .map(|value| vec![value])
        .collect()
}

fn yaml_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_sequence)
        .map(|sequence| {
            sequence
                .iter()
                .filter_map(Value::as_str)
                .filter(|value| !value.eq_ignore_ascii_case("none"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn mapping_value<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Value> {
    mapping
        .iter()
        .find(|(candidate, _)| candidate.as_str().is_some_and(|value| value == key))
        .map(|(_, value)| value)
}

fn is_standard_binding(mapping: &Mapping) -> bool {
    ["Buttons", "Keys", "MouseButtons"]
        .iter()
        .all(|key| mapping_value(mapping, key).is_some_and(|value| value.is_sequence()))
}

fn yaml_pointer(parts: &[String]) -> String {
    format!(
        "/{}",
        parts
            .iter()
            .map(|part| part.replace('~', "~0").replace('/', "~1"))
            .collect::<Vec<_>>()
            .join("/")
    )
}

fn pointer_parts(pointer: &str) -> Vec<String> {
    pointer
        .strip_prefix('/')
        .unwrap_or(pointer)
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| part.replace("~1", "/").replace("~0", "~"))
        .collect()
}

fn action_from_path(parts: &[String]) -> String {
    let mut action = parts.last().cloned().unwrap_or_default();
    if action.chars().all(|character| character.is_ascii_digit()) && parts.len() > 1 {
        action = format!(
            "{} {}",
            parts[parts.len() - 2],
            action.parse::<usize>().unwrap_or(0) + 1
        );
    }
    action
}

fn fallback_label(action: &str) -> String {
    let tokens = word_tokens(action);
    if tokens.is_empty() {
        action.to_string()
    } else {
        tokens
            .into_iter()
            .map(|token| {
                let mut characters = token.chars();
                characters
                    .next()
                    .map(|first| first.to_ascii_uppercase().to_string() + characters.as_str())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn collect_standard_bindings(
    value: &Value,
    path: &mut Vec<String>,
    source: &str,
    enabled: bool,
    installed: bool,
    dialogs: &DialogCatalog,
    entries: &mut Vec<KeyBindingEntry>,
) {
    match value {
        Value::Mapping(mapping) => {
            if is_standard_binding(mapping) {
                let action = action_from_path(path);
                let (label, description) = dialogs.find(&action);
                entries.push(KeyBindingEntry {
                    source: source.to_string(),
                    source_kind: if source == "Everest" {
                        "everest"
                    } else {
                        "mod"
                    }
                    .to_string(),
                    action_path: yaml_pointer(path),
                    action: action.clone(),
                    label: label.unwrap_or_else(|| fallback_label(&action)),
                    description,
                    format: "standard".to_string(),
                    enabled,
                    installed,
                    keyboard: alternative_groups(yaml_string_list(mapping_value(mapping, "Keys"))),
                    controller: alternative_groups(yaml_string_list(mapping_value(
                        mapping, "Buttons",
                    ))),
                    mouse: alternative_groups(yaml_string_list(mapping_value(
                        mapping,
                        "MouseButtons",
                    ))),
                });
                return;
            }
            for (key, child) in mapping {
                let Some(key) = key.as_str() else {
                    continue;
                };
                path.push(key.to_string());
                collect_standard_bindings(
                    child, path, source, enabled, installed, dialogs, entries,
                );
                path.pop();
            }
        }
        Value::Sequence(sequence) => {
            for (index, child) in sequence.iter().enumerate() {
                path.push(index.to_string());
                collect_standard_bindings(
                    child, path, source, enabled, installed, dialogs, entries,
                );
                path.pop();
            }
        }
        _ => {}
    }
}

fn collect_legacy_hotkeys(
    value: &Value,
    source: &str,
    enabled: bool,
    installed: bool,
    dialogs: &DialogCatalog,
    entries: &mut Vec<KeyBindingEntry>,
) {
    let Some(mapping) = value.as_mapping() else {
        return;
    };
    let mut bases = HashSet::new();
    for key in mapping.keys().filter_map(Value::as_str) {
        if let Some(base) = key.strip_prefix("Keyboard") {
            if !base.is_empty() {
                bases.insert(base.to_string());
            }
        }
    }
    for base in bases {
        let keyboard = yaml_string_list(mapping_value(mapping, &format!("Keyboard{base}")));
        let controller = yaml_string_list(mapping_value(mapping, &format!("Controller{base}")));
        if keyboard.is_empty() && controller.is_empty() {
            continue;
        }
        let (label, description) = dialogs.find(&base);
        entries.push(KeyBindingEntry {
            source: source.to_string(),
            source_kind: "mod".to_string(),
            action_path: format!("/{base}"),
            action: base.clone(),
            label: label.unwrap_or_else(|| fallback_label(&base)),
            description,
            format: "legacyChord".to_string(),
            enabled,
            installed,
            keyboard: (!keyboard.is_empty())
                .then_some(keyboard)
                .into_iter()
                .collect(),
            controller: (!controller.is_empty())
                .then_some(controller)
                .into_iter()
                .collect(),
            mouse: Vec::new(),
        });
    }
}

fn language_dialog_names(language: &str) -> Vec<&'static str> {
    let preferred = match language {
        "zh-CN" => "Simplified Chinese.txt",
        "ru-RU" => "Russian.txt",
        "pt-BR" => "Portuguese (Brazil).txt",
        "fr-FR" => "French.txt",
        "de-DE" => "German.txt",
        _ => "English.txt",
    };
    if preferred == "English.txt" {
        vec![preferred]
    } else {
        vec![preferred, "English.txt"]
    }
}

fn read_dialogs_from_package(package_path: &Path, language: &str) -> DialogCatalog {
    for file_name in language_dialog_names(language) {
        let wanted = format!("Dialog/{file_name}");
        if package_path.is_dir() {
            let path = package_path.join(&wanted);
            if let Ok(content) = fs::read_to_string(path) {
                return parse_dialog(&content);
            }
            continue;
        }
        let Ok(file) = fs::File::open(package_path) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        for index in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(index) else {
                continue;
            };
            if !entry.name().eq_ignore_ascii_case(&wanted) {
                continue;
            }
            let mut bytes = Vec::new();
            if entry.read_to_end(&mut bytes).is_ok() {
                return parse_dialog(&String::from_utf8_lossy(&bytes));
            }
        }
    }
    DialogCatalog::default()
}

fn blacklisted_files(game_path: &Path) -> HashSet<String> {
    fs::read_to_string(game_path.join("Mods").join("blacklist.txt"))
        .map(|content| {
            content
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty() && !line.starts_with('#'))
                .map(|line| line.to_ascii_lowercase())
                .collect()
        })
        .unwrap_or_default()
}

fn config_source_name(file_name: &str) -> String {
    file_name
        .strip_prefix("modsettings-")
        .and_then(|name| name.strip_suffix(".celeste"))
        .unwrap_or(file_name)
        .to_string()
}

fn validate_input_groups(groups: &[Vec<String>]) -> Result<(), String> {
    for value in groups.iter().flatten() {
        if value.is_empty()
            || value.len() > 48
            || !value
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Err(format!("无效的按键名称：{value}"));
        }
    }
    Ok(())
}

fn flatten_alternatives(groups: &[Vec<String>]) -> Vec<String> {
    groups
        .iter()
        .filter_map(|group| group.first())
        .cloned()
        .collect()
}

fn value_string_sequence(values: Vec<String>) -> Value {
    Value::Sequence(values.into_iter().map(Value::String).collect())
}

fn value_at_pointer_mut<'a>(value: &'a mut Value, pointer: &str) -> Option<&'a mut Value> {
    let mut current = value;
    for part in pointer_parts(pointer) {
        match current {
            Value::Mapping(mapping) => {
                current = mapping.get_mut(Value::String(part))?;
            }
            Value::Sequence(sequence) => {
                current = sequence.get_mut(part.parse::<usize>().ok()?)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

fn set_mapping_value(mapping: &mut Mapping, key: &str, value: Value) {
    mapping.insert(Value::String(key.to_string()), value);
}

fn backup_and_write(path: &Path, content: &str) -> Result<(), String> {
    if path.is_file() {
        let backup = path.with_extension("celeste.celemod.bak");
        fs::copy(path, &backup)
            .map_err(|error| format!("备份 {} 失败：{error}", path.display()))?;
    }
    fs::write(path, content).map_err(|error| format!("写入 {} 失败：{error}", path.display()))
}

fn replace_xml_child_list(
    content: &str,
    action: &str,
    device: &str,
    item: &str,
    values: &[String],
) -> Result<String, String> {
    let action_open = format!("<{action}>");
    let action_start = content
        .find(&action_open)
        .ok_or_else(|| format!("找不到游戏按键项：{action}"))?;
    let action_close = format!("</{action}>");
    let action_end = content[action_start..]
        .find(&action_close)
        .map(|offset| action_start + offset + action_close.len())
        .ok_or_else(|| format!("游戏按键项格式不完整：{action}"))?;
    let action_block = &content[action_start..action_end];
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let replacement = if values.is_empty() {
        format!("    <{device} />")
    } else {
        let items = values
            .iter()
            .map(|value| format!("      <{item}>{value}</{item}>"))
            .collect::<Vec<_>>()
            .join(newline);
        format!("    <{device}>{newline}{items}{newline}    </{device}>")
    };

    let full_open = format!("<{device}>");
    let self_close = format!("<{device} />");
    let (device_start, device_end) = if let Some(offset) = action_block.find(&full_open) {
        let start = action_start + offset;
        let close = format!("</{device}>");
        let end = content[start..]
            .find(&close)
            .map(|value| start + value + close.len())
            .ok_or_else(|| format!("游戏按键设备项格式不完整：{device}"))?;
        (start, end)
    } else if let Some(offset) = action_block.find(&self_close) {
        let start = action_start + offset;
        (start, start + self_close.len())
    } else {
        return Err(format!("找不到游戏按键设备项：{device}"));
    };
    Ok(format!(
        "{}{}{}",
        &content[..device_start],
        replacement,
        &content[device_end..]
    ))
}

fn replace_mouse_action(content: &str, action: &str, values: &[String]) -> Result<String, String> {
    let full_open = format!("<{action}>");
    let self_close = format!("<{action} />");
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let replacement = if values.is_empty() {
        format!("  <{action} />")
    } else {
        let items = values
            .iter()
            .map(|value| format!("    <MouseButtons>{value}</MouseButtons>"))
            .collect::<Vec<_>>()
            .join(newline);
        format!("  <{action}>{newline}{items}{newline}  </{action}>")
    };
    if let Some(start) = content.find(&self_close) {
        return Ok(format!(
            "{}{}{}",
            &content[..start],
            replacement,
            &content[start + self_close.len()..]
        ));
    }
    let start = content
        .find(&full_open)
        .ok_or_else(|| format!("找不到鼠标按键项：{action}"))?;
    let close = format!("</{action}>");
    let end = content[start..]
        .find(&close)
        .map(|offset| start + offset + close.len())
        .ok_or_else(|| format!("鼠标按键项格式不完整：{action}"))?;
    Ok(format!(
        "{}{}{}",
        &content[..start],
        replacement,
        &content[end..]
    ))
}

#[tauri::command]
pub(super) fn get_key_bindings(
    game_path: String,
    language: String,
) -> Result<KeyBindingCatalog, String> {
    let normalized = normalize_game_path_impl(&game_path);
    let game_path = PathBuf::from(normalized);
    let save_dir = save_directory(&game_path);
    let settings_path = save_dir.join("settings.celeste");
    let mouse_path = save_dir.join("modsettings-Everest_MouseBindings.celeste");
    let settings = read_text(&settings_path)?;
    let mouse = fs::read_to_string(&mouse_path).unwrap_or_default();
    let mut entries = Vec::new();

    for action in VANILLA_ACTIONS {
        entries.push(KeyBindingEntry {
            source: "Celeste".to_string(),
            source_kind: "game".to_string(),
            action_path: format!("/{action}"),
            action: (*action).to_string(),
            label: fallback_label(action),
            description: None,
            format: "vanilla".to_string(),
            enabled: true,
            installed: true,
            keyboard: alternative_groups(extract_xml_values(&settings, action, "Keyboard", "Keys")),
            controller: alternative_groups(extract_xml_values(
                &settings,
                action,
                "Controller",
                "Buttons",
            )),
            mouse: alternative_groups(extract_mouse_values(&mouse, action)),
        });
    }

    let mods_dir = game_path.join("Mods");
    let installed_mods =
        get_installed_mods_without_catalog_sync(mods_dir.to_string_lossy().into_owned());
    let installed_by_name = installed_mods
        .iter()
        .map(|item| (item.name.to_ascii_lowercase(), item))
        .collect::<HashMap<_, _>>();
    let blacklisted = blacklisted_files(&game_path);
    let mut config_files = fs::read_dir(&save_dir)
        .map_err(|error| format!("读取存档目录失败：{error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            name.starts_with("modsettings-")
                && name.ends_with(".celeste")
                && name != "modsettings-Everest_MouseBindings.celeste"
        })
        .collect::<Vec<_>>();
    config_files.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for config in config_files {
        let file_name = config.file_name().to_string_lossy().to_string();
        let source = config_source_name(&file_name);
        let Ok(content) = fs::read_to_string(config.path()) else {
            continue;
        };
        if content
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with('<')
        {
            continue;
        }
        let Ok(value) = serde_yaml::from_str::<Value>(&content) else {
            continue;
        };
        let installed_mod = installed_by_name.get(&source.to_ascii_lowercase()).copied();
        let installed = installed_mod.is_some() || source == "Everest";
        let enabled = installed_mod
            .map(|item| !blacklisted.contains(&item.file.to_ascii_lowercase()))
            .unwrap_or(source == "Everest");
        let dialogs = installed_mod
            .map(|item| read_dialogs_from_package(&mods_dir.join(&item.file), &language))
            .unwrap_or_default();
        collect_standard_bindings(
            &value,
            &mut Vec::new(),
            &source,
            enabled,
            installed,
            &dialogs,
            &mut entries,
        );
        collect_legacy_hotkeys(&value, &source, enabled, installed, &dialogs, &mut entries);
    }

    entries.sort_by(|left, right| {
        left.source
            .to_ascii_lowercase()
            .cmp(&right.source.to_ascii_lowercase())
            .then_with(|| {
                left.label
                    .to_ascii_lowercase()
                    .cmp(&right.label.to_ascii_lowercase())
            })
    });
    Ok(KeyBindingCatalog {
        entries,
        game_running: is_celeste_running(&game_path),
    })
}

#[tauri::command]
pub(super) fn update_key_binding(
    game_path: String,
    request: UpdateKeyBindingRequest,
) -> Result<(), String> {
    validate_input_groups(&request.keyboard)?;
    validate_input_groups(&request.controller)?;
    validate_input_groups(&request.mouse)?;
    let normalized = normalize_game_path_impl(&game_path);
    let game_path = PathBuf::from(normalized);
    if is_celeste_running(&game_path) {
        return Err("请先退出 Celeste，再修改按键。".to_string());
    }
    let save_dir = save_directory(&game_path);

    if request.format == "vanilla" {
        let action = request.action_path.trim_start_matches('/');
        if !VANILLA_ACTIONS.contains(&action) {
            return Err("未知的游戏按键项。".to_string());
        }
        let settings_path = save_dir.join("settings.celeste");
        let mut settings = read_text(&settings_path)?;
        settings = replace_xml_child_list(
            &settings,
            action,
            "Keyboard",
            "Keys",
            &flatten_alternatives(&request.keyboard),
        )?;
        settings = replace_xml_child_list(
            &settings,
            action,
            "Controller",
            "Buttons",
            &flatten_alternatives(&request.controller),
        )?;
        backup_and_write(&settings_path, &settings)?;

        let mouse_path = save_dir.join("modsettings-Everest_MouseBindings.celeste");
        if mouse_path.is_file() {
            let mouse = read_text(&mouse_path)?;
            let mouse =
                replace_mouse_action(&mouse, action, &flatten_alternatives(&request.mouse))?;
            backup_and_write(&mouse_path, &mouse)?;
        }
        return Ok(());
    }

    if request.source.contains(['/', '\\']) || request.source == "." || request.source == ".." {
        return Err("无效的 Mod 名称。".to_string());
    }
    let config_path = save_dir.join(format!("modsettings-{}.celeste", request.source));
    if !config_path.is_file() {
        return Err("找不到 Mod 设置文件。".to_string());
    }
    let content = read_text(&config_path)?;
    let mut value = serde_yaml::from_str::<Value>(&content)
        .map_err(|error| format!("解析 Mod 设置失败：{error}"))?;

    match request.format.as_str() {
        "standard" => {
            let target = value_at_pointer_mut(&mut value, &request.action_path)
                .and_then(Value::as_mapping_mut)
                .filter(|mapping| is_standard_binding(mapping))
                .ok_or_else(|| "按键配置结构已经发生变化，请刷新后重试。".to_string())?;
            set_mapping_value(
                target,
                "Keys",
                value_string_sequence(flatten_alternatives(&request.keyboard)),
            );
            set_mapping_value(
                target,
                "Buttons",
                value_string_sequence(flatten_alternatives(&request.controller)),
            );
            set_mapping_value(
                target,
                "MouseButtons",
                value_string_sequence(flatten_alternatives(&request.mouse)),
            );
        }
        "legacyChord" => {
            let base = request.action_path.trim_start_matches('/');
            if base.is_empty() || base.contains('/') {
                return Err("无效的快捷键配置路径。".to_string());
            }
            let mapping = value
                .as_mapping_mut()
                .ok_or_else(|| "Mod 设置不是标准 YAML 对象。".to_string())?;
            set_mapping_value(
                mapping,
                &format!("Keyboard{base}"),
                value_string_sequence(request.keyboard.first().cloned().unwrap_or_default()),
            );
            set_mapping_value(
                mapping,
                &format!("Controller{base}"),
                value_string_sequence(request.controller.first().cloned().unwrap_or_default()),
            );
        }
        _ => return Err("不支持的按键配置格式。".to_string()),
    }
    let serialized =
        serde_yaml::to_string(&value).map_err(|error| format!("序列化 Mod 设置失败：{error}"))?;
    backup_and_write(&config_path, &serialized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dialog_matching_handles_reordered_tokens() {
        let catalog = parse_dialog(
            "miaonet_options_button_chat= Open Chat\n  Opens the multiplayer chat window.\n",
        );
        let (label, description) = catalog.find("ChatButton");
        assert_eq!(label.as_deref(), Some("Open Chat"));
        assert_eq!(
            description.as_deref(),
            Some("Opens the multiplayer chat window.")
        );
    }

    #[test]
    fn xml_binding_replacement_keeps_other_devices() {
        let input = "<Settings>\n  <Jump>\n    <Keyboard />\n    <Controller>\n      <Buttons>A</Buttons>\n    </Controller>\n  </Jump>\n</Settings>";
        let output =
            replace_xml_child_list(input, "Jump", "Keyboard", "Keys", &["Space".to_string()])
                .unwrap();
        assert!(output.contains("<Keys>Space</Keys>"));
        assert!(output.contains("<Buttons>A</Buttons>"));
    }

    #[test]
    fn reads_local_catalog_when_fixture_is_available() {
        let path = Path::new(r"C:\SteamLibrary\steamapps\common\Celeste");
        if !path.join("Saves").join("settings.celeste").is_file() {
            return;
        }
        let catalog = get_key_bindings(path.to_string_lossy().into_owned(), "zh-CN".to_string())
            .expect("local key bindings should be readable");
        assert!(
            catalog
                .entries
                .iter()
                .any(|entry| entry.source == "Celeste")
        );
        assert!(
            catalog
                .entries
                .iter()
                .any(|entry| entry.format == "standard")
        );
        if let Some(chat) = catalog
            .entries
            .iter()
            .find(|entry| entry.source == "MiaoNet" && entry.action == "ChatButton")
        {
            assert_eq!(chat.label, "打开聊天栏");
        }
    }
}
