use super::{
    EverestModMetadata, LocalMod, everest, get_installed_mods_without_catalog_sync, parse_mod_yaml,
    parse_mod_yaml_document,
};
use anyhow::{Context, bail};
use lazy_static::lazy_static;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const PRE_CRASH_LINES: usize = 180;
const MAX_CRASH_LINES: usize = 1200;
const MAX_ERROR_LOG_BYTES: usize = 2_000_000;
const LOG_SETTLE_MILLIS: u64 = 3_000;
const MAX_CRASH_AGE_MILLIS: u64 = 60 * 60 * 1000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashSuspect {
    pub name: String,
    pub file: String,
    pub installed_version: String,
    pub latest_version: Option<String>,
    pub game_banana_file_id: Option<i64>,
    pub download_url: Option<String>,
    pub update_available: bool,
    pub confidence: u8,
    pub evidence: String,
    pub dependents: Vec<CrashDependent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashDependent {
    pub name: String,
    pub optional: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashAnalysis {
    pub fingerprint: String,
    pub event_id: String,
    pub crash_index: u64,
    pub log_modified_at: u64,
    pub source_log: String,
    pub error_log: Option<String>,
    pub report_path: String,
    pub exception: String,
    pub summary: String,
    pub reasons: Vec<String>,
    pub suggestions: Vec<String>,
    pub suspects: Vec<CrashSuspect>,
    pub everest_version: Option<i32>,
    pub is_everest_ultra: bool,
    pub excerpt: String,
}

#[derive(Clone)]
struct CrashRecord {
    path: PathBuf,
    modified_at: u64,
    crash_index: u64,
    excerpt: String,
    inherent_crash_log: bool,
}

#[derive(Clone)]
struct CachedAnalysis {
    game_path: String,
    fingerprint: String,
    analysis: CrashAnalysis,
}

lazy_static! {
    static ref ANALYSIS_CACHE: Mutex<Option<CachedAnalysis>> = Mutex::new(None);
}

fn modified_millis(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn should_analyze_crash(modified_at: u64, now: u64) -> bool {
    let age = now.saturating_sub(modified_at);
    (LOG_SETTLE_MILLIS..MAX_CRASH_AGE_MILLIS).contains(&age)
}

fn is_crash_marker(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("encountered a critical error")
        || lower.contains(">>> critical error:")
        || (lower.contains("[critical]")
            && (lower.contains("exception") || lower.contains("error") || lower.contains("failed")))
}

fn starts_unrelated_log_entry(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    line.starts_with('(')
        && line.contains(") [Everest] [")
        && !lower.contains("[critical]")
        && !lower.contains("crit-error-handler")
}

fn crash_signature(record: &CrashRecord) -> String {
    let lines = record.excerpt.lines().collect::<Vec<_>>();
    let marker = lines
        .iter()
        .rposition(|line| is_crash_marker(line))
        .unwrap_or(0);
    let mut stable_lines = Vec::new();
    for (offset, line) in lines[marker..].iter().take(120).enumerate() {
        let starts_new_log_entry = offset > 0 && starts_unrelated_log_entry(line);
        if starts_new_log_entry {
            break;
        }
        stable_lines.push(*line);
    }
    let stable_part = stable_lines.join("\n");
    let mut hasher = Sha256::new();
    hasher.update(record.crash_index.to_le_bytes());
    hasher.update(stable_part.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn crash_event_id(record: &CrashRecord) -> String {
    let body = latest_crash_body(&record.excerpt);
    let lines = body.lines().collect::<Vec<_>>();
    let marker = lines
        .iter()
        .find(|line| is_crash_marker(line))
        .map(|line| line.trim())
        .unwrap_or_default();
    let exception = exception_line(&body);
    let timestamp = error_section_time_key(&lines);

    let mut hasher = Sha256::new();
    if let Some(timestamp) = timestamp {
        // The same crash can move from log.txt to LogHistory/CrashLogs. A parsed
        // event timestamp plus its exception remains stable across those sources.
        hasher.update(format!("{timestamp:?}").as_bytes());
    } else {
        // Bare markers do not identify separate crashes by themselves. The crash
        // sequence remains stable while one log entry is being flushed.
        hasher.update(record.crash_index.to_le_bytes());
        hasher.update(marker.as_bytes());
    }
    hasher.update(exception.as_bytes());
    format!("{:x}", hasher.finalize())[..16].to_string()
}

fn scan_log(path: &Path, inherent_crash_log: bool) -> Option<CrashRecord> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut before = VecDeque::with_capacity(PRE_CRASH_LINES);
    let mut excerpt = Vec::new();
    let mut crash_index = 0_u64;
    let mut capturing = false;

    for line in reader.lines().map_while(Result::ok) {
        if is_crash_marker(&line) {
            crash_index += 1;
            // A log can contain multiple handled crashes. Do not carry context
            // from the previous crash into the newest crash section.
            excerpt = vec![line.clone()];
            capturing = true;
        } else if crash_index > 0 && capturing {
            if excerpt.len() > 2 && starts_unrelated_log_entry(&line) {
                capturing = false;
            } else if excerpt.len() < PRE_CRASH_LINES + MAX_CRASH_LINES {
                excerpt.push(line.clone());
            }
        }

        if before.len() == PRE_CRASH_LINES {
            before.pop_front();
        }
        before.push_back(line);
    }

    if crash_index == 0 {
        if !inherent_crash_log {
            return None;
        }
        crash_index = 1;
        excerpt = before.into_iter().collect();
    }

    Some(CrashRecord {
        path: path.to_path_buf(),
        modified_at: modified_millis(path),
        crash_index,
        excerpt: excerpt.join("\n"),
        inherent_crash_log,
    })
}

fn collect_log_candidates(game_path: &Path) -> Vec<CrashRecord> {
    let mut records = Vec::new();
    if let Some(record) = scan_log(&game_path.join("log.txt"), false) {
        records.push(record);
    }

    for (directory, inherent) in [
        (game_path.join("LogHistory"), false),
        (game_path.join("CrashLogs"), true),
    ] {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"))
                && let Some(record) = scan_log(&path, inherent)
            {
                records.push(record);
            }
        }
    }
    records
}

fn error_log_candidates(game_path: &Path) -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut candidates = vec![
        game_path.join("errorLog.txt"),
        game_path.join("error_log.txt"),
    ];

    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("Celeste")
                .join("errorLog.txt"),
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME") {
            candidates.push(
                PathBuf::from(xdg_data_home)
                    .join("Celeste")
                    .join("errorLog.txt"),
            );
        }
        if let Some(home) = dirs::home_dir() {
            candidates.push(
                home.join(".local")
                    .join("share")
                    .join("Celeste")
                    .join("errorLog.txt"),
            );
        }
    }

    candidates
        .into_iter()
        .filter(|path| {
            path.is_file() && fs::metadata(path).is_ok_and(|metadata| metadata.len() > 0)
        })
        .collect()
}

