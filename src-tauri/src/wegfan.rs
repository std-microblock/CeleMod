use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};

/// weg.fan 镜像的下载接口。只有这些 URL 才走「先制作镜像、轮询进度、再下载」
/// 的流程，其它镜像（0x0a.de、GameBanana 直连等）保持原样直连下载。
pub const MIRROR_GAME_BANANA_FILES_API: &str =
    "https://celeste.weg.fan/api/v2/download/gamebanana-files";
pub const MIRROR_FILES_API: &str = "https://celeste.weg.fan/api/v2/download/files";
const MIRROR_START_API: &str = "https://celeste.weg.fan/api/v2/mirror/start";
const MIRROR_STATUS_API: &str = "https://celeste.weg.fan/api/v2/mirror/status";

/// 轮询间隔与镜像官方 Mod（ChinaMirror）保持一致。
const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// 服务器还没报出任何进度（total 仍为 0）时的等待上限。
const FIRST_PROGRESS_TIMEOUT: Duration = Duration::from_secs(30);
/// 已经有进度、但进度停滞时的上限。
const STALL_TIMEOUT: Duration = Duration::from_secs(10);
/// 整个制作阶段的兜底上限，避免轮询卡死在这里。
const PREPARE_TIMEOUT: Duration = Duration::from_secs(600);
/// 镜像回复「文件未找到」，此时没必要再轮询，直接回退直连下载。
const FILE_NOT_FOUND_CODE: i64 = 10002;

