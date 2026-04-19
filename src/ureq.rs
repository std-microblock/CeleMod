use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use anyhow::{bail, Context};

pub struct DownloadCallbackInfo {
    pub progress: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: f64,
}

const NUM_THREADS: usize = 8;

fn user_agent() -> String {
    format!(
        "CeleMod/{}-{} ureq",
        env!("VERSION"),
        &env!("GIT_HASH")[..6]
    )
}

fn make_request(url: &str) -> ureq::Request {
    ureq::get(url)
        .set("Connection", "keep-alive")
        .set("User-Agent", &user_agent())
        .set("Accept", "*/*")
        .set("Cache-Control", "no-cache")
}

/// 单线程下载，写入 writer，同时报告进度。
fn download_single(
    url: &str,
    writer: &mut dyn Write,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let resp = make_request(url).call()?;
    let total_size: u64 = resp
        .header("Content-Length")
        .unwrap_or("0")
        .parse()
        .unwrap_or(0);

    let mut reader = resp.into_reader();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_progress = -1.0f32;
    let started = Instant::now();

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buffer[..n])?;
        downloaded += n as u64;
        if total_size > 0 {
            let progress = (downloaded as f32 / total_size as f32) * 100.0;
            if progress - last_progress >= 0.1 {
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                progress_callback(DownloadCallbackInfo {
                    progress,
                    downloaded_bytes: downloaded,
                    total_bytes: total_size,
                    speed_bytes_per_sec: downloaded as f64 / elapsed,
                });
                last_progress = progress;
            }
        }
    }
    Ok(())
}

