use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow, bail};

pub struct DownloadCallbackInfo {
    pub progress: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: f64,
}

const NUM_THREADS: usize = 8;
const MAX_RETRIES: usize = 3;

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
        .set("Accept-Encoding", "identity")
}

fn parse_content_range(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.strip_prefix("bytes ")?;
    let (range, total) = value.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}

/// 用一个单字节 Range 请求确认服务器当前仍然支持断点续传。
fn probe_range(url: &str, offset: u64) -> Option<u64> {
    let range = format!("bytes={offset}-{offset}");
    let response = make_request(url).set("Range", &range).call().ok()?;
    if response.status() != 206 {
        return None;
    }
    let (start, end, total) = parse_content_range(response.header("Content-Range")?)?;
    (start == offset && end == offset && total > offset).then_some(total)
}

fn wait_before_retry(retries_used: usize, cancel_flag: &Arc<AtomicBool>) -> anyhow::Result<()> {
    if cancel_flag.load(Ordering::Relaxed) {
        bail!("Download canceled");
    }
    std::thread::sleep(Duration::from_millis(300 * retries_used as u64));
    Ok(())
}

fn report_progress(
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    downloaded: u64,
    total: u64,
    started: Instant,
) {
    let progress = if total == 0 {
        0.0
    } else {
        (downloaded as f32 / total as f32) * 100.0
    };
    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    progress_callback(DownloadCallbackInfo {
        progress: progress.min(100.0),
        downloaded_bytes: downloaded,
        total_bytes: total,
        speed_bytes_per_sec: downloaded as f64 / elapsed,
    });
}

/// 单线程下载。在网络读取失败时最多重连三次；重连前先用 Range 探测，
/// 支持时从临时文件当前长度继续，否则清空临时文件并重新下载。
fn download_single(
    url: &str,
    output_path: &Path,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(true)
        .open(output_path)?;
    let mut downloaded = 0u64;
    let mut total_size = 0u64;
    let mut retries_used = 0usize;
    let mut retrying = false;
    let started = Instant::now();

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }

        let mut resume = false;
        if retrying {
            match probe_range(url, downloaded) {
                Some(probed_total)
                    if downloaded == 0 || total_size == 0 || total_size == probed_total =>
                {
                    resume = true;
                    total_size = probed_total;
                }
                _ => {
                    file.set_len(0)?;
                    file.seek(SeekFrom::Start(0))?;
                    downloaded = 0;
                    total_size = 0;
                    report_progress(progress_callback, 0, 0, started);
                }
            }
        }

        let mut request = make_request(url);
        if resume {
            request = request.set("Range", &format!("bytes={downloaded}-"));
        }

        let response = match request.call() {
            Ok(response) => response,
            Err(error) => {
                if retries_used >= MAX_RETRIES {
                    return Err(error.into());
                }
                retries_used += 1;
                retrying = true;
                wait_before_retry(retries_used, cancel_flag)?;
                continue;
            }
        };

        if resume {
            let content_range = response
                .header("Content-Range")
                .and_then(parse_content_range);
            if response.status() != 206
                || !matches!(content_range, Some((start, _, total)) if start == downloaded && total == total_size)
            {
                if retries_used >= MAX_RETRIES {
                    bail!("Server rejected download resume at byte {downloaded}");
                }
                retries_used += 1;
                retrying = true;
                file.set_len(0)?;
                file.seek(SeekFrom::Start(0))?;
                downloaded = 0;
                total_size = 0;
                wait_before_retry(retries_used, cancel_flag)?;
                continue;
            }
        } else {
            total_size = response
                .header("Content-Length")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
        }

        file.seek(SeekFrom::Start(downloaded))?;
        let mut reader = response.into_reader();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut last_progress = if total_size == 0 {
            -1.0
        } else {
            (downloaded as f32 / total_size as f32) * 100.0
        };
        let failure = loop {
            if cancel_flag.load(Ordering::Relaxed) {
                bail!("Download canceled");
            }
            let n = match reader.read(&mut buffer) {
                Ok(0) if total_size > 0 && downloaded < total_size => {
                    break Some(anyhow!(
                        "Connection closed after {downloaded} of {total_size} bytes"
                    ));
                }
                Ok(0) => break None,
                Ok(n) => n,
                Err(error) => break Some(error.into()),
            };
            file.write_all(&buffer[..n])?;
            downloaded += n as u64;
            if total_size > 0 {
                let progress = (downloaded as f32 / total_size as f32) * 100.0;
                if progress - last_progress >= 0.1 {
                    report_progress(progress_callback, downloaded, total_size, started);
                    last_progress = progress;
                }
            }
        };

        match failure {
            None => {
                file.flush()?;
                return Ok(());
            }
            Some(error) if retries_used >= MAX_RETRIES => return Err(error),
            Some(_) => {
                retries_used += 1;
                retrying = true;
                wait_before_retry(retries_used, cancel_flag)?;
            }
        }
    }
}