fn read_limited_text(path: &Path, maximum: usize) -> String {
    let Ok(bytes) = fs::read(path) else {
        return String::new();
    };
    if bytes.len() <= maximum {
        return String::from_utf8_lossy(&bytes).into_owned();
    }
    let half = maximum / 2;
    format!(
        "{}\n\n[... CeleMod skipped the middle of this large error log ...]\n\n{}",
        String::from_utf8_lossy(&bytes[..half]),
        String::from_utf8_lossy(&bytes[bytes.len() - half..]),
    )
}

fn error_section_time_key(lines: &[&str]) -> Option<(u64, u64, u64, u64, u64, u64)> {
    let numbers = lines
        .iter()
        .take(5)
        .flat_map(|line| {
            line.split(|character: char| !character.is_ascii_digit())
                .filter(|part| !part.is_empty())
                .filter_map(|part| part.parse::<u64>().ok())
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    for values in numbers.windows(6) {
        let (year, month, day) = if values[0] >= 1_000 {
            (values[0], values[1], values[2])
        } else if values[2] >= 1_000 {
            // Monocle's Windows error log commonly uses MM/DD/YYYY.
            (values[2], values[0], values[1])
        } else {
            continue;
        };
        if (1..=12).contains(&month)
            && (1..=31).contains(&day)
            && values[3] < 24
            && values[4] < 60
            && values[5] < 60
        {
            return Some((year, month, day, values[3], values[4], values[5]));
        }
    }
    None
}

fn extract_latest_error_section(text: &str) -> String {
    let lines = text.lines().collect::<Vec<_>>();
    let starts = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| line.trim_start().starts_with("Ver ").then_some(index))
        .collect::<Vec<_>>();
    if starts.is_empty() {
        return text.trim().to_string();
    }

    let sections = starts.iter().enumerate().map(|(position, start)| {
        let end = starts.get(position + 1).copied().unwrap_or(lines.len());
        let section = &lines[*start..end];
        (error_section_time_key(section), position, section)
    });
    let (_, _, latest) = sections
        .max_by(|left, right| {
            left.0
                .cmp(&right.0)
                // If timestamps cannot be parsed, errorLog normally stores the
                // newest entry first, so prefer the lower section index.
                .then_with(|| right.1.cmp(&left.1))
        })
        .unwrap();
    latest.join("\n").trim().to_string()
}

fn latest_error_log(game_path: &Path) -> Option<(PathBuf, u64, String)> {
    error_log_candidates(game_path)
        .into_iter()
        .map(|path| {
            let modified = modified_millis(&path);
            let text = extract_latest_error_section(&read_limited_text(&path, MAX_ERROR_LOG_BYTES));
            (path, modified, text)
        })
        .max_by_key(|(_, modified, _)| *modified)
}

fn normalize_token(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn version_numbers(value: &str) -> Vec<u64> {
    value
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn version_is_newer(latest: &str, installed: &str) -> bool {
    let latest = version_numbers(latest);
    let installed = version_numbers(installed);
    (0..latest.len().max(installed.len())).any(|index| {
        let left = latest.get(index).copied().unwrap_or_default();
        let right = installed.get(index).copied().unwrap_or_default();
        left != right
            && (0..index).all(|previous| {
                latest.get(previous).copied().unwrap_or_default()
                    == installed.get(previous).copied().unwrap_or_default()
            })
            && left > right
    })
}

fn yaml_for_directory(path: &Path) -> Option<Vec<EverestModMetadata>> {
    ["everest.yaml", "everest.yml"]
        .iter()
        .map(|name| path.join(name))
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| fs::read_to_string(candidate).ok())
        .and_then(|text| parse_mod_yaml_document(&text).ok())
}

fn mod_tokens(game_path: &Path, local_mod: &LocalMod) -> Vec<String> {
    let mod_path = game_path.join("Mods").join(&local_mod.file);
    let yaml = if mod_path.is_dir() {
        yaml_for_directory(&mod_path)
    } else {
        parse_mod_yaml(&mod_path).ok()
    };
    let mut tokens = vec![local_mod.name.clone()];
    if let Some(entries) = yaml {
        for entry in entries {
            if let Some(dll) = entry.dll.as_deref() {
                let stem = Path::new(dll)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(dll);
                tokens.push(stem.to_string());
            }
        }
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

fn disabled_mod_files(game_path: &Path) -> HashSet<String> {
    let path = game_path.join("Mods").join("blacklist.txt");
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_ascii_lowercase())
        .collect()
}

fn find_evidence(text: &str, tokens: &[String]) -> Option<(u8, String)> {
    text.lines()
        .filter_map(|line| {
            let lower = line.to_ascii_lowercase();
            let matched_tokens = tokens
                .iter()
                .filter(|token| token.len() >= 4 && lower.contains(&token.to_ascii_lowercase()))
                .collect::<Vec<_>>();
            if matched_tokens.is_empty() {
                return None;
            }
            let trimmed = line.trim();
            let confidence = if lower.contains("failed loading startup mod")
                && matched_tokens.iter().any(|token| {
                    let token = token.to_ascii_lowercase();
                    lower.contains(&format!("failed loading startup mod {token}"))
                }) {
                // Everest explicitly names the startup Mod whose Load method failed.
                // This is stronger evidence than later framework/interceptor frames.
                100
            } else if trimmed.starts_with("at ") || trimmed.starts_with("在 ") {
                96
            } else {
                72
            };
            Some((confidence, trimmed.to_string()))
        })
        .max_by_key(|(confidence, _)| *confidence)
}

fn known_alias_score(mod_name: &str, crash_compact: &str) -> Option<(u8, &'static str)> {
    let name = normalize_token(mod_name);
    let aliases: &[(&[&str], &[&str], &str)] = &[
        (
            &["maxhelpinghand", "maddieshelpinghand"],
            &["maxhelpinghand"],
            "stacktrace mentions MaxHelpingHand",
        ),
        (
            &["strawberryjam"],
            &["strawberryjam"],
            "stacktrace mentions Strawberry Jam",
        ),
        (
            &["isagrabbag"],
            &["isagrabbag", "isagrab"],
            "stacktrace mentions Isa's Grab Bag",
        ),
        (
            &["factoryhelper"],
            &["factoryhelper"],
            "stacktrace mentions Factory Helper",
        ),
        (
            &["bouncehelper"],
            &["bouncehelper"],
            "stacktrace mentions Bounce Helper",
        ),
        (
            &["celestenet", "miaonet", "miaocelestenetclient"],
            &["celestenetclient", "miaocelestenet"],
            "stacktrace mentions CelesteNet/MiaoNet",
        ),
        (
            &["randomizer"],
            &["randomizerrandomodule"],
            "stacktrace mentions Randomizer",
        ),
        (
            &["celestetas", "tas"],
            &["taseverestinterop", "celestetas"],
            "stacktrace mentions CelesteTAS",
        ),
    ];
    aliases
        .iter()
        .find_map(|(mod_aliases, trace_aliases, reason)| {
            (mod_aliases.iter().any(|alias| name.contains(alias))
                && trace_aliases
                    .iter()
                    .any(|alias| crash_compact.contains(alias)))
            .then_some((78, *reason))
        })
}

fn analyze_suspects(game_path: &Path, text: &str) -> Vec<CrashSuspect> {
    let installed = get_installed_mods_without_catalog_sync(
        game_path.join("Mods").to_string_lossy().into_owned(),
    );
    let disabled = disabled_mod_files(game_path);
    let mut dependents = HashMap::<String, Vec<CrashDependent>>::new();
    for local_mod in &installed {
        if disabled.contains(&local_mod.file.to_ascii_lowercase()) {
            continue;
        }
        for dependency in &local_mod.deps {
            let items = dependents.entry(dependency.name.clone()).or_default();
            if !items.iter().any(|item| item.name == local_mod.name) {
                items.push(CrashDependent {
                    name: local_mod.name.clone(),
                    optional: dependency.optional,
                });
            }
        }
    }
    let compact_crash = normalize_token(text);
    let catalog = everest::get_mod_cached_if_loaded();
    let mut suspects = Vec::new();

    for local_mod in installed {
        if disabled.contains(&local_mod.file.to_ascii_lowercase()) {
            continue;
        }
        let tokens = mod_tokens(game_path, &local_mod);
        let normalized_tokens = tokens
            .iter()
            .map(|token| normalize_token(token))
            .filter(|token| token.len() >= 4)
            .collect::<Vec<_>>();
        let evidence = find_evidence(text, &tokens);
        let direct_match = normalized_tokens
            .iter()
            .filter(|token| !["celeste", "everest", "coremodule"].contains(&token.as_str()))
            .max_by_key(|token| token.len())
            .filter(|token| compact_crash.contains(token.as_str()));

        let (confidence, reason) = if let Some((confidence, line)) = evidence {
            (confidence, line)
        } else if let Some(token) = direct_match {
            (82, format!("stacktrace contains identifier {token}"))
        } else if let Some((score, reason)) = known_alias_score(&local_mod.name, &compact_crash) {
            (score, reason.to_string())
        } else {
            continue;
        };

        let latest = catalog
            .as_ref()
            .and_then(|items| items.get(&local_mod.name));
        let update_available =
            latest.is_some_and(|latest| version_is_newer(&latest.version, &local_mod.version));
        let mod_dependents = dependents.remove(&local_mod.name).unwrap_or_default();
        suspects.push(CrashSuspect {
            name: local_mod.name,
            file: local_mod.file,
            installed_version: local_mod.version,
            latest_version: latest.map(|value| value.version.clone()),
            game_banana_file_id: latest.map(|value| value.game_banana_file_id),
            download_url: latest.map(|value| value.download_url.clone()),
            update_available,
            confidence,
            evidence: reason,
            dependents: mod_dependents,
        });
    }

    suspects.sort_by(|left, right| {
        right
            .confidence
            .cmp(&left.confidence)
            .then_with(|| left.name.cmp(&right.name))
    });
    if suspects.iter().any(|suspect| suspect.confidence >= 80) {
        suspects.retain(|suspect| suspect.confidence >= 65);
    }
    suspects.truncate(6);
    suspects
}

fn exception_line(text: &str) -> String {
    let lines = text.lines().map(str::trim).collect::<Vec<_>>();
    lines
        .iter()
        .copied()
        .find(|line| {
            line.contains("Exception")
                && !line.contains("ENCOUNTERED A CRITICAL ERROR")
                && !line.starts_with("at ")
                && !line.starts_with("在 ")
        })
        .or_else(|| {
            lines.iter().copied().find(|line| {
                (line.contains("Error") || line.contains("Steam not found"))
                    && !line.contains("Error Log")
                    && !line.contains("errorLog")
                    && !line.contains("ENCOUNTERED A CRITICAL ERROR")
                    && !line.starts_with("at ")
                    && !line.starts_with("在 ")
            })
        })
        .unwrap_or("未能识别异常类型")
        .to_string()
}

fn latest_crash_body(text: &str) -> String {
    let lines = text.lines().collect::<Vec<_>>();
    let start = lines
        .iter()
        .rposition(|line| is_crash_marker(line))
        .unwrap_or(0);
    lines[start..].join("\n")
}

fn reason_analysis(text: &str, suspects: &[CrashSuspect]) -> (String, Vec<String>, Vec<String>) {
    let lower = text.to_ascii_lowercase();
    let mut reasons = Vec::new();
    let mut suggestions = Vec::new();
    let summary = if lower.contains("outofmemoryexception")
        || lower.contains("image loading failed: outofmem")
    {
        reasons.push("内存或显存不足，通常是同时启用的地图、贴图或大型 Mod 过多。".to_string());
        suggestions
            .push("先禁用不需要的地图和大型内容 Mod，并关闭占用内存/显存的程序。".to_string());
        "资源不足导致崩溃".to_string()
    } else if lower.contains("badcrcexception")
        || lower.contains("end of central directory")
        || lower.contains("invalid block type")
        || lower.contains("could not read") && lower.contains("zip file")
    {
        reasons.push("某个 Mod 压缩包不完整或已经损坏。".to_string());
        suggestions.push(
            "重新下载日志中最后加载或点名的 Mod；若没有文件名，可用二分法禁用 Mod 排查。"
                .to_string(),
        );
        "Mod 压缩包可能损坏".to_string()
    } else if lower.contains("err_event_already_loaded") {
        reasons.push("两个 FMOD 音频库定义了相同事件，常见原因是重复安装同一个 Mod。".to_string());
        suggestions
            .push("检查 Mods 文件夹中的重复 Mod，或禁用最近安装的音频相关 Mod。".to_string());
        "Mod 音频资源发生冲突".to_string()
    } else if lower.contains("err_output_init") || lower.contains("err_notready") {
        reasons.push("Celeste 的音频设备或 FMOD 初始化失败。".to_string());
        suggestions.push(
            "重新插拔/切换音频设备，关闭 FMOD Live Update，必要时重启电脑或更新声卡驱动。"
                .to_string(),
        );
        "音频设备初始化失败".to_string()
    } else if lower.contains("0x887a0005")
        || lower.contains("0x887a0006")
        || lower.contains("0x887a0007")
        || lower.contains("0x887a0020")
        || lower.contains("present failed")
    {
        reasons.push("图形驱动、显存或渲染 API 进入了异常状态。".to_string());
        suggestions.push("更新显卡驱动、关闭占用显存的程序，并尝试在 everest-launch.txt 中启用 --graphics OpenGL。".to_string());
        "图形驱动或显存异常".to_string()
    } else if lower.contains("argumentnullexception") && lower.contains("parameter 'method'") {
        reasons.push("常见于旧版 Strawberry Jam 与新版 Factory Helper 的兼容问题。".to_string());
        suggestions.push("优先更新 Strawberry Jam，并同时更新相关 Helper。".to_string());
        "已知的 Mod 版本兼容问题".to_string()
    } else if lower.contains("derived method 'onsquish'")
        && lower.contains("respawningbouncejellyfish")
    {
        reasons.push("旧版 Maddie's Helping Hand 与新版 Bounce Helper 不兼容。".to_string());
        suggestions.push("更新 Maddie's Helping Hand。".to_string());
        "Helping Hand / Bounce Helper 版本冲突".to_string()
    } else if lower.contains("source method is generic")
        && lower.contains("generic hooks are not supported")
    {
        reasons.push("已知可能由旧版 Isa's Grab Bag 与新版 Everest 组合触发。".to_string());
        suggestions.push("更新 Isa's Grab Bag。".to_string());
        "旧版 Mod 与 Everest 不兼容".to_string()
    } else if lower.contains("nullableattribute") {
        reasons.push(
            "某个 Mod 使用了较新 Everest/.NET 构建，但没有正确声明最低 Everest 版本。".to_string(),
        );
        suggestions
            .push("更新所有相关 Mod 和 Everest；若均为最新版，请把报告发给 Mod 作者。".to_string());
        "Mod 需要更新的 Everest 运行环境".to_string()
    } else if lower.contains("rushhelper.playerextensions.player_beforedowntransition_il")
        && lower.contains("ilcursor.gotonext")
    {
        reasons.push(
            "RushHelper 1.1.x 在 Player.BeforeDownTransition 中只接受精确的 ldc.i4.5 指令编码；当前 Celeste/Everest IL 使用了不同但等价的整数加载形式，或已被其他 Hook 改写，因此 GotoNext 找不到目标并直接抛出异常。"
                .to_string(),
        );
        suggestions.push(
            "更新到包含 MatchLdcI4(Player.StRedDash) 修复的 RushHelper 1.2.0 或更高版本；如果暂时没有发布包，只能禁用 RushHelper，或使用作者源码构建新版。"
                .to_string(),
        );
        "RushHelper 1.1.x 使用了过于严格的 IL 匹配".to_string()
    } else if lower.contains("ilcursor.gotonext")
        && (lower.contains("ilcontext.invoke")
            || lower.contains("addilhook")
            || lower.contains("ilhooktransaction")
            || lower.contains("addilhooksbatch"))
    {
        let suspect = suspects
            .first()
            .map(|item| item.name.as_str())
            .unwrap_or("某个 Mod");
        reasons.push(format!(
            "{suspect} 的 IL Hook 没有在当前 Everest 代码中找到预期指令，通常是 Mod 与当前 Everest/Loader 版本不兼容。"
        ));
        suggestions.push(format!(
            "优先更新或暂时禁用 {suspect}；如果使用 EverestUltra，也可以先用 Legacy Loader 验证。"
        ));
        "Mod IL Hook 与当前 Loader 不兼容".to_string()
    } else if lower.contains("invalidprogramexception") {
        reasons.push("多个 Helper/Hook 之间可能发生了运行时补丁冲突。".to_string());
        suggestions.push("更新所有 Mod；若仍崩溃，优先禁用 stacktrace 中出现的 Mod。".to_string());
        "Mod Hook 或 Helper 冲突".to_string()
    } else if lower.contains("dllnotfoundexception") {
        reasons.push("Everest、Mod 或 Celeste 本体需要的原生库没有找到或无法加载。".to_string());
        suggestions.push(
            "校验/重装 Celeste 文件后重新安装 Everest；Linux 用户还应检查日志中点名的 so 依赖。"
                .to_string(),
        );
        "缺少或无法加载原生库".to_string()
    } else if lower.contains("unauthorizedaccessexception") {
        reasons.push("游戏目录或其中某个文件没有足够的读写权限。".to_string());
        suggestions.push(
            "关闭占用文件的程序，检查目录权限；必要时校验游戏并重新安装 Everest。".to_string(),
        );
        "文件权限不足".to_string()
    } else if lower.contains("too many open files") {
        reasons
            .push("系统允许 Celeste 同时打开的文件数已耗尽，常见于解压安装大量 Mod。".to_string());
        suggestions
            .push("尽量保留 Mod 的 zip 包而不是解压目录，并减少同时启用的 Mod。".to_string());
        "打开的文件过多".to_string()
    } else if lower.contains("disk space") || lower.contains("磁盘空间不足") {
        reasons.push("Celeste、系统临时目录或游戏所在磁盘空间不足。".to_string());
        suggestions.push("清理游戏盘和系统临时目录后重试。".to_string());
        "磁盘空间不足".to_string()
    } else if lower.contains("socketexception") || lower.contains("httprequestexception") {
        reasons.push("网络连接、代理、防火墙或目标站点访问失败。".to_string());
        suggestions.push("检查网络连接和防火墙，确认能访问 Mod 下载与更新站点。".to_string());
        "网络连接异常".to_string()
    } else if lower.contains("aggregateexception")
        || lower.contains("destination is too short")
        || lower.contains("yo, i heard you like everest")
    {
        reasons.push("该错误常见于过旧的 Everest 或 MonoMod 运行时。".to_string());
        suggestions.push("更新 Everest 到当前分支的最新版。".to_string());
        "Everest 版本可能过旧".to_string()
    } else if lower.contains("pe image does not have metadata") {
        reasons.push("orig/Celeste.exe 或 Celeste 本体文件可能已经损坏。".to_string());
        suggestions.push("校验或重装 Celeste 本体，然后重新安装 Everest。".to_string());
        "Celeste 本体文件可能损坏".to_string()
    } else if lower.contains("can't find sprite") || lower.contains("celeste.parallax..ctor") {
        reasons.push("地图引用的贴图/精灵不存在，或缺少提供该资源的依赖 Mod。".to_string());
        suggestions.push("检查地图依赖是否完整，并更新日志中出现的地图或 Helper。".to_string());
        "地图资源或依赖缺失".to_string()
    } else if !suspects.is_empty() {
        reasons.push("stacktrace 中出现了已安装 Mod 的程序集或命名空间。".to_string());
        suggestions.push("优先更新或暂时禁用高置信度的可疑 Mod，再观察是否复现。".to_string());
        "可能是 Mod 代码抛出的异常".to_string()
    } else {
        reasons
            .push("没有匹配到已知错误模式，也没有从 stacktrace 中可靠定位到某个 Mod。".to_string());
        suggestions.push(
            "先更新 Everest 和全部 Mod；仍然崩溃时，把生成的 TXT 报告发给他人协助分析。"
                .to_string(),
        );
        "暂时无法自动确定根因".to_string()
    };

    if suspects.iter().any(|suspect| suspect.update_available) {
        suggestions.insert(0, "检测到可疑 Mod 有更新，建议先更新后重试。".to_string());
    }
    (summary, reasons, suggestions)
}

fn is_everest_ultra(game_path: &Path, text: &str) -> bool {
    if text.contains("EverestUltra")
        || text.contains("Parallel startup scheduler enabled")
        || text.contains("Startup ILHook transaction enabled")
    {
        return true;
    }
    everest::is_everest_ultra(game_path)
}

fn report_directory() -> anyhow::Result<PathBuf> {
    let root = dirs::cache_dir()
        .or_else(dirs::data_local_dir)
        .context("Failed to find a cache directory")?;
    Ok(root.join("CeleMod").join("crash-reports"))
}

fn report_text(
    analysis: &CrashAnalysis,
    log_excerpt: &str,
    error_log_text: Option<&str>,
) -> String {
    let mut output = String::new();
    output.push_str("CeleMod Everest 崩溃自动分析报告\n");
    output.push_str("================================\n\n");
    output.push_str(&format!("崩溃标识: {}\n", analysis.fingerprint));
    output.push_str(&format!(
        "日志更新时间 (Unix ms): {}\n",
        analysis.log_modified_at
    ));
    output.push_str(&format!(
        "Everest 版本: {}\n",
        analysis
            .everest_version
            .map(|value| value.to_string())
            .unwrap_or_else(|| "未知".to_string())
    ));
    output.push_str(&format!(
        "EverestUltra: {}\n",
        if analysis.is_everest_ultra {
            "是"
        } else {
            "否"
        }
    ));
    output.push_str(&format!("异常: {}\n", analysis.exception));
    output.push_str(&format!("结论: {}\n\n", analysis.summary));

    output.push_str("可能原因:\n");
    for reason in &analysis.reasons {
        output.push_str(&format!("- {reason}\n"));
    }
    output.push_str("\n建议:\n");
    for suggestion in &analysis.suggestions {
        output.push_str(&format!("- {suggestion}\n"));
    }

    output.push_str("\n可能相关的 Mod:\n");
    if analysis.suspects.is_empty() {
        output.push_str("- 未从 stacktrace 中可靠识别到具体 Mod\n");
    } else {
        for suspect in &analysis.suspects {
            let update = if suspect.update_available {
                format!(
                    "，可更新到 {}",
                    suspect.latest_version.as_deref().unwrap_or("最新版")
                )
            } else {
                String::new()
            };
            output.push_str(&format!(
                "- {} {} (置信度 {}%，文件 {}{})\n  依据: {}\n",
                suspect.name,
                suspect.installed_version,
                suspect.confidence,
                suspect.file,
                update,
                suspect.evidence
            ));
            if !suspect.dependents.is_empty() {
                output.push_str(&format!(
                    "  被这些 Mod 依赖: {}\n",
                    suspect
                        .dependents
                        .iter()
                        .map(|item| if item.optional {
                            format!("{} (可选)", item.name)
                        } else {
                            item.name.clone()
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
    }

    output.push_str("\n日志来源:\n");
    output.push_str(&format!("- 主日志: {}\n", analysis.source_log));
    output.push_str(&format!(
        "- 错误日志: {}\n",
        analysis.error_log.as_deref().unwrap_or("未找到")
    ));
    output.push_str("\n如果要向别人求助，请直接发送本 TXT 文件，并补充崩溃前正在做什么。\n");
    output.push_str("\n\n================ 主日志：最近一次崩溃片段 ================\n\n");
    output.push_str(log_excerpt);
    output.push_str("\n\n================ errorLog：最新内容 ================\n\n");
    output.push_str(error_log_text.unwrap_or("未找到 errorLog.txt / error_log.txt。"));
    output
}

pub fn analyze_latest_crash(game_path: &str) -> anyhow::Result<Option<CrashAnalysis>> {
    let game_path = Path::new(game_path);
    let records = collect_log_candidates(game_path);
    let error_log = latest_error_log(game_path);
    let latest_log = records.into_iter().max_by(|left, right| {
        left.modified_at
            .cmp(&right.modified_at)
            .then_with(|| left.inherent_crash_log.cmp(&right.inherent_crash_log))
            .then_with(|| left.crash_index.cmp(&right.crash_index))
    });
    let latest = match (latest_log, error_log.as_ref()) {
        (Some(log), Some((error_path, error_modified, error_text))) => {
            // A catastrophic crash updates errorLog immediately after log.txt. Keep
            // log.txt as the primary source when both timestamps describe the same
            // event, because it contains the Mod load context needed for diagnosis.
            let distance = log.modified_at.abs_diff(*error_modified);
            if distance <= 20 * 60 * 1000 || log.modified_at >= *error_modified {
                log
            } else {
                CrashRecord {
                    path: error_path.clone(),
                    modified_at: *error_modified,
                    crash_index: 1,
                    excerpt: error_text.clone(),
                    inherent_crash_log: true,
                }
            }
        }
        (Some(log), None) => log,
        (None, Some((error_path, error_modified, error_text))) => CrashRecord {
            path: error_path.clone(),
            modified_at: *error_modified,
            crash_index: 1,
            excerpt: error_text.clone(),
            inherent_crash_log: true,
        },
        (None, None) => return Ok(None),
    };

    // Wait for Everest to finish flushing the exception and stacktrace, and do
    // not notify about crashes that are already at least one hour old.
    if !should_analyze_crash(latest.modified_at, now_millis()) {
        return Ok(None);
    }

    let fingerprint = format!("{}:{}", latest.crash_index, crash_signature(&latest),);
    let event_id = crash_event_id(&latest);
    let normalized_game_path = game_path.to_string_lossy().to_string();
    if let Some(cached) = ANALYSIS_CACHE.lock().unwrap().as_ref()
        && cached.game_path == normalized_game_path
        && cached.fingerprint == fingerprint
        && Path::new(&cached.analysis.report_path).is_file()
    {
        return Ok(Some(cached.analysis.clone()));
    }

    let (error_path, error_text) = error_log
        .as_ref()
        .map(|(path, _, text)| {
            (
                Some(path.to_string_lossy().to_string()),
                Some(text.as_str()),
            )
        })
        .unwrap_or((None, None));
    let error_for_analysis = error_log
        .as_ref()
        .filter(|(_, modified, _)| latest.modified_at.abs_diff(*modified) <= 20 * 60 * 1000)
        .map(|(_, _, text)| text.as_str())
        .unwrap_or_default();
    let combined_for_analysis = format!("{}\n{}", latest.excerpt, error_for_analysis);
    let crash_body = latest_crash_body(&combined_for_analysis);
    let suspects = analyze_suspects(game_path, &crash_body);
    let ultra = is_everest_ultra(game_path, &combined_for_analysis);
    let (summary, reasons, mut suggestions) = reason_analysis(&crash_body, &suspects);
    if ultra
        && (crash_body.contains("ILHookTransaction")
            || crash_body.contains("Parallel startup scheduler"))
        && !suggestions
            .iter()
            .any(|suggestion| suggestion.contains("Legacy Loader"))
    {
        suggestions.push(
            "可使用 Legacy Loader 重启一次，排除 EverestUltra 加速加载器的兼容问题。".to_string(),
        );
    }
    let everest_version = everest::get_everest_version(&normalized_game_path);
    let source_log = latest.path.to_string_lossy().to_string();
    let mut analysis = CrashAnalysis {
        fingerprint: fingerprint.clone(),
        event_id,
        crash_index: latest.crash_index,
        log_modified_at: latest.modified_at,
        source_log,
        error_log: error_path,
        report_path: String::new(),
        exception: exception_line(&crash_body),
        summary,
        reasons,
        suggestions,
        suspects,
        everest_version,
        is_everest_ultra: ultra,
        excerpt: latest.excerpt.chars().take(40_000).collect(),
    };

    let report_dir = report_directory()?;
    fs::create_dir_all(&report_dir)?;
    let report_path = report_dir.join(format!(
        "CeleMod-Crash-{}-{}.txt",
        latest.modified_at, latest.crash_index
    ));
    analysis.report_path = report_path.to_string_lossy().to_string();
    fs::write(
        &report_path,
        report_text(&analysis, &latest.excerpt, error_text),
    )
    .with_context(|| format!("Failed to write {}", report_path.display()))?;

    *ANALYSIS_CACHE.lock().unwrap() = Some(CachedAnalysis {
        game_path: normalized_game_path,
        fingerprint,
        analysis: analysis.clone(),
    });
    Ok(Some(analysis))
}

pub fn reveal_report(path: &str) -> anyhow::Result<()> {
    let path = Path::new(path);
    if !path.is_file() {
        bail!("Crash report does not exist");
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        open::that(path.parent().unwrap_or(path))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("celemod-crash-{name}-{unique}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn finds_latest_crash_and_its_sequence() {
        let root = test_dir("scan");
        let log = root.join("log.txt");
        fs::write(
            &log,
            "before\nENCOUNTERED A CRITICAL ERROR\nSystem.Exception: first\nafter\nENCOUNTERED A CRITICAL ERROR\nSystem.OutOfMemoryException: second\n  at Test.Mod.Run()\n",
        )
        .unwrap();
        let record = scan_log(&log, false).unwrap();
        assert_eq!(record.crash_index, 2);
        assert!(record.excerpt.contains("OutOfMemoryException"));
        assert!(latest_crash_body(&record.excerpt).contains("OutOfMemoryException"));
        assert!(!latest_crash_body(&record.excerpt).contains("System.Exception: first"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_analyzes_recent_settled_crashes() {
        let now = 10 * MAX_CRASH_AGE_MILLIS;
        assert!(!should_analyze_crash(now - LOG_SETTLE_MILLIS + 1, now));
        assert!(should_analyze_crash(now - LOG_SETTLE_MILLIS, now));
        assert!(should_analyze_crash(now - MAX_CRASH_AGE_MILLIS + 1, now));
        assert!(!should_analyze_crash(now - MAX_CRASH_AGE_MILLIS, now));
    }

    #[test]
    fn recognizes_common_memory_failure() {
        let (summary, reasons, suggestions) = reason_analysis("System.OutOfMemoryException", &[]);
        assert_eq!(summary, "资源不足导致崩溃");
        assert!(!reasons.is_empty());
        assert!(!suggestions.is_empty());
    }

    #[test]
    fn compares_loose_mod_versions_without_panicking() {
        assert!(version_is_newer("1.10.0-beta.2", "1.9.8"));
        assert!(!version_is_newer("1.9.8", "1.10.0-beta.2"));
        assert!(!version_is_newer("v2.0", "2.0.0"));
    }

    #[test]
    fn crash_signature_survives_log_rotation() {
        let excerpt = "(01/01/2026) [Everest] [Error] [crit-error-handler] ENCOUNTERED A CRITICAL ERROR\nSystem.Exception: boom\n   at Example.Mod.Run()".to_string();
        let first = CrashRecord {
            path: PathBuf::from("log.txt"),
            modified_at: 1,
            crash_index: 1,
            excerpt: excerpt.clone(),
            inherent_crash_log: false,
        };
        let rotated = CrashRecord {
            path: PathBuf::from("LogHistory/log_20260101_000000.txt"),
            modified_at: 2,
            crash_index: 1,
            excerpt,
            inherent_crash_log: false,
        };
        assert_eq!(crash_signature(&first), crash_signature(&rotated));
        assert_eq!(crash_event_id(&first), crash_event_id(&rotated));
    }

    #[test]
    fn crash_event_id_stays_stable_while_stacktrace_is_flushed() {
        let partial = CrashRecord {
            path: PathBuf::from("log.txt"),
            modified_at: 1,
            crash_index: 3,
            excerpt: "(08/07/2026 12:34:56) [Everest] [Error] [crit-error-handler] ENCOUNTERED A CRITICAL ERROR\nSystem.Exception: Failed loading startup mod RushHelper 1.1.1".to_string(),
            inherent_crash_log: false,
        };
        let complete = CrashRecord {
            path: PathBuf::from("log.txt"),
            modified_at: 2,
            crash_index: 3,
            excerpt: format!(
                "{}\nSystem.Collections.Generic.KeyNotFoundException\n  at Celeste.Mod.RushHelper.PlayerExtensions.Load()",
                partial.excerpt
            ),
            inherent_crash_log: false,
        };
        assert_ne!(crash_signature(&partial), crash_signature(&complete));
        assert_eq!(crash_event_id(&partial), crash_event_id(&complete));
    }

    #[test]
    fn startup_mod_failure_outranks_framework_stack_frames() {
        let text = "System.Exception: Failed loading startup mod RushHelper 1.1.1\n\
            at Celeste.Mod.MaxHelpingHand.Module.MaxHelpingHandModule.onModRegister()\n\
            at Celeste.Mod.RushHelper.PlayerExtensions.Load()";
        let rush = find_evidence(text, &["RushHelper".to_string()]).unwrap();
        let helping_hand = find_evidence(text, &["MaxHelpingHand".to_string()]).unwrap();
        assert_eq!(rush.0, 100);
        assert_eq!(helping_hand.0, 96);
        assert!(rush.1.contains("Failed loading startup mod RushHelper"));
    }

    #[test]
    fn analysis_keeps_explicit_startup_mod_as_top_suspect() {
        let root = test_dir("rush-helper");
        for (name, version) in [("RushHelper", "1.1.1"), ("MaxHelpingHand", "1.0.0")] {
            let directory = root.join("Mods").join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("everest.yaml"),
                format!("- Name: {name}\n  Version: {version}\n  DLL: {name}.dll\n"),
            )
            .unwrap();
        }
        let text = "System.Exception: Failed loading startup mod RushHelper 1.1.1\n\
            at Celeste.Mod.MaxHelpingHand.Module.MaxHelpingHandModule.onModRegister()\n\
            at Celeste.Mod.RushHelper.PlayerExtensions.Load()";
        let suspects = analyze_suspects(&root, text);
        assert_eq!(
            suspects.first().map(|suspect| suspect.name.as_str()),
            Some("RushHelper")
        );
        assert_eq!(
            suspects.first().map(|suspect| suspect.confidence),
            Some(100)
        );
        assert!(
            suspects
                .iter()
                .any(|suspect| suspect.name == "MaxHelpingHand")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_regular_il_cursor_hook_mismatch() {
        let suspect = CrashSuspect {
            name: "RushHelper".to_string(),
            file: "RushHelper.zip".to_string(),
            installed_version: "1.1.1".to_string(),
            latest_version: None,
            game_banana_file_id: None,
            download_url: None,
            update_available: false,
            confidence: 100,
            evidence: "Failed loading startup mod RushHelper".to_string(),
            dependents: Vec::new(),
        };
        let (summary, reasons, suggestions) = reason_analysis(
            "MonoMod.Cil.ILCursor.GotoNext\nMonoMod.Cil.ILContext.Invoke\nCeleste.Mod.RushHelper.PlayerExtensions.Load",
            &[suspect],
        );
        assert_eq!(summary, "Mod IL Hook 与当前 Loader 不兼容");
        assert!(reasons.iter().any(|reason| reason.contains("RushHelper")));
        assert!(
            suggestions
                .iter()
                .any(|suggestion| suggestion.contains("RushHelper"))
        );
    }

    #[test]
    fn recognizes_rush_helper_hardcoded_integer_opcode_failure() {
        let suspect = CrashSuspect {
            name: "RushHelper".to_string(),
            file: "RushHelper.zip".to_string(),
            installed_version: "1.1.1".to_string(),
            latest_version: None,
            game_banana_file_id: None,
            download_url: None,
            update_available: false,
            confidence: 100,
            evidence: "Failed loading startup mod RushHelper 1.1.1".to_string(),
            dependents: Vec::new(),
        };
        let (summary, reasons, suggestions) = reason_analysis(
            "MonoMod.Cil.ILCursor.GotoNext\nCeleste.Mod.RushHelper.PlayerExtensions.Player_BeforeDownTransition_il",
            &[suspect],
        );
        assert_eq!(summary, "RushHelper 1.1.x 使用了过于严格的 IL 匹配");
        assert!(reasons.iter().any(|reason| reason.contains("ldc.i4.5")));
        assert!(
            suggestions
                .iter()
                .any(|suggestion| suggestion.contains("1.2.0"))
        );
    }

    #[test]
    fn keeps_only_the_newest_error_log_entry() {
        let log = "Ver 1.4.0.0-fna [Everest: 900007-ultra]\n08/04/2026 14:10:29\nSystem.Collections.Generic.KeyNotFoundException: newest\n   at Celeste.Mod.ChinaMirror.Run()\n\n\nVer 1.4.0.0-fna [Everest: 0-dev]\n08/04/2026 11:12:23\nSystem.AggregateException: older\n   at Old.Mod.Run()\n";
        let latest = extract_latest_error_section(log);
        assert!(latest.contains("KeyNotFoundException: newest"));
        assert!(latest.contains("ChinaMirror"));
        assert!(!latest.contains("AggregateException: older"));
        assert!(!latest.contains("Old.Mod"));
    }
}