#[derive(Deserialize)]
struct MirrorApiResponse<T> {
    data: Option<T>,
    code: Option<i64>,
    message: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MirrorPrepareStatus {
    download_progress: FileProgress,
    upload_progress: FileProgress,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FileProgress {
    current: u64,
    total: u64,
}

fn mirror_agent() -> ureq::Agent {
    // 和下载用 agent 一样的超时约定（#84）：连接/读/写各自 30s，服务端不回数据
    // 时必须报错而不是一直挂着。这里额外关掉重定向跟随：`gamebanana-files/{id}`
    // 的 302 就是要读的东西，不是要跟过去的东西。
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(30))
        .timeout_write(Duration::from_secs(30))
        .redirects(0)
        .try_proxy_from_env(true)
        .build()
}

fn mirror_user_agent() -> String {
    format!("CeleMod/{}", env!("VERSION"))
}

fn parse_mirror_response<T: serde::de::DeserializeOwned>(
    url: &str,
    response: ureq::Response,
) -> anyhow::Result<MirrorApiResponse<T>> {
    let parsed = response
        .into_json::<MirrorApiResponse<T>>()
        .with_context(|| format!("Failed to parse mirror response from {url}"))?;
    match parsed.code {
        Some(200) => Ok(parsed),
        Some(FILE_NOT_FOUND_CODE) => bail!("Mirror does not know this file: {url}"),
        code => bail!(
            "Mirror request failed ({}, code {:?}): {}",
            url,
            code,
            parsed.message.as_deref().unwrap_or("")
        ),
    }
}

/// 取出 URL 里挂在 `prefix/` 后面的那个 id。
fn mirror_url_suffix(url: &str, prefix: &str) -> Option<String> {
    let rest = url
        .split(['?', '#'])
        .next()?
        .strip_prefix(prefix)?
        .strip_prefix('/')?;
    let id = rest.trim_end_matches('/');
    (!id.is_empty() && !id.contains('/')).then(|| id.to_string())
}

/// `.../download/files/{fileId}` 直接带文件 id；`.../download/gamebanana-files/{source}`
/// 需要 HEAD 一次读 302 的 `Location` 才能拿到 id。都不是就说明不用制作镜像。
fn mirror_file_id(url: &str) -> anyhow::Result<Option<String>> {
    if let Some(file_id) = mirror_url_suffix(url, MIRROR_FILES_API) {
        return Ok(Some(file_id));
    }
    let Some(source) = mirror_url_suffix(url, MIRROR_GAME_BANANA_FILES_API) else {
        return Ok(None);
    };
    resolve_mirror_file_id(&source).map(Some)
}

fn resolve_mirror_file_id(source: &str) -> anyhow::Result<String> {
    let url = format!("{MIRROR_GAME_BANANA_FILES_API}/{source}");
    let response = mirror_agent()
        .head(&url)
        .set("User-Agent", &mirror_user_agent())
        .call()
        .with_context(|| format!("Failed to resolve mirror file id: {url}"))?;
    let location = response.header("Location").unwrap_or_default();
    mirror_url_suffix(location, MIRROR_FILES_API).with_context(|| {
        format!("Mirror did not redirect {url} to a file id (Location: {location})")
    })
}

fn start_mirror(file_id: &str) -> anyhow::Result<()> {
    let url = format!("{MIRROR_START_API}/{file_id}");
    let response = mirror_agent()
        .post(&url)
        .set("User-Agent", &mirror_user_agent())
        .call()
        .with_context(|| format!("Failed to ask the mirror to prepare {file_id}"))?;
    parse_mirror_response::<serde::de::IgnoredAny>(&url, response).map(|_| ())
}

/// 服务器已经开始上传缓存时，下载进度计数可能还没更新，按镜像 Mod 的做法直接
/// 认为下载阶段已完成，避免卡在最后一段上。
fn combined_progress(download: FileProgress, upload: FileProgress) -> (u64, u64) {
    let mut download = download;
    if upload.current > 0 {
        download.current = download.total;
    }
    (
        download.current + upload.current,
        download.total + upload.total,
    )
}

/// 判断该不该放弃轮询：还没拿到任何进度（total 为 0）时看总耗时，已经有进度
/// 之后看停滞时间。
fn mirror_prepare_stalled(total: u64, waited: Duration, since_change: Duration) -> bool {
    if total == 0 {
        waited >= FIRST_PROGRESS_TIMEOUT
    } else {
        since_change >= STALL_TIMEOUT
    }
}

fn mirror_status(file_id: &str) -> anyhow::Result<(u64, u64)> {
    let url = format!("{MIRROR_STATUS_API}/{file_id}");
    let response = mirror_agent()
        .get(&url)
        .set("User-Agent", &mirror_user_agent())
        .call()
        .with_context(|| format!("Failed to query mirror status of {file_id}"))?;
    let status = parse_mirror_response::<MirrorPrepareStatus>(&url, response)?
        .data
        .unwrap_or_default();
    Ok(combined_progress(
        status.download_progress,
        status.upload_progress,
    ))
}

fn wait_for_mirror(
    file_id: &str,
    cancel_flag: &AtomicBool,
    on_progress: &mut dyn FnMut(u64, u64),
) -> anyhow::Result<()> {
    let started = Instant::now();
    let mut last_change = started;
    let mut last_current = 0;
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }
        let (current, total) = mirror_status(file_id)?;
        on_progress(current, total);
        if total > 0 && current >= total {
            return Ok(());
        }
        if current != last_current {
            last_current = current;
            last_change = Instant::now();
        }
        let elapsed = started.elapsed();
        if mirror_prepare_stalled(total, elapsed, last_change.elapsed())
            || elapsed >= PREPARE_TIMEOUT
        {
            bail!("Mirror did not finish preparing {file_id} in time");
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// 让镜像服务器开始制作文件，并轮询到进度满，最后返回可以直接下载的镜像地址。
///
/// - `Ok(None)`：这个 URL 不是 weg.fan 镜像下载，不需要制作镜像；
/// - `Ok(Some(url))`：镜像已就绪，用返回的地址下载；
/// - `Err(..)`：制作失败（网络、超时、文件不存在…），调用方应当回退到原来的
///   直连下载，不能让镜像的新接口坏掉就下不了东西。
pub fn prepare_mirror(
    url: &str,
    cancel_flag: &AtomicBool,
    on_progress: &mut dyn FnMut(u64, u64),
) -> anyhow::Result<Option<String>> {
    let Some(file_id) = mirror_file_id(url)? else {
        return Ok(None);
    };
    start_mirror(&file_id)?;
    wait_for_mirror(&file_id, cancel_flag, on_progress)?;
    Ok(Some(format!("{MIRROR_FILES_API}/{file_id}")))
}

#[derive(Clone, Serialize, Deserialize)]
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

#[derive(Clone, Serialize, Deserialize)]
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

#[derive(Clone, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 只有 weg.fan 镜像的下载地址才走制作镜像，其它镜像保持原样直连下载。
    #[test]
    fn only_weg_fan_download_urls_are_prepared() {
        let cancel_flag = AtomicBool::new(false);
        let mut on_progress = |_: u64, _: u64| {};
        for url in [
            "https://gamebanana.com/dl/844056",
            "https://celestemodupdater.0x0a.de/banana-mirror/844056.zip",
            "https://celeste.weg.fan/api/v2/mod/list",
            "https://celeste.weg.fan/api/v2/download/mod_dependency_graph.yaml",
            "http://127.0.0.1:8080/api/v2/download/gamebanana-files/1",
        ] {
            let prepared = prepare_mirror(url, &cancel_flag, &mut on_progress)
                .expect("non-mirror URLs must not do any request");
            assert!(prepared.is_none(), "{url} should not be prepared");
        }
    }

    #[test]
    fn file_id_comes_from_the_mirror_url() {
        assert_eq!(
            mirror_file_id("https://celeste.weg.fan/api/v2/download/files/257995518157984676")
                .unwrap()
                .as_deref(),
            Some("257995518157984676")
        );
        // 已经是 files/{id} 的地址不用再解析重定向，也不会走网络。
        assert_eq!(
            mirror_url_suffix(
                "https://celeste.weg.fan/api/v2/download/files/1?type=mod",
                MIRROR_FILES_API
            )
            .as_deref(),
            Some("1")
        );
        assert_eq!(
            mirror_url_suffix(
                "https://celeste.weg.fan/api/v2/download/files/",
                MIRROR_FILES_API
            ),
            None
        );
        assert_eq!(
            mirror_url_suffix(
                "https://celeste.weg.fan/api/v2/download/files/1/extra",
                MIRROR_FILES_API
            ),
            None
        );
    }

    /// 真实 /status 响应：下载 0/13856、上传 13856/13856，视为制作完成。
    #[test]
    fn upload_started_means_download_finished() {
        let status: MirrorPrepareStatus = serde_json::from_str(
            r#"{"downloadProgress":{"current":0,"total":13856},"uploadProgress":{"current":13856,"total":13856}}"#,
        )
        .unwrap();
        assert_eq!(
            combined_progress(status.download_progress, status.upload_progress),
            (27712, 27712)
        );

        let status: MirrorPrepareStatus = serde_json::from_str(
            r#"{"downloadProgress":{"current":55695,"total":10246734},"uploadProgress":{"current":0,"total":10246734}}"#,
        )
        .unwrap();
        assert_eq!(
            combined_progress(status.download_progress, status.upload_progress),
            (55695, 20493468)
        );
    }

    #[test]
    fn prepare_gives_up_on_timeout_but_not_while_progressing() {
        // 还没有任何进度：30s 才算超时。
        assert!(!mirror_prepare_stalled(
            0,
            Duration::from_secs(29),
            Duration::from_secs(29)
        ));
        assert!(mirror_prepare_stalled(
            0,
            Duration::from_secs(30),
            Duration::from_secs(30)
        ));
        // 有进度之后：停滞 10s 算超时。
        assert!(!mirror_prepare_stalled(
            1024,
            Duration::from_secs(60),
            Duration::from_secs(9)
        ));
        assert!(mirror_prepare_stalled(
            1024,
            Duration::from_secs(60),
            Duration::from_secs(10)
        ));
    }
}