fn download_range_part(
    url: &str,
    output_path: &Path,
    start: u64,
    end: u64,
    content_length: u64,
    downloaded_bytes: &Arc<Mutex<u64>>,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new().write(true).open(output_path)?;
    let mut offset = start;
    let mut retries_used = 0usize;

    while offset <= end {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }

        let range = format!("bytes={offset}-{end}");
        let response = match make_request(url).set("Range", &range).call() {
            Ok(response) => response,
            Err(error) => {
                if retries_used >= MAX_RETRIES {
                    return Err(error.into());
                }
                retries_used += 1;
                wait_before_retry(retries_used, cancel_flag)?;
                continue;
            }
        };

        let valid_range = response
            .header("Content-Range")
            .and_then(parse_content_range)
            .is_some_and(|(response_start, response_end, total)| {
                response_start == offset && response_end == end && total == content_length
            });
        if response.status() != 206 || !valid_range {
            if retries_used >= MAX_RETRIES {
                bail!("Range request {range} was rejected by the server");
            }
            retries_used += 1;
            wait_before_retry(retries_used, cancel_flag)?;
            continue;
        }

        file.seek(SeekFrom::Start(offset))?;
        let mut reader = response.into_reader();
        let mut buffer = vec![0u8; 256 * 1024];
        let failure = loop {
            if cancel_flag.load(Ordering::Relaxed) {
                bail!("Download canceled");
            }
            let remaining = (end - offset + 1) as usize;
            let read_length = remaining.min(buffer.len());
            let n = match reader.read(&mut buffer[..read_length]) {
                Ok(0) => break Some(anyhow!("Range {range} ended early at byte {offset}")),
                Ok(n) => n,
                Err(error) => break Some(error.into()),
            };
            file.write_all(&buffer[..n])?;
            offset += n as u64;
            *downloaded_bytes.lock().unwrap() += n as u64;
            if offset > end {
                break None;
            }
        };

        match failure {
            None => return Ok(()),
            Some(error) if retries_used >= MAX_RETRIES => return Err(error),
            Some(_) => {
                retries_used += 1;
                // 初始的 Range 探测已经确认服务器支持续传；这里直接以新 offset
                // 发起下一次 Range 请求，它同时也是对重连能力的再次验证。
                wait_before_retry(retries_used, cancel_flag)?;
            }
        }
    }

    Ok(())
}