/// 多线程分段下载。
/// 先 HEAD 获取大小和 Accept-Ranges，支持则并发下载各段，否则退化为单线程。
fn download_multi_thread(
    url: &str,
    output_path: &Path,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    // HEAD 请求探测
    let head = ureq::head(url)
        .set("User-Agent", &user_agent())
        .set("Accept", "*/*")
        .call();

    let mut content_length = 0;
    let head_supports_range = match head {
        Ok(resp) => {
            content_length = resp
                .header("Content-Length")
                .unwrap_or("0")
                .parse()
                .unwrap_or(0);
            resp.header("Accept-Ranges")
                .map(|v| v != "none")
                .unwrap_or(false)
        }
        Err(_) => false,
    };

    // 有些 CDN 会在 HEAD 上声称支持 Range，但真正的 GET Range 只返回 200。
    // 这里先做一次 bytes=0-0 探测，确认真的会返回 206 再启用多线程。
    let probe = make_request(url).set("Range", "bytes=0-0").call();
    let supports_range = match probe {
        Ok(resp) if resp.status() == 206 => {
            if content_length == 0 {
                content_length = resp
                    .header("Content-Range")
                    .and_then(|value| value.rsplit('/').next())
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
            }
            head_supports_range || content_length > 0
        }
        _ => false,
    };

    if !supports_range || content_length == 0 {
        // 退化为单线程
        let mut file = std::fs::File::create(output_path)?;
        let mut writer = BufWriter::new(&mut file);
        return download_single(url, &mut writer, progress_callback, cancel_flag);
    }

    // 预分配文件
    let file = std::fs::File::create(output_path)?;
    file.set_len(content_length)?;

    let chunk_size = (content_length + NUM_THREADS as u64 - 1) / NUM_THREADS as u64;
    let downloaded_bytes: Arc<Mutex<u64>> = Arc::new(Mutex::new(0));
    let mut handles = Vec::with_capacity(NUM_THREADS);
    let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let started = Instant::now();

    for i in 0..NUM_THREADS {
        let start = i as u64 * chunk_size;
        if start >= content_length {
            break;
        }
        let end = (start + chunk_size - 1).min(content_length - 1);
        let url = url.to_string();
        let output_path = output_path.to_path_buf();
        let downloaded_bytes = Arc::clone(&downloaded_bytes);
        let errors = Arc::clone(&errors);
        let cancel_flag = Arc::clone(cancel_flag);
        let loop_cancel_flag = Arc::clone(&cancel_flag);

        let handle = std::thread::spawn(move || {
            let range = format!("bytes={}-{}", start, end);
            let resp = ureq::get(&url)
                .set("User-Agent", &user_agent())
                .set("Accept", "*/*")
                .set("Range", &range)
                .call();

            match resp {
                Ok(resp) => {
                    if resp.status() != 206 {
                        errors.lock().unwrap().push(format!(
                            "Range request {} returned status {}",
                            range,
                            resp.status()
                        ));
                        return;
                    }
                    let mut reader = resp.into_reader();
                    let mut buffer = vec![0u8; 256 * 1024];
                    let mut offset = start;

                    // 用独立文件句柄 seek 写入对应区段
                    let file = std::fs::OpenOptions::new().write(true).open(&output_path);
                    match file {
                        Ok(mut file) => loop {
                            if loop_cancel_flag.load(Ordering::Relaxed) {
                                return;
                            }
                            let n = match reader.read(&mut buffer) {
                                Ok(n) => n,
                                Err(e) => {
                                    errors.lock().unwrap().push(e.to_string());
                                    break;
                                }
                            };
                            if n == 0 {
                                break;
                            }
                            if file.seek(SeekFrom::Start(offset)).is_err() {
                                break;
                            }
                            if file.write_all(&buffer[..n]).is_err() {
                                break;
                            }
                            offset += n as u64;
                            *downloaded_bytes.lock().unwrap() += n as u64;
                        },
                        Err(e) => {
                            errors.lock().unwrap().push(e.to_string());
                        }
                    }
                }
                Err(e) => {
                    errors.lock().unwrap().push(e.to_string());
                }
            }
        });
        handles.push(handle);
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
    }

    // 主线程轮询进度
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let all_done = handles.iter().all(|h| h.is_finished());
        let downloaded = *downloaded_bytes.lock().unwrap();
        let progress = (downloaded as f32 / content_length as f32) * 100.0;
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        progress_callback(DownloadCallbackInfo {
            progress: progress.min(99.0),
            downloaded_bytes: downloaded,
            total_bytes: content_length,
            speed_bytes_per_sec: downloaded as f64 / elapsed,
        });
        if all_done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    for handle in handles {
        handle.join().ok();
    }

    if cancel_flag.load(Ordering::Relaxed) {
        bail!("Download canceled");
    }

    let errs = errors.lock().unwrap();
    if !errs.is_empty() {
        bail!("Download failed: {}", errs.join("; "));
    }

    progress_callback(DownloadCallbackInfo {
        progress: 100.0,
        downloaded_bytes: content_length,
        total_bytes: content_length,
        speed_bytes_per_sec: 0.0,
    });
    Ok(())
}

pub fn download_file_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    println!("[ DOWNLOAD ] {} -> {}", url, output_path);

    // 使用临时文件，下载完成后再移动，避免部分写入残留
    let tmp_dir = std::env::temp_dir().join("CelemodTemp");
    if !tmp_dir.exists() {
        std::fs::create_dir(&tmp_dir)?;
    }
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let tmp_path = tmp_dir.join(format!("{}.tmp", hasher.finish()));
    let output = Path::new(output_path);

    let result = if multi_thread {
        download_multi_thread(url, &tmp_path, progress_callback, cancel_flag)
    } else {
        let mut file = std::fs::File::create(&tmp_path)?;
        let mut writer = BufWriter::new(&mut file);
        download_single(url, &mut writer, progress_callback, cancel_flag)
    };

    match result {
        Ok(()) => {
            std::fs::copy(&tmp_path, output)
                .with_context(|| format!("Failed to move downloaded file to {:?}", output))?;
            std::fs::remove_file(&tmp_path).ok();
            progress_callback(DownloadCallbackInfo {
                progress: 100.0,
                downloaded_bytes: output.metadata().map(|m| m.len()).unwrap_or(0),
                total_bytes: output.metadata().map(|m| m.len()).unwrap_or(0),
                speed_bytes_per_sec: 0.0,
            });
            Ok(())
        }
        Err(e) => {
            std::fs::remove_file(&tmp_path).ok();
            Err(e)
        }
    }
}
