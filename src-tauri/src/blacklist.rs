use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};

use super::get_installed_mods_sync;

const PROFILE_DIRECTORY: &str = "celemod_blacklist_profiles";
const PROFILE_FORMAT: &str = "celemod-profile";
const PROFILE_VERSION: u8 = 2;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ModBlacklistProfile {
    pub name: String,
    #[serde(default)]
    pub enabled_mods: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_deps: bool,
}

#[derive(Debug, Serialize)]
pub struct ProfileImportResult {
    pub profiles: Vec<ModBlacklistProfile>,
    pub missing_mods: Vec<String>,
    pub missing_files: Vec<String>,
}

#[derive(Serialize)]
struct ExportedProfile<'a> {
    format: &'static str,
    version: u8,
    #[serde(skip_serializing_if = "is_false")]
    auto_deps: bool,
    #[serde(flatten)]
    profile: &'a ModBlacklistProfile,
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn validate_profile_name(profile_name: &str) -> anyhow::Result<()> {
    let invalid_windows_chars = ['<', '>', ':', '"', '|', '?', '*'];
    if profile_name.is_empty()
        || profile_name.len() > 128
        || profile_name == "."
        || profile_name == ".."
        || profile_name != profile_name.trim()
        || profile_name
            .chars()
            .any(|character| character.is_control() || character == '/' || character == '\\')
        || profile_name
            .chars()
            .any(|character| invalid_windows_chars.contains(&character))
    {
        bail!("Invalid profile name");
    }
    Ok(())
}

fn profiles_directory(game_path: &str) -> PathBuf {
    Path::new(game_path).join(PROFILE_DIRECTORY)
}

fn profile_path(game_path: &str, profile_name: &str) -> anyhow::Result<PathBuf> {
    validate_profile_name(profile_name)?;
    Ok(profiles_directory(game_path).join(format!("{profile_name}.json")))
}

fn normalize_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut names = names
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    names.sort_unstable_by_key(|name| name.to_ascii_lowercase());
    names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    names
}

fn installed_mod_names(game_path: &str) -> Vec<String> {
    normalize_names(
        get_installed_mods_sync(format!("{game_path}/Mods"))
            .into_iter()
            .map(|mod_info| mod_info.name),
    )
}

fn direct_blacklisted_files(game_path: &str) -> HashSet<String> {
    fs::read_to_string(Path::new(game_path).join("Mods").join("blacklist.txt"))
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.to_ascii_lowercase())
        .collect()
}