/// 多线程分段下载。
/// 先 HEAD 获取大小，再用单字节 Range 请求确认支持后并发下载各段。
fn download_multi_thread(
    url: &str,
    output_path: &Path,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let head = ureq::head(url)
        .set("User-Agent", &user_agent())
        .set("Accept", "*/*")
        .set("Accept-Encoding", "identity")
        .call();

    let mut content_length = head
        .ok()
        .and_then(|response| {
            response
                .header("Content-Length")
                .and_then(|value| value.parse().ok())
        })
        .unwrap_or(0);

    // 不信任仅来自 HEAD 的 Accept-Ranges，实际请求 bytes=0-0 验证。
    let supports_range = match probe_range(url, 0) {
        Some(probed_total) => {
            content_length = probed_total;
            true
        }
        None => false,
    };

    if !supports_range || content_length == 0 {
        return download_single(url, output_path, progress_callback, cancel_flag);
    }

    let file = std::fs::File::create(output_path)?;
    file.set_len(content_length)?;

    let chunk_size = content_length.div_ceil(NUM_THREADS as u64);
    let downloaded_bytes = Arc::new(Mutex::new(0u64));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let started = Instant::now();
    let mut handles = Vec::with_capacity(NUM_THREADS);

    for index in 0..NUM_THREADS {
        let start = index as u64 * chunk_size;
        if start >= content_length {
            break;
        }
        let end = (start + chunk_size - 1).min(content_length - 1);
        let url = url.to_string();
        let output_path = output_path.to_path_buf();
        let downloaded_bytes = Arc::clone(&downloaded_bytes);
        let errors = Arc::clone(&errors);
        let cancel_flag = Arc::clone(cancel_flag);

        handles.push(std::thread::spawn(move || {
            if let Err(error) = download_range_part(
                &url,
                &output_path,
                start,
                end,
                content_length,
                &downloaded_bytes,
                &cancel_flag,
            ) {
                errors
                    .lock()
                    .unwrap()
                    .push(format!("{start}-{end}: {error:#}"));
            }
        }));
    }

    loop {
        let all_done = handles.iter().all(|handle| handle.is_finished());
        let downloaded = *downloaded_bytes.lock().unwrap();
        report_progress(progress_callback, downloaded, content_length, started);
        if all_done || cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    for handle in handles {
        if handle.join().is_err() {
            errors
                .lock()
                .unwrap()
                .push("Range download worker panicked".to_string());
        }
    }

    if cancel_flag.load(Ordering::Relaxed) {
        bail!("Download canceled");
    }

    let errors = errors.lock().unwrap();
    if !errors.is_empty() {
        bail!("Download failed: {}", errors.join("; "));
    }
    drop(errors);

    let downloaded = *downloaded_bytes.lock().unwrap();
    if downloaded != content_length {
        bail!("Download ended after {downloaded} of {content_length} bytes");
    }

    report_progress(progress_callback, content_length, content_length, started);
    Ok(())
}

pub fn download_file_to_path_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    crate::logging::info(format_args!("[ DOWNLOAD ] {} -> {}", url, output_path));

    let output = Path::new(output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let result = if multi_thread {
        download_multi_thread(url, output, progress_callback, cancel_flag)
    } else {
        download_single(url, output, progress_callback, cancel_flag)
    };

    match result {
        Ok(()) => {
            let size = output
                .metadata()
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            progress_callback(DownloadCallbackInfo {
                progress: 100.0,
                downloaded_bytes: size,
                total_bytes: size,
                speed_bytes_per_sec: 0.0,
            });
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn sidecar_download_path(output: &Path) -> PathBuf {
    let mut path = output.as_os_str().to_os_string();
    path.push(".celemod");
    PathBuf::from(path)
}

pub fn download_file_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let output = Path::new(output_path);
    let temporary = sidecar_download_path(output);
    let result = download_file_to_path_with_progress(
        url,
        temporary.to_string_lossy().as_ref(),
        progress_callback,
        multi_thread,
        cancel_flag,
    );

    match result {
        Ok(()) => {
            if output.exists() {
                std::fs::remove_file(output).with_context(|| {
                    format!("Failed to replace downloaded file at {:?}", output)
                })?;
            }
            std::fs::rename(&temporary, output)
                .with_context(|| format!("Failed to finish downloaded file at {:?}", output))?;
            Ok(())
        }
        Err(error) => {
            std::fs::remove_file(&temporary).ok();
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, atomic::AtomicBool};

    use super::{download_single, parse_content_range};

    fn read_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut buffer = [0u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let length = stream.read(&mut buffer).unwrap();
            if length == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..length]);
        }
        String::from_utf8(request).unwrap()
    }

    #[test]
    fn parses_content_range() {
        assert_eq!(parse_content_range("bytes 10-19/100"), Some((10, 19, 100)));
        assert_eq!(parse_content_range("bytes */100"), None);
        assert_eq!(parse_content_range("invalid"), None);
    }

    #[test]
    fn single_download_resumes_after_connection_drop() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            let request = read_request(&mut first);
            assert!(!request.to_ascii_lowercase().contains("range:"));
            first
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n01234",
                )
                .unwrap();
            drop(first);

            let (mut probe, _) = listener.accept().unwrap();
            let request = read_request(&mut probe);
            assert!(request.contains("Range: bytes=5-5"));
            probe
                .write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 1\r\nContent-Range: bytes 5-5/10\r\nConnection: close\r\n\r\n5")
                .unwrap();
            drop(probe);

            let (mut resumed, _) = listener.accept().unwrap();
            let request = read_request(&mut resumed);
            assert!(request.contains("Range: bytes=5-"));
            resumed
                .write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 5-9/10\r\nConnection: close\r\n\r\n56789")
                .unwrap();
        });

        let output_path = std::env::temp_dir().join(format!(
            "celemod-resume-test-{}-{}.tmp",
            std::process::id(),
            address.port()
        ));
        let result = download_single(
            &format!("http://{address}"),
            &output_path,
            &mut |_| {},
            &Arc::new(AtomicBool::new(false)),
        );

        server.join().unwrap();
        result.unwrap();
        assert_eq!(std::fs::read(&output_path).unwrap(), b"0123456789");
        std::fs::remove_file(output_path).unwrap();
    }
}
