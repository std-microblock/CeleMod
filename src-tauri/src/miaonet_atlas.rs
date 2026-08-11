use base64::{Engine as _, engine::general_purpose};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_PREVIEW_COUNT: usize = 64;
const MAX_TEXTURE_DIMENSION: i16 = 512;
const THUMBNAIL_SIZE: usize = 96;

const MAX_ATLAS_PIXELS: usize = 64 * 1024 * 1024;

lazy_static::lazy_static! {
    static ref ATLAS_ENTRIES_CACHE: Mutex<HashMap<(PathBuf, String), Arc<Vec<AtlasEntry>>>> =
        Mutex::new(HashMap::new());
    static ref ATLAS_PAGE_CACHE: Mutex<HashMap<PathBuf, Arc<AtlasPage>>> =
        Mutex::new(HashMap::new());
    static ref ATLAS_PREVIEW_CACHE: Mutex<HashMap<(PathBuf, String, String), PreviewImage>> =
        Mutex::new(HashMap::new());
}
#[derive(Clone, Debug)]
struct AtlasEntry {
    name: String,
    page: String,
    x: i16,
    y: i16,
    width: i16,
    height: i16,
    standalone: bool,
}

#[derive(Debug)]
struct AtlasPage {
    width: usize,
    height: usize,
    pixels: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiaoNetAtlasCatalogEntry {
    category: String,
    name: String,
    preview_name: String,
    frames: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiaoNetAtlasPreview {
    name: String,
    width: usize,
    height: usize,
    pixels_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiaoNetEmotePreview {
    index: usize,
    width: usize,
    height: usize,
    pixels_base64: String,
}

#[derive(Clone, Debug)]
struct PreviewImage {
    width: usize,
    height: usize,
    pixels_base64: String,
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, offset: 0 }
    }

    fn bytes(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or_else(|| "Celeste 图集元数据偏移溢出。".to_string())?;
        let bytes = self
            .data
            .get(self.offset..end)
            .ok_or_else(|| "Celeste 图集元数据不完整。".to_string())?;
        self.offset = end;
        Ok(bytes)
    }

    fn i16(&mut self) -> Result<i16, String> {
        let bytes = self.bytes(2)?;
        Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn i32(&mut self) -> Result<i32, String> {
        let bytes = self.bytes(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn string(&mut self) -> Result<String, String> {
        let mut length = 0usize;
        let mut shift = 0usize;
        loop {
            if shift > 28 {
                return Err("Celeste 图集字符串长度无效。".to_string());
            }
            let byte = self.bytes(1)?[0];
            length |= usize::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        let value = self.bytes(length)?;
        String::from_utf8(value.to_vec())
            .map_err(|_| "Celeste 图集包含无效的 UTF-8 路径。".to_string())
    }
}

fn atlas_name(category: &str) -> Result<&'static str, String> {
    match category {
        "g" => Ok("Gameplay"),
        "i" => Ok("Gui"),
        "p" => Ok("Portraits"),
        _ => Err("不支持的 MiaoNet 图集分类。".to_string()),
    }
}

fn atlas_directory(game_path: &Path) -> PathBuf {
    game_path.join("Content").join("Graphics").join("Atlases")
}

fn parse_atlas_meta(data: &[u8], standalone: bool) -> Result<Vec<AtlasEntry>, String> {
    let mut reader = Reader::new(data);
    reader.i32()?;
    reader.string()?;
    reader.i32()?;
    let page_count =
        usize::try_from(reader.i16()?).map_err(|_| "Celeste 图集页数无效。".to_string())?;
    let mut entries = Vec::new();
    for _ in 0..page_count {
        let page = reader.string()?.replace('\\', "/");
        let entry_count =
            usize::try_from(reader.i16()?).map_err(|_| "Celeste 图集条目数量无效。".to_string())?;
        for _ in 0..entry_count {
            let name = reader.string()?.replace('\\', "/");
            let x = reader.i16()?;
            let y = reader.i16()?;
            let width = reader.i16()?;
            let height = reader.i16()?;
            reader.i16()?;
            reader.i16()?;
            reader.i16()?;
            reader.i16()?;
            entries.push(AtlasEntry {
                name,
                page: page.clone(),
                x,
                y,
                width,
                height,
                standalone,
            });
        }
    }
    Ok(entries)
}

fn load_atlas_entries(atlas_dir: &Path, category: &str) -> Result<Arc<Vec<AtlasEntry>>, String> {
    let cache_key = (atlas_dir.to_path_buf(), category.to_string());
    if let Some(entries) = ATLAS_ENTRIES_CACHE
        .lock()
        .map_err(|_| "Celeste 图集元数据缓存已损坏。".to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(entries);
    }
    let atlas = atlas_name(category)?;
    let path = atlas_dir.join(format!("{atlas}.meta"));
    let data =
        fs::read(&path).map_err(|error| format!("读取 Celeste {atlas} 图集失败：{error}"))?;
    let entries = Arc::new(parse_atlas_meta(&data, category == "p")?);
    ATLAS_ENTRIES_CACHE
        .lock()
        .map_err(|_| "Celeste 图集元数据缓存已损坏。".to_string())?
        .insert(cache_key, entries.clone());
    Ok(entries)
}

fn numeric_prefix(name: &str) -> Option<&str> {
    let prefix_length = name
        .trim_end_matches(|character: char| character.is_ascii_digit())
        .len();
    (prefix_length > 0 && prefix_length < name.len()).then_some(&name[..prefix_length])
}

fn numeric_frame(name: &str, prefix: &str) -> Option<u32> {
    name.strip_prefix(prefix)?.parse().ok()
}

fn grouped_catalog_entries(
    category: &str,
    entries: &[AtlasEntry],
) -> Vec<MiaoNetAtlasCatalogEntry> {
    let entries = entries
        .iter()
        .filter(|entry| {
            entry.width > 0
                && entry.height > 0
                && entry.width <= MAX_TEXTURE_DIMENSION
                && entry.height <= MAX_TEXTURE_DIMENSION
        })
        .collect::<Vec<_>>();
    let mut prefix_counts = HashMap::<String, usize>::new();
    for entry in &entries {
        if let Some(prefix) = numeric_prefix(&entry.name) {
            *prefix_counts.entry(prefix.to_string()).or_default() += 1;
        }
    }
    let mut groups = BTreeMap::<String, Vec<String>>::new();
    for entry in entries {
        let group_name = numeric_prefix(&entry.name)
            .filter(|prefix| prefix_counts.get(*prefix).copied().unwrap_or(0) > 1)
            .unwrap_or(&entry.name)
            .to_string();
        groups
            .entry(group_name)
            .or_default()
            .push(entry.name.clone());
    }
    groups
        .into_iter()
        .map(|(name, mut frames)| {
            frames.sort_by(|left, right| {
                numeric_frame(left, &name)
                    .cmp(&numeric_frame(right, &name))
                    .then_with(|| left.cmp(right))
            });
            MiaoNetAtlasCatalogEntry {
                category: category.to_string(),
                preview_name: frames[0].clone(),
                name,
                frames,
            }
        })
        .collect()
}

fn decode_atlas_page(data: &[u8]) -> Result<AtlasPage, String> {
    if data.len() < 9 {
        return Err("Celeste 图集纹理数据不完整。".to_string());
    }
    let width = usize::try_from(i32::from_le_bytes([data[0], data[1], data[2], data[3]]))
        .map_err(|_| "Celeste 图集纹理宽度无效。".to_string())?;
    let height = usize::try_from(i32::from_le_bytes([data[4], data[5], data[6], data[7]]))
        .map_err(|_| "Celeste 图集纹理高度无效。".to_string())?;
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| "Celeste 图集纹理尺寸溢出。".to_string())?;
    if pixel_count == 0 || pixel_count > MAX_ATLAS_PIXELS {
        return Err("Celeste 图集纹理尺寸超出允许范围。".to_string());
    }
    let mut pixels = vec![
        0u8;
        pixel_count.checked_mul(4).ok_or_else(|| {
            "Celeste 图集纹理像素数量溢出。".to_string()
        })?
    ];
    let alpha = data[8] == 1;
    let mut source_offset = 9usize;
    let mut pixel = 0usize;
    while pixel < pixel_count {
        let run = usize::from(
            *data
                .get(source_offset)
                .ok_or_else(|| "Celeste 图集纹理游程数据不完整。".to_string())?,
        );
        if run == 0 || pixel + run > pixel_count {
            return Err("Celeste 图集纹理游程长度无效。".to_string());
        }
        source_offset += 1;
        let (red, green, blue, opacity) = if alpha {
            let opacity = *data
                .get(source_offset)
                .ok_or_else(|| "Celeste 图集透明度数据不完整。".to_string())?;
            source_offset += 1;
            if opacity == 0 {
                (0, 0, 0, 0)
            } else {
                let color = data
                    .get(source_offset..source_offset + 3)
                    .ok_or_else(|| "Celeste 图集颜色数据不完整。".to_string())?;
                source_offset += 3;
                (color[2], color[1], color[0], opacity)
            }
        } else {
            let color = data
                .get(source_offset..source_offset + 3)
                .ok_or_else(|| "Celeste 图集颜色数据不完整。".to_string())?;
            source_offset += 3;
            (color[2], color[1], color[0], 255)
        };
        for target_pixel in pixel..pixel + run {
            let target = target_pixel * 4;
            pixels[target] = red;
            pixels[target + 1] = green;
            pixels[target + 2] = blue;
            pixels[target + 3] = opacity;
        }
        pixel += run;
    }
    Ok(AtlasPage {
        width,
        height,
        pixels,
    })
}

fn make_thumbnail(page: &AtlasPage, entry: &AtlasEntry) -> Result<(usize, usize, Vec<u8>), String> {
    let x = usize::try_from(entry.x).map_err(|_| "图集条目的横坐标无效。".to_string())?;
    let y = usize::try_from(entry.y).map_err(|_| "图集条目的纵坐标无效。".to_string())?;
    let width = usize::try_from(entry.width).map_err(|_| "图集条目的宽度无效。".to_string())?;
    let height = usize::try_from(entry.height).map_err(|_| "图集条目的高度无效。".to_string())?;
    if width == 0
        || height == 0
        || x.checked_add(width).is_none_or(|right| right > page.width)
        || y.checked_add(height)
            .is_none_or(|bottom| bottom > page.height)
    {
        return Err("图集条目超出了纹理页范围。".to_string());
    }

    let scale = (THUMBNAIL_SIZE as f32 / width as f32)
        .min(THUMBNAIL_SIZE as f32 / height as f32)
        .min(1.0);
    let target_width = ((width as f32 * scale).round() as usize).max(1);
    let target_height = ((height as f32 * scale).round() as usize).max(1);
    let mut thumbnail = vec![0u8; target_width * target_height * 4];
    for target_y in 0..target_height {
        let source_y = y + target_y * height / target_height;
        for target_x in 0..target_width {
            let source_x = x + target_x * width / target_width;
            let source = (source_y * page.width + source_x) * 4;
            let target = (target_y * target_width + target_x) * 4;
            thumbnail[target..target + 4].copy_from_slice(&page.pixels[source..source + 4]);
        }
    }
    Ok((target_width, target_height, thumbnail))
}

fn entry_data_path(atlas_dir: &Path, entry: &AtlasEntry) -> PathBuf {
    if entry.standalone {
        atlas_dir
            .join(&entry.page)
            .join(format!("{}.data", entry.name))
    } else {
        atlas_dir.join(format!("{}.data", entry.page))
    }
}

fn load_atlas_page(path: &Path, cache: bool) -> Result<Arc<AtlasPage>, String> {
    if !cache {
        let data =
            fs::read(path).map_err(|error| format!("读取 Celeste 图集纹理页失败：{error}"))?;
        return decode_atlas_page(&data).map(Arc::new);
    }
    let mut pages = ATLAS_PAGE_CACHE
        .lock()
        .map_err(|_| "Celeste 图集纹理页缓存已损坏。".to_string())?;
    if let Some(page) = pages.get(path).cloned() {
        return Ok(page);
    }
    let data = fs::read(path).map_err(|error| format!("读取 Celeste 图集纹理页失败：{error}"))?;
    let page = Arc::new(decode_atlas_page(&data)?);
    pages.insert(path.to_path_buf(), page.clone());
    Ok(page)
}

fn render_named_previews(
    atlas_dir: &Path,
    category: &str,
    entries: &[AtlasEntry],
    requested: &std::collections::HashSet<String>,
) -> Result<HashMap<String, PreviewImage>, String> {
    let mut previews = HashMap::new();
    let mut missing = std::collections::HashSet::new();
    {
        let cache = ATLAS_PREVIEW_CACHE
            .lock()
            .map_err(|_| "Celeste 图集预览缓存已损坏。".to_string())?;
        for name in requested {
            let key = (atlas_dir.to_path_buf(), category.to_string(), name.clone());
            if let Some(preview) = cache.get(&key).cloned() {
                previews.insert(name.clone(), preview);
            } else {
                missing.insert(name.clone());
            }
        }
    }
    if missing.is_empty() {
        return Ok(previews);
    }

    let mut entries_by_source = BTreeMap::<PathBuf, Vec<&AtlasEntry>>::new();
    for entry in entries {
        if missing.contains(&entry.name) {
            entries_by_source
                .entry(entry_data_path(atlas_dir, entry))
                .or_default()
                .push(entry);
        }
    }
    let mut first_error = None;
    for (source, source_entries) in entries_by_source {
        let standalone = source_entries[0].standalone;
        let page = match load_atlas_page(&source, !standalone) {
            Ok(page) => page,
            Err(error) => {
                first_error.get_or_insert(error);
                continue;
            }
        };
        for entry in source_entries {
            let (width, height, pixels) = match make_thumbnail(&page, entry) {
                Ok(preview) => preview,
                Err(error) => {
                    first_error.get_or_insert(error);
                    continue;
                }
            };
            let preview = PreviewImage {
                width,
                height,
                pixels_base64: general_purpose::STANDARD.encode(pixels),
            };
            ATLAS_PREVIEW_CACHE
                .lock()
                .map_err(|_| "Celeste 图集预览缓存已损坏。".to_string())?
                .insert(
                    (
                        atlas_dir.to_path_buf(),
                        category.to_string(),
                        entry.name.clone(),
                    ),
                    preview.clone(),
                );
            previews.insert(entry.name.clone(), preview);
        }
    }
    if previews.is_empty() && first_error.is_some() {
        return Err(first_error.unwrap());
    }
    Ok(previews)
}

fn parse_emote_expression(expression: &str) -> Option<(String, String, Option<String>)> {
    let mut parts = expression.split_whitespace();
    let head = parts.next()?;
    let colon = head.find(':')?;
    let category = head[..colon].chars().next()?.to_ascii_lowercase();
    if !matches!(category, 'g' | 'i' | 'p') {
        return None;
    }
    let prefix = head[colon + 1..].to_string();
    if prefix.is_empty() {
        return None;
    }
    let frame = parts
        .next()
        .filter(|frame| *frame != "!")
        .map(str::to_string);
    Some((category.to_string(), prefix, frame))
}

fn resolve_emote_preview_name(
    entries: &[AtlasEntry],
    prefix: &str,
    frame: Option<&str>,
) -> Option<String> {
    if let Some(frame) = frame {
        let exact = format!("{prefix}{frame}");
        return entries
            .iter()
            .any(|entry| entry.name == exact)
            .then_some(exact);
    }
    if entries.iter().any(|entry| entry.name == prefix) {
        return Some(prefix.to_string());
    }
    entries
        .iter()
        .filter(|entry| numeric_prefix(&entry.name) == Some(prefix))
        .min_by(|left, right| {
            numeric_frame(&left.name, prefix)
                .cmp(&numeric_frame(&right.name, prefix))
                .then_with(|| left.name.cmp(&right.name))
        })
        .map(|entry| entry.name.clone())
}

fn get_miaonet_atlas_catalog_impl(
    game_path: String,
) -> Result<Vec<MiaoNetAtlasCatalogEntry>, String> {
    let game_path = super::normalize_game_path_impl(&game_path);
    let atlas_dir = atlas_directory(Path::new(&game_path));
    let mut catalog = Vec::new();
    for category in ["i", "p", "g"] {
        let entries = load_atlas_entries(&atlas_dir, category)?;
        catalog.extend(grouped_catalog_entries(category, &entries));
    }
    catalog.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(catalog)
}

fn get_miaonet_atlas_previews_impl(
    game_path: String,
    category: String,
    names: Vec<String>,
) -> Result<Vec<MiaoNetAtlasPreview>, String> {
    if names.len() > MAX_PREVIEW_COUNT {
        return Err(format!("一次最多预览 {MAX_PREVIEW_COUNT} 张贴图。"));
    }
    let game_path = super::normalize_game_path_impl(&game_path);
    let atlas_dir = atlas_directory(Path::new(&game_path));
    let entries = load_atlas_entries(&atlas_dir, &category)?;
    let requested = names.iter().cloned().collect();
    let rendered = render_named_previews(&atlas_dir, &category, &entries, &requested)?;
    Ok(names
        .into_iter()
        .filter_map(|name| {
            let preview = rendered.get(&name)?;
            Some(MiaoNetAtlasPreview {
                name,
                width: preview.width,
                height: preview.height,
                pixels_base64: preview.pixels_base64.clone(),
            })
        })
        .collect())
}

fn get_miaonet_emote_previews_impl(
    game_path: String,
    emotes: Vec<String>,
) -> Result<Vec<MiaoNetEmotePreview>, String> {
    if emotes.len() > 128 {
        return Err("一次最多预览 128 个表情。".to_string());
    }
    let game_path = super::normalize_game_path_impl(&game_path);
    let atlas_dir = atlas_directory(Path::new(&game_path));
    let mut parsed = BTreeMap::<String, Vec<(usize, String, Option<String>)>>::new();
    for (index, emote) in emotes.iter().enumerate() {
        if let Some((category, prefix, frame)) = parse_emote_expression(emote) {
            parsed
                .entry(category)
                .or_default()
                .push((index, prefix, frame));
        }
    }

    let mut previews = Vec::new();
    for (category, requests) in parsed {
        let entries = load_atlas_entries(&atlas_dir, &category)?;
        let resolved = requests
            .into_iter()
            .filter_map(|(index, prefix, frame)| {
                resolve_emote_preview_name(&entries, &prefix, frame.as_deref())
                    .map(|name| (index, name))
            })
            .collect::<Vec<_>>();
        let requested = resolved.iter().map(|(_, name)| name.clone()).collect();
        let rendered = match render_named_previews(&atlas_dir, &category, &entries, &requested) {
            Ok(rendered) => rendered,
            Err(_) => continue,
        };
        for (index, name) in resolved {
            if let Some(preview) = rendered.get(&name) {
                previews.push(MiaoNetEmotePreview {
                    index,
                    width: preview.width,
                    height: preview.height,
                    pixels_base64: preview.pixels_base64.clone(),
                });
            }
        }
    }
    previews.sort_by_key(|preview| preview.index);
    Ok(previews)
}

#[tauri::command]
pub(crate) async fn get_miaonet_atlas_catalog(
    game_path: String,
) -> Result<Vec<MiaoNetAtlasCatalogEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || get_miaonet_atlas_catalog_impl(game_path))
        .await
        .map_err(|error| format!("读取 Celeste 图集任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_miaonet_atlas_previews(
    game_path: String,
    category: String,
    names: Vec<String>,
) -> Result<Vec<MiaoNetAtlasPreview>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_miaonet_atlas_previews_impl(game_path, category, names)
    })
    .await
    .map_err(|error| format!("生成 Celeste 图集预览任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_miaonet_emote_previews(
    game_path: String,
    emotes: Vec<String>,
) -> Result<Vec<MiaoNetEmotePreview>, String> {
    tauri::async_runtime::spawn_blocking(move || get_miaonet_emote_previews_impl(game_path, emotes))
        .await
        .map_err(|error| format!("生成 MiaoNet 表情预览任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_string(buffer: &mut Vec<u8>, value: &str) {
        let mut length = value.len();
        loop {
            let mut byte = (length & 0x7f) as u8;
            length >>= 7;
            if length != 0 {
                byte |= 0x80;
            }
            buffer.push(byte);
            if length == 0 {
                break;
            }
        }
        buffer.extend_from_slice(value.as_bytes());
    }

    #[test]
    fn parses_atlas_metadata_entries() {
        let mut data = Vec::new();
        data.extend_from_slice(&0i32.to_le_bytes());
        write_string(&mut data, "hash");
        data.extend_from_slice(&0i32.to_le_bytes());
        data.extend_from_slice(&1i16.to_le_bytes());
        write_string(&mut data, "Gameplay0");
        data.extend_from_slice(&1i16.to_le_bytes());
        write_string(&mut data, "collectables/strawberry00");
        for value in [2i16, 3, 8, 9, 0, 0, 8, 9] {
            data.extend_from_slice(&value.to_le_bytes());
        }

        let entries = parse_atlas_meta(&data, false).expect("metadata should parse");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "collectables/strawberry00");
        assert_eq!(entries[0].page, "Gameplay0");
        assert_eq!(entries[0].width, 8);
        assert_eq!(
            numeric_prefix(&entries[0].name),
            Some("collectables/strawberry")
        );
    }

    #[test]
    fn decodes_alpha_run_length_texture_data() {
        let mut data = Vec::new();
        data.extend_from_slice(&2i32.to_le_bytes());
        data.extend_from_slice(&1i32.to_le_bytes());
        data.push(1);
        data.extend_from_slice(&[1, 255, 0, 0, 255]);
        data.extend_from_slice(&[1, 0]);

        let page = decode_atlas_page(&data).expect("texture should decode");
        assert_eq!(page.width, 2);
        assert_eq!(page.height, 1);
        assert_eq!(page.pixels, [255, 0, 0, 255, 0, 0, 0, 0]);
    }

    #[test]
    fn groups_numbered_frames_into_one_catalog_entry() {
        let entry = |name: &str| AtlasEntry {
            name: name.to_string(),
            page: "Gui0".to_string(),
            x: 0,
            y: 0,
            width: 16,
            height: 16,
            standalone: false,
        };
        let entries = vec![
            entry("collectables/strawberry02"),
            entry("collectables/strawberry00"),
            entry("collectables/strawberry01"),
            entry("emoji/heart"),
        ];
        let groups = grouped_catalog_entries("i", &entries);

        assert_eq!(groups.len(), 2);
        let strawberry = groups
            .iter()
            .find(|group| group.name == "collectables/strawberry")
            .expect("animation group should exist");
        assert_eq!(strawberry.preview_name, "collectables/strawberry00");
        assert_eq!(
            strawberry.frames,
            [
                "collectables/strawberry00",
                "collectables/strawberry01",
                "collectables/strawberry02"
            ]
        );
    }

    #[test]
    fn resolves_miaonet_emote_preview_frames() {
        assert_eq!(
            parse_emote_expression("p7:theo/yolo0 3 2 1 !"),
            Some((
                "p".to_string(),
                "theo/yolo0".to_string(),
                Some("3".to_string())
            ))
        );
        let entries = ["madeline/normal02", "madeline/normal00"]
            .into_iter()
            .map(|name| AtlasEntry {
                name: name.to_string(),
                page: "Portraits0".to_string(),
                x: 0,
                y: 0,
                width: 16,
                height: 16,
                standalone: true,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            resolve_emote_preview_name(&entries, "madeline/normal", None),
            Some("madeline/normal00".to_string())
        );
        assert_eq!(
            resolve_emote_preview_name(&entries, "madeline/normal", Some("02")),
            Some("madeline/normal02".to_string())
        );
    }

    #[test]
    fn resolves_standalone_portrait_texture_paths() {
        let root = Path::new("Atlases");
        let portrait = AtlasEntry {
            name: "madeline/normal04".to_string(),
            page: "Portraits".to_string(),
            x: 0,
            y: 0,
            width: 240,
            height: 240,
            standalone: true,
        };
        let shared = AtlasEntry {
            standalone: false,
            page: "Gui0".to_string(),
            ..portrait.clone()
        };
        assert_eq!(
            entry_data_path(root, &portrait),
            PathBuf::from("Atlases/Portraits/madeline/normal04.data")
        );
        assert_eq!(
            entry_data_path(root, &shared),
            PathBuf::from("Atlases/Gui0.data")
        );
    }
}