fn profile_from_legacy_value(
    value: &serde_json::Value,
    installed: &[super::LocalMod],
) -> anyhow::Result<ModBlacklistProfile> {
    let object = value.as_object().context("Profile must be a JSON object")?;
    let name = object
        .get("name")
        .and_then(serde_json::Value::as_str)
        .context("Profile is missing a name")?
        .to_owned();
    validate_profile_name(&name)?;
    let auto_deps = object
        .get("auto_deps")
        .or_else(|| object.get("autoDeps"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    if let Some(enabled_mods) = object
        .get("enabled_mods")
        .or_else(|| object.get("enabledMods"))
        .and_then(serde_json::Value::as_array)
    {
        return Ok(ModBlacklistProfile {
            name,
            enabled_mods: normalize_names(
                enabled_mods
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_owned),
            ),
            auto_deps,
        });
    }

    let disabled_names = object
        .get("mods")
        .and_then(serde_json::Value::as_array)
        .map(|mods| {
            mods.iter()
                .filter_map(serde_json::Value::as_object)
                .filter_map(|mod_info| mod_info.get("name").and_then(serde_json::Value::as_str))
                .map(|name| name.to_ascii_lowercase())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let disabled_files = object
        .get("mods")
        .and_then(serde_json::Value::as_array)
        .map(|mods| {
            mods.iter()
                .filter_map(serde_json::Value::as_object)
                .filter_map(|mod_info| mod_info.get("file").and_then(serde_json::Value::as_str))
                .map(|file| file.to_ascii_lowercase())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    Ok(ModBlacklistProfile {
        name,
        enabled_mods: normalize_names(
            installed
                .iter()
                .filter(|mod_info| {
                    !disabled_names.contains(&mod_info.name.to_ascii_lowercase())
                        && !disabled_files.contains(&mod_info.file.to_ascii_lowercase())
                })
                .map(|mod_info| mod_info.name.clone()),
        ),
        auto_deps,
    })
}

fn write_profile(game_path: &str, profile: &ModBlacklistProfile) -> anyhow::Result<()> {
    validate_profile_name(&profile.name)?;
    fs::create_dir_all(profiles_directory(game_path))?;
    fs::write(
        profile_path(game_path, &profile.name)?,
        serialize_profile(profile)?,
    )?;
    Ok(())
}

fn serialize_profile(profile: &ModBlacklistProfile) -> anyhow::Result<String> {
    let profile = ModBlacklistProfile {
        name: profile.name.clone(),
        enabled_mods: normalize_names(profile.enabled_mods.clone()),
        auto_deps: false,
    };
    Ok(serde_json::to_string_pretty(&ExportedProfile {
        format: PROFILE_FORMAT,
        version: PROFILE_VERSION,
        auto_deps: false,
        profile: &profile,
    })?)
}

fn parse_mod_list(contents: &str) -> Vec<String> {
    normalize_names(
        contents
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(str::to_owned),
    )
}

fn imported_profile_from_mod_list(
    contents: &str,
    default_name: &str,
) -> anyhow::Result<ModBlacklistProfile> {
    let enabled_mods = parse_mod_list(contents);
    if enabled_mods.is_empty() {
        bail!("No Mods found");
    }
    validate_profile_name(default_name)?;
    Ok(ModBlacklistProfile {
        name: default_name.to_owned(),
        enabled_mods,
        auto_deps: false,
    })
}

/// Loads profile files and rewrites every pre-v2 JSON profile in the v2 format.
/// This makes migration happen during the first profile load at startup.
pub fn get_mod_blacklist_profiles(game_path: &str) -> Vec<ModBlacklistProfile> {
    let directory = profiles_directory(game_path);
    if fs::create_dir_all(&directory).is_err() {
        return Vec::new();
    }
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let mut profiles = Vec::new();
    let mut names = HashSet::new();
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => return profiles,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let Ok(profile) = profile_from_legacy_value(&value, &installed) else {
            continue;
        };

        if !names.insert(profile.name.to_ascii_lowercase()) {
            continue;
        }
        let is_v2 = value.get("format").and_then(serde_json::Value::as_str) == Some(PROFILE_FORMAT)
            && value.get("version").and_then(serde_json::Value::as_u64)
                == Some(PROFILE_VERSION.into());
        if !is_v2 {
            let _ = write_profile(game_path, &profile);
            if path != profile_path(game_path, &profile.name).unwrap_or_default() {
                let _ = fs::remove_file(path);
            }
        }
        profiles.push(profile);
    }

    profiles.sort_unstable_by_key(|profile| profile.name.to_ascii_lowercase());
    profiles
}
fn expand_installed_dependencies(
    installed: &[super::LocalMod],
    selected_names: &[String],
) -> Vec<String> {
    let by_name = installed
        .iter()
        .map(|mod_info| (mod_info.name.to_ascii_lowercase(), mod_info))
        .collect::<HashMap<_, _>>();
    let mut expanded = normalize_names(selected_names.iter().cloned());
    let mut visited = HashSet::new();
    let mut index = 0;
    while index < expanded.len() {
        let name = expanded[index].clone();
        index += 1;
        if !visited.insert(name.to_ascii_lowercase()) {
            continue;
        }
        let Some(mod_info) = by_name.get(&name.to_ascii_lowercase()) else {
            continue;
        };
        expanded.extend(
            mod_info
                .deps
                .iter()
                .filter(|dependency| {
                    !dependency.optional
                        && !matches!(
                            dependency.name.to_ascii_lowercase().as_str(),
                            "celeste" | "everest" | "everestcore"
                        )
                })
                .map(|dependency| dependency.name.clone()),
        );
        expanded = normalize_names(expanded);
    }
    expanded
}

pub fn get_blacklist_profile_count(game_path: &str) -> usize {
    let directory = profiles_directory(game_path);
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "json")
        })
        .count()
}

fn resolve_selected_names(
    installed: &[super::LocalMod],
    selected_names: impl IntoIterator<Item = String>,
) -> HashSet<String> {
    let requested = selected_names
        .into_iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let selected_files = installed
        .iter()
        .filter(|mod_info| requested.contains(&mod_info.name.to_ascii_lowercase()))
        .map(|mod_info| mod_info.file.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    installed
        .iter()
        .filter(|mod_info| selected_files.contains(&mod_info.file.to_ascii_lowercase()))
        .map(|mod_info| mod_info.name.clone())
        .collect()
}

pub fn apply_mod_blacklist_profiles(
    game_path: &str,
    profile_names: &[String],
    always_on_mods: &[String],
) -> anyhow::Result<Vec<String>> {
    let profiles = get_mod_blacklist_profiles(game_path);
    let requested_names = normalize_names(profile_names.iter().cloned());
    let requested = requested_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    if requested.len() != requested_names.len()
        || !requested.iter().all(|name| {
            profiles
                .iter()
                .any(|profile| profile.name.eq_ignore_ascii_case(name))
        })
    {
        bail!("Profile not found");
    }

    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let profile_enabled = profiles
        .iter()
        .filter(|profile| requested.contains(&profile.name.to_ascii_lowercase()))
        .flat_map(|profile| profile.enabled_mods.iter().cloned());
    let enabled_names = resolve_selected_names(
        &installed,
        profile_enabled.chain(always_on_mods.iter().cloned()),
    );
    let enabled_files = installed
        .iter()
        .filter(|mod_info| enabled_names.contains(&mod_info.name))
        .map(|mod_info| mod_info.file.clone())
        .collect::<HashSet<_>>();
    let blacklist_files = installed
        .iter()
        .map(|mod_info| mod_info.file.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|file| !enabled_files.contains(file))
        .collect::<Vec<_>>();

    let header = serde_json::to_string(&requested_names)?;
    fs::write(
        Path::new(game_path).join("Mods").join("blacklist.txt"),
        format!(
            "# Profiles: {header}\n# This file is generated by CeleMod\n\n{}\n",
            blacklist_files.join("\n")
        ),
    )?;
    Ok(normalize_names(enabled_names))
}

pub fn get_current_profiles(game_path: &str) -> Vec<String> {
    let profiles = get_mod_blacklist_profiles(game_path);
    let profile_names = fs::read_to_string(Path::new(game_path).join("Mods").join("blacklist.txt"))
        .ok()
        .and_then(|contents| {
            let header = contents.lines().next()?.trim();
            if let Some(value) = header.strip_prefix("# Profiles: ") {
                serde_json::from_str::<Vec<String>>(value).ok()
            } else {
                header
                    .strip_prefix("# Profile: ")
                    .map(|name| vec![name.to_owned()])
            }
        })
        .unwrap_or_default();
    let valid_names = profile_names
        .into_iter()
        .filter(|name| profiles.iter().any(|profile| profile.name == *name))
        .collect::<Vec<_>>();
    if valid_names.is_empty() {
        profiles
            .first()
            .map(|profile| vec![profile.name.clone()])
            .unwrap_or_default()
    } else {
        valid_names
    }
}

pub fn get_current_profile(game_path: &str) -> anyhow::Result<String> {
    Ok(get_current_profiles(game_path)
        .into_iter()
        .next()
        .unwrap_or_else(|| "Default".to_string()))
}

pub fn get_active_profile_mods(game_path: &str, always_on_mods: &[String]) -> Vec<String> {
    let profiles = get_current_profiles(game_path);
    let all_profiles = get_mod_blacklist_profiles(game_path);
    let selected = all_profiles
        .iter()
        .filter(|profile| profiles.contains(&profile.name))
        .flat_map(|profile| profile.enabled_mods.iter().cloned())
        .chain(always_on_mods.iter().cloned());
    resolve_selected_names(
        &get_installed_mods_sync(format!("{game_path}/Mods")),
        selected,
    )
    .into_iter()
    .collect()
}

pub fn get_direct_blacklist_profile(game_path: &str) -> anyhow::Result<ModBlacklistProfile> {
    let blacklisted = direct_blacklisted_files(game_path);
    Ok(ModBlacklistProfile {
        name: "blacklist.txt".to_string(),
        enabled_mods: normalize_names(
            get_installed_mods_sync(format!("{game_path}/Mods"))
                .into_iter()
                .filter(|mod_info| !blacklisted.contains(&mod_info.file.to_ascii_lowercase()))
                .map(|mod_info| mod_info.name),
        ),
        auto_deps: false,
    })
}

pub fn switch_direct_blacklist(
    game_path: &str,
    mod_files: &[String],
    enabled: bool,
) -> anyhow::Result<()> {
    let path = Path::new(game_path).join("Mods").join("blacklist.txt");
    let mut lines = fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if enabled {
        lines.retain(|line| {
            let file = line.trim();
            file.is_empty()
                || file.starts_with('#')
                || !mod_files
                    .iter()
                    .any(|target| file.eq_ignore_ascii_case(target))
        });
    } else {
        for file in mod_files {
            if !lines
                .iter()
                .any(|line| line.trim().eq_ignore_ascii_case(file))
            {
                lines.push(file.clone());
            }
        }
    }
    fs::write(
        path,
        lines.join("\n") + if lines.is_empty() { "" } else { "\n" },
    )?;
    Ok(())
}

pub fn switch_mod_profile_mods(
    game_path: &str,
    profile_name: &str,
    mod_names: &[String],
    enabled: bool,
) -> anyhow::Result<()> {
    let mut profile = get_mod_blacklist_profiles(game_path)
        .into_iter()
        .find(|profile| profile.name == profile_name)
        .context("Profile not found")?;
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let package_names = resolve_selected_names(&installed, mod_names.iter().cloned());
    if enabled {
        profile.enabled_mods =
            normalize_names(profile.enabled_mods.into_iter().chain(package_names));
    } else {
        profile
            .enabled_mods
            .retain(|name| !package_names.contains(name));
    }
    write_profile(game_path, &profile)
}

pub fn expand_mod_profile_dependencies(game_path: &str, profile_name: &str) -> anyhow::Result<()> {
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let mut profile = get_mod_blacklist_profiles(game_path)
        .into_iter()
        .find(|profile| profile.name.eq_ignore_ascii_case(profile_name))
        .context("Profile not found")?;
    profile.enabled_mods = expand_installed_dependencies(&installed, &profile.enabled_mods);
    profile.auto_deps = false;
    write_profile(game_path, &profile)
}

pub fn new_mod_blacklist_profile(game_path: &str, profile_name: &str) -> anyhow::Result<()> {
    validate_profile_name(profile_name)?;
    if get_mod_blacklist_profiles(game_path)
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(profile_name))
    {
        bail!("Profile already exists");
    }
    write_profile(
        game_path,
        &ModBlacklistProfile {
            name: profile_name.to_owned(),
            enabled_mods: Vec::new(),
            auto_deps: false,
        },
    )
}

fn rename_active_profile_header(
    game_path: &str,
    old_name: &str,
    new_name: &str,
) -> anyhow::Result<()> {
    let path = Path::new(game_path).join("Mods").join("blacklist.txt");
    let Ok(contents) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let Some((header, rest)) = contents.split_once('\n') else {
        return Ok(());
    };
    let Some(value) = header.trim().strip_prefix("# Profiles: ") else {
        return Ok(());
    };
    let Ok(mut names) = serde_json::from_str::<Vec<String>>(value) else {
        return Ok(());
    };
    let mut changed = false;
    for name in &mut names {
        if name.eq_ignore_ascii_case(old_name) {
            *name = new_name.to_string();
            changed = true;
        }
    }
    if changed {
        fs::write(
            path,
            format!("# Profiles: {}\n{rest}", serde_json::to_string(&names)?),
        )?;
    }
    Ok(())
}

pub fn rename_mod_blacklist_profile(
    game_path: &str,
    old_name: &str,
    new_name: &str,
) -> anyhow::Result<()> {
    validate_profile_name(new_name)?;
    let profiles = get_mod_blacklist_profiles(game_path);
    let source = profiles
        .iter()
        .find(|profile| profile.name.eq_ignore_ascii_case(old_name))
        .context("Profile not found")?;
    if source.name == new_name {
        return Ok(());
    }
    if profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(new_name) && profile.name != source.name)
    {
        bail!("Profile already exists");
    }

    let source_path = profile_path(game_path, &source.name)?;
    let destination_path = profile_path(game_path, new_name)?;
    let renamed = ModBlacklistProfile {
        name: new_name.to_string(),
        enabled_mods: source.enabled_mods.clone(),
        auto_deps: false,
    };
    let renamed_contents = serialize_profile(&renamed)?;
    if source.name.eq_ignore_ascii_case(new_name) {
        let temporary = profiles_directory(game_path).join(format!(
            ".celemod-profile-rename-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::write(&temporary, renamed_contents)?;
        fs::remove_file(&source_path)?;
        if let Err(error) = fs::rename(&temporary, &destination_path) {
            let _ = fs::write(&source_path, serialize_profile(source)?);
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
    } else {
        if destination_path.exists() {
            bail!("Profile already exists");
        }
        fs::write(&destination_path, renamed_contents)?;
        if let Err(error) = fs::remove_file(&source_path) {
            let _ = fs::remove_file(&destination_path);
            return Err(error.into());
        }
    }
    rename_active_profile_header(game_path, &source.name, new_name)
}

pub fn remove_mod_blacklist_profile(game_path: &str, profile_name: &str) -> anyhow::Result<()> {
    fs::remove_file(profile_path(game_path, profile_name)?)?;
    Ok(())
}

/// Replacing an archive never changes v2 profile files because they store only
/// stable Mod names. The active profile is re-applied to discover its new file.
pub fn update_blacklist_mod_file(
    game_path: &str,
    _mod_name: &str,
    old_file: &str,
    new_file: &str,
    profile_enabled: bool,
    always_on_mods: &[String],
) -> anyhow::Result<()> {
    if old_file == new_file || profile_enabled {
        if profile_enabled {
            let profiles = get_current_profiles(game_path);
            apply_mod_blacklist_profiles(game_path, &profiles, always_on_mods)?;
        }
        return Ok(());
    }
    let path = Path::new(game_path).join("Mods").join("blacklist.txt");
    let contents = fs::read_to_string(&path).unwrap_or_default();
    let mut seen_new_file = false;
    let lines = contents
        .lines()
        .filter_map(|line| {
            if !line.trim().eq_ignore_ascii_case(old_file) {
                return Some(line.to_owned());
            }
            if seen_new_file {
                None
            } else {
                seen_new_file = true;
                Some(new_file.to_owned())
            }
        })
        .collect::<Vec<_>>();
    fs::write(
        path,
        lines.join("\n") + if lines.is_empty() { "" } else { "\n" },
    )?;
    Ok(())
}

fn parse_olympus_presets(
    game_path: &str,
    contents: &str,
) -> anyhow::Result<(Vec<ModBlacklistProfile>, Vec<String>)> {
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let mut names_by_file: HashMap<String, Vec<String>> = HashMap::new();
    for mod_info in installed {
        names_by_file
            .entry(mod_info.file.to_ascii_lowercase())
            .or_default()
            .push(mod_info.name);
    }
    let mut profiles = Vec::new();
    let mut missing_files = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_files = Vec::new();
    let finish = |name: Option<String>,
                  files: &mut Vec<String>,
                  profiles: &mut Vec<ModBlacklistProfile>,
                  missing: &mut Vec<String>|
     -> anyhow::Result<()> {
        let Some(name) = name else { return Ok(()) };
        validate_profile_name(&name)?;
        let mut enabled_mods = Vec::new();
        for file in files.drain(..) {
            if let Some(names) = names_by_file.get(&file.to_ascii_lowercase()) {
                enabled_mods.extend(names.iter().cloned());
            } else {
                missing.push(file.clone());
                enabled_mods.push(file);
            }
        }
        profiles.push(ModBlacklistProfile {
            name,
            enabled_mods: normalize_names(enabled_mods),
            auto_deps: false,
        });
        Ok(())
    };
    for line in contents.lines() {
        if let Some(name) = line.strip_prefix("**") {
            finish(
                current_name.take(),
                &mut current_files,
                &mut profiles,
                &mut missing_files,
            )?;
            current_name = Some(name.trim().to_owned());
        } else if current_name.is_some() {
            let file = line.trim();
            if !file.is_empty() && !file.starts_with('#') {
                current_files.push(file.to_owned());
            }
        }
    }
    finish(
        current_name,
        &mut current_files,
        &mut profiles,
        &mut missing_files,
    )?;
    if profiles.is_empty() {
        bail!("No Olympus presets found");
    }
    Ok((profiles, normalize_names(missing_files)))
}

pub fn get_olympus_presets(game_path: &str) -> anyhow::Result<Vec<ModBlacklistProfile>> {
    let path = Path::new(game_path).join("Mods").join("modpresets.txt");
    let contents = fs::read_to_string(path).context("Olympus modpresets.txt was not found")?;
    Ok(parse_olympus_presets(game_path, &contents)?.0)
}

pub fn preview_olympus_profiles(
    game_path: &str,
    selected_names: &[String],
) -> anyhow::Result<ProfileImportResult> {
    let path = Path::new(game_path).join("Mods").join("modpresets.txt");
    let contents = fs::read_to_string(path).context("Olympus modpresets.txt was not found")?;
    let (profiles, _) = parse_olympus_presets(game_path, &contents)?;
    let selected = selected_names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let profiles = profiles
        .into_iter()
        .filter(|profile| selected.contains(&profile.name.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    if profiles.is_empty() {
        bail!("No Olympus presets were selected");
    }
    let missing_files = profiles
        .iter()
        .flat_map(|profile| profile.enabled_mods.iter().cloned())
        .filter(|name| name.to_ascii_lowercase().ends_with(".zip"))
        .collect::<Vec<_>>();
    preview_profile_import(game_path, profiles, missing_files)
}

pub fn preview_mod_profiles(
    game_path: &str,
    source_path: &str,
) -> anyhow::Result<ProfileImportResult> {
    let contents = fs::read_to_string(source_path).context("Failed to read profile file")?;
    let trimmed = contents.trim_start();
    if trimmed.starts_with("**") || source_path.ends_with("modpresets.txt") {
        let (profiles, missing_files) = parse_olympus_presets(game_path, &contents)?;
        return preview_profile_import(game_path, profiles, missing_files);
    }
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        let name = Path::new(source_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("Imported");
        return preview_profile_import(
            game_path,
            vec![imported_profile_from_mod_list(&contents, name)?],
            Vec::new(),
        );
    }
    preview_mod_profiles_json(game_path, &contents)
}

fn preview_profile_import(
    game_path: &str,
    profiles: Vec<ModBlacklistProfile>,
    missing_files: Vec<String>,
) -> anyhow::Result<ProfileImportResult> {
    let imported_names = profiles
        .iter()
        .flat_map(|profile| profile.enabled_mods.iter().cloned())
        .collect::<Vec<_>>();
    let installed_names = installed_mod_names(game_path)
        .into_iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    Ok(ProfileImportResult {
        profiles,
        missing_mods: normalize_names(imported_names)
            .into_iter()
            .filter(|name| !installed_names.contains(&name.to_ascii_lowercase()))
            .collect(),
        missing_files,
    })
}

pub fn preview_mod_profiles_json(
    game_path: &str,
    contents: &str,
) -> anyhow::Result<ProfileImportResult> {
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let value: serde_json::Value =
        serde_json::from_str(contents).context("Invalid profile JSON")?;
    let values = value
        .get("profiles")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_else(|| vec![value]);
    let mut profiles = values
        .iter()
        .map(|value| profile_from_legacy_value(value, &installed))
        .collect::<anyhow::Result<Vec<_>>>()?;
    if profiles.is_empty() {
        bail!("No profiles found");
    }
    for profile in &mut profiles {
        if profile.auto_deps {
            profile.enabled_mods = expand_installed_dependencies(&installed, &profile.enabled_mods);
        }
    }
    preview_profile_import(game_path, profiles, Vec::new())
}

pub fn commit_profile_import(
    game_path: &str,
    profiles: Vec<ModBlacklistProfile>,
) -> anyhow::Result<ProfileImportResult> {
    let installed = get_installed_mods_sync(format!("{game_path}/Mods"));
    let profiles = profiles
        .into_iter()
        .map(|mut profile| {
            validate_profile_name(&profile.name)?;
            if profile.auto_deps {
                profile.enabled_mods =
                    expand_installed_dependencies(&installed, &profile.enabled_mods);
            }
            profile.enabled_mods = normalize_names(profile.enabled_mods);
            profile.auto_deps = false;
            Ok(profile)
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let directory = profiles_directory(game_path);
    fs::create_dir_all(&directory)?;
    let transaction = directory.join(format!(".import-{}", std::process::id()));
    fs::remove_dir_all(&transaction).ok();
    fs::create_dir_all(&transaction)?;
    let result: anyhow::Result<()> = (|| {
        for profile in &profiles {
            let contents = serde_json::to_string_pretty(&ExportedProfile {
                format: PROFILE_FORMAT,
                version: PROFILE_VERSION,
                auto_deps: false,
                profile,
            })?;
            fs::write(transaction.join(format!("{}.json", profile.name)), contents)?;
        }
        for profile in &profiles {
            let source = transaction.join(format!("{}.json", profile.name));
            let destination = profile_path(game_path, &profile.name)?;
            fs::rename(source, destination)?;
        }
        Ok(())
    })();
    fs::remove_dir_all(transaction).ok();
    result?;
    preview_profile_import(game_path, profiles, Vec::new())
}

pub fn export_mod_profile(
    game_path: &str,
    profile_name: &str,
    destination: &str,
    enabled_mods: Option<Vec<String>>,
    auto_deps: bool,
) -> anyhow::Result<()> {
    let mut profile = get_mod_blacklist_profiles(game_path)
        .into_iter()
        .find(|profile| profile.name == profile_name)
        .context("Profile not found")?;
    if let Some(enabled_mods) = enabled_mods {
        profile.enabled_mods = normalize_names(enabled_mods);
    }
    profile.auto_deps = false;
    fs::write(
        destination,
        serde_json::to_string_pretty(&ExportedProfile {
            format: PROFILE_FORMAT,
            version: PROFILE_VERSION,
            auto_deps,
            profile: &profile,
        })?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_game_path(name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "celemod-profile-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(path.join("Mods")).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn accepts_human_readable_profile_names() {
        assert!(validate_profile_name("Default").is_ok());
        assert!(validate_profile_name("周末联机 (2)").is_ok());
    }

    #[test]
    fn rejects_profile_path_traversal_and_invalid_names() {
        for name in [
            "",
            ".",
            "..",
            "../outside",
            "folder/name",
            "folder\\name",
            " Cfg",
            "Cfg ",
        ] {
            assert!(validate_profile_name(name).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn permits_deleting_the_final_profile() {
        let game_path = test_game_path("delete-final");
        new_mod_blacklist_profile(&game_path, "Only").unwrap();
        remove_mod_blacklist_profile(&game_path, "Only").unwrap();
        assert!(get_mod_blacklist_profiles(&game_path).is_empty());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn renames_profile_and_keeps_it_active() {
        let game_path = test_game_path("rename-profile");
        new_mod_blacklist_profile(&game_path, "Old Name").unwrap();
        apply_mod_blacklist_profiles(&game_path, &["Old Name".to_string()], &[]).unwrap();

        rename_mod_blacklist_profile(&game_path, "Old Name", "New Name").unwrap();

        assert!(
            !profiles_directory(&game_path)
                .join("Old Name.json")
                .exists()
        );
        assert!(
            profiles_directory(&game_path)
                .join("New Name.json")
                .exists()
        );
        assert_eq!(get_current_profiles(&game_path), ["New Name"]);
        assert_eq!(get_mod_blacklist_profiles(&game_path)[0].name, "New Name");
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn migration_rewrites_legacy_profile_as_enabled_names() {
        let game_path = test_game_path("migration");
        let directory = profiles_directory(&game_path);
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("Legacy.json"),
            r#"{"name":"Legacy","mods":[{"name":"Disabled.Mod","file":"Disabled.zip"}],"mod_options_order":["Disabled.zip"]}"#,
        )
        .unwrap();
        let profiles = get_mod_blacklist_profiles(&game_path);
        assert_eq!(profiles[0].name, "Legacy");
        assert!(profiles[0].enabled_mods.is_empty());
        let rewritten: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.join("Legacy.json")).unwrap())
                .unwrap();
        assert_eq!(rewritten["version"], PROFILE_VERSION);
        assert!(rewritten.get("mods").is_none());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn previewing_selected_olympus_presets_does_not_persist_them() {
        let game_path = test_game_path("olympus-selection");
        fs::write(
            Path::new(&game_path).join("Mods/modpresets.txt"),
            "**First\nMissingOne.zip\n**Second\nMissingTwo.zip\n",
        )
        .unwrap();
        let preview = preview_olympus_profiles(&game_path, &["Second".to_string()]).unwrap();
        assert_eq!(preview.profiles.len(), 1);
        assert_eq!(preview.profiles[0].name, "Second");
        assert_eq!(preview.profiles[0].enabled_mods, ["MissingTwo.zip"]);
        assert_eq!(preview.missing_files, ["MissingTwo.zip"]);
        assert!(!profiles_directory(&game_path).join("Second.json").exists());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn applying_multiple_profiles_records_all_selected_profiles() {
        let game_path = test_game_path("union");
        let first = ModBlacklistProfile {
            name: "First".to_string(),
            enabled_mods: vec!["One".to_string()],
            auto_deps: false,
        };
        let second = ModBlacklistProfile {
            name: "Second".to_string(),
            enabled_mods: vec!["Two".to_string()],
            auto_deps: false,
        };
        write_profile(&game_path, &first).unwrap();
        write_profile(&game_path, &second).unwrap();
        let enabled = apply_mod_blacklist_profiles(
            &game_path,
            &["First".to_string(), "Second".to_string()],
            &[],
        )
        .unwrap();
        assert!(enabled.is_empty());
        let blacklist =
            fs::read_to_string(Path::new(&game_path).join("Mods/blacklist.txt")).unwrap();
        assert!(blacklist.starts_with("# Profiles: [\"First\",\"Second\"]"));
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn previews_then_commits_v2_profiles() {
        let game_path = test_game_path("transfer");
        let source = Path::new(&game_path).join("source.json");
        fs::write(
            &source,
            r#"{"format":"celemod-profile","version":2,"name":"Imported","enabled_mods":["Missing.Mod"]}"#,
        )
        .unwrap();
        let preview = preview_mod_profiles(&game_path, source.to_str().unwrap()).unwrap();
        assert_eq!(preview.profiles[0].name, "Imported");
        assert_eq!(preview.missing_mods, ["Missing.Mod"]);
        assert!(
            !profiles_directory(&game_path)
                .join("Imported.json")
                .exists()
        );
        commit_profile_import(&game_path, preview.profiles).unwrap();

        let destination = Path::new(&game_path).join("exported.json");
        export_mod_profile(
            &game_path,
            "Imported",
            destination.to_str().unwrap(),
            None,
            false,
        )
        .unwrap();
        let exported: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(destination).unwrap()).unwrap();
        assert_eq!(exported["format"], PROFILE_FORMAT);
        assert_eq!(exported["enabled_mods"], serde_json::json!(["Missing.Mod"]));
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn previewing_inline_v2_profile_json_does_not_persist_it() {
        let game_path = test_game_path("inline-transfer");
        let preview = preview_mod_profiles_json(
            &game_path,
            r#"{"format":"celemod-profile","version":2,"name":"Linked","enabled_mods":["Missing.Mod"]}"#,
        )
        .unwrap();
        assert_eq!(preview.profiles[0].name, "Linked");
        assert_eq!(preview.missing_mods, ["Missing.Mod"]);
        assert!(!profiles_directory(&game_path).join("Linked.json").exists());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn previews_one_mod_name_per_line() {
        let game_path = test_game_path("mod-list");
        let source = Path::new(&game_path).join("Quick Match.txt");
        fs::write(&source, "# comment\nCelesteNet.Client\nFrostHelper\n\n").unwrap();
        let preview = preview_mod_profiles(&game_path, source.to_str().unwrap()).unwrap();
        assert_eq!(preview.profiles[0].name, "Quick Match");
        assert_eq!(
            preview.profiles[0].enabled_mods,
            ["CelesteNet.Client", "FrostHelper"]
        );
        assert!(
            !profiles_directory(&game_path)
                .join("Quick Match.json")
                .exists()
        );
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn expands_installed_required_dependencies() {
        let installed = vec![
            super::super::LocalMod {
                game_banana_id: 1,
                name: "Root.Mod".to_string(),
                deps: vec![super::super::ModDependency {
                    name: "Shared.Dependency".to_string(),
                    version: "1.0.0".to_string(),
                    optional: false,
                }],
                version: "1.0.0".to_string(),
                file: "Root.Mod.zip".to_string(),
                size: 0,
                modified_at: 0,
            },
            super::super::LocalMod {
                game_banana_id: 2,
                name: "Shared.Dependency".to_string(),
                deps: Vec::new(),
                version: "1.0.0".to_string(),
                file: "Shared.Dependency.zip".to_string(),
                size: 0,
                modified_at: 0,
            },
        ];
        assert_eq!(
            expand_installed_dependencies(&installed, &["Root.Mod".to_string()]),
            ["Root.Mod", "Shared.Dependency"]
        );
    }

    #[test]
    fn excludes_everest_virtual_dependencies() {
        let installed = vec![super::super::LocalMod {
            game_banana_id: 1,
            name: "Root.Mod".to_string(),
            deps: vec![
                super::super::ModDependency {
                    name: "Everest".to_string(),
                    version: "1.0.0".to_string(),
                    optional: false,
                },
                super::super::ModDependency {
                    name: "EverestCore".to_string(),
                    version: "1.0.0".to_string(),
                    optional: false,
                },
                super::super::ModDependency {
                    name: "Celeste".to_string(),
                    version: "1.4.0".to_string(),
                    optional: false,
                },
            ],
            version: "1.0.0".to_string(),
            file: "Root.Mod.zip".to_string(),
            size: 0,
            modified_at: 0,
        }];
        assert_eq!(
            expand_installed_dependencies(&installed, &["Root.Mod".to_string()]),
            ["Root.Mod"]
        );
    }

    #[test]
    fn auto_deps_is_preserved_until_commit() {
        let game_path = test_game_path("auto-deps");
        let preview = preview_mod_profiles_json(
            &game_path,
            r#"{"format":"celemod-profile","version":2,"auto_deps":true,"name":"Linked","enabled_mods":["Root.Mod"]}"#,
        )
        .unwrap();
        assert!(preview.profiles[0].auto_deps);
        assert!(!profiles_directory(&game_path).join("Linked.json").exists());
        commit_profile_import(&game_path, preview.profiles).unwrap();
        let stored: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(profiles_directory(&game_path).join("Linked.json")).unwrap(),
        )
        .unwrap();
        assert!(stored.get("auto_deps").is_none());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn invalid_profile_in_batch_writes_nothing() {
        let game_path = test_game_path("atomic-validation");
        let result = commit_profile_import(
            &game_path,
            vec![
                ModBlacklistProfile {
                    name: "Valid".to_string(),
                    enabled_mods: vec!["One".to_string()],
                    auto_deps: false,
                },
                ModBlacklistProfile {
                    name: "../Invalid".to_string(),
                    enabled_mods: vec!["Two".to_string()],
                    auto_deps: false,
                },
            ],
        );
        assert!(result.is_err());
        assert!(!profiles_directory(&game_path).join("Valid.json").exists());
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn preview_without_commit_leaves_existing_profile_unchanged() {
        let game_path = test_game_path("failed-download");
        write_profile(
            &game_path,
            &ModBlacklistProfile {
                name: "Existing".to_string(),
                enabled_mods: vec!["Old.Mod".to_string()],
                auto_deps: false,
            },
        )
        .unwrap();
        let before =
            fs::read_to_string(profiles_directory(&game_path).join("Existing.json")).unwrap();
        let preview = preview_mod_profiles_json(
            &game_path,
            r#"{"format":"celemod-profile","version":2,"name":"Existing","enabled_mods":["Missing.Mod"]}"#,
        )
        .unwrap();
        assert_eq!(preview.missing_mods, ["Missing.Mod"]);
        let after =
            fs::read_to_string(profiles_directory(&game_path).join("Existing.json")).unwrap();
        assert_eq!(after, before);
        fs::remove_dir_all(game_path).unwrap();
    }

    #[test]
    fn olympus_parser_reports_unknown_files() {
        let game_path = test_game_path("olympus");
        let (profiles, missing) =
            parse_olympus_presets(&game_path, "**Test\nMissing.zip\n").unwrap();
        assert_eq!(profiles[0].name, "Test");
        assert_eq!(profiles[0].enabled_mods, ["Missing.zip"]);
        assert_eq!(missing, ["Missing.zip"]);
        fs::remove_dir_all(game_path).unwrap();
    }
}
