use std::collections::VecDeque;
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
/// 进度回调的最小间隔。多线程路径一直按这个节奏上报，单线程路径现在也一样。
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

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

fn wait_if_paused(
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    while pause_flag.load(Ordering::Relaxed) {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

/// 报告「当前」下载速度的滑动窗口。
///
/// 之前上报的是 `已下载字节 / 从开始到现在的秒数`，也就是整段下载的平均速度：
/// 只要镜像中途变慢或卡住，界面上的速度就会一路平滑下滑（用户看到的是「越下越
/// 慢」，而不是「卡住了」），重试等待期间也不会有任何变化。改成用最近几秒的窗口
/// 计算，速度才会如实反映当下。
struct SpeedMeter {
    started: Instant,
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    /// 采样窗口。比进度回调间隔（200ms）长得多，足以抹平抖动；又足够短，
    /// 卡顿几秒就能看出来。
    const WINDOW: Duration = Duration::from_secs(3);

    fn new(now: Instant) -> Self {
        Self {
            started: now,
            samples: VecDeque::with_capacity(8),
        }
    }

    /// 记一次采样（累计字节数），返回最近一个窗口内的平均速度。
    fn record(&mut self, now: Instant, downloaded: u64) -> f64 {
        self.samples.push_back((now, downloaded));
        // 多留一个窗口外的采样点，避免窗口起点离 now 太近导致速度跳动剧烈。
        while self.samples.len() > 2 && now.duration_since(self.samples[0].0) > Self::WINDOW {
            self.samples.pop_front();
        }
        // 下载刚开始、窗口还没铺满时，退回「从开始到现在」的平均速度。
        let (from_time, from_bytes) = if now.duration_since(self.started) < Self::WINDOW {
            (self.started, 0)
        } else {
            self.samples[0]
        };
        let elapsed = now.duration_since(from_time).as_secs_f64().max(0.001);
        downloaded.saturating_sub(from_bytes) as f64 / elapsed
    }
}

fn report_progress(
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    downloaded: u64,
    total: u64,
    speed_bytes_per_sec: f64,
) {
    let progress = if total == 0 {
        0.0
    } else {
        (downloaded as f32 / total as f32) * 100.0
    };
    progress_callback(DownloadCallbackInfo {
        progress: progress.min(100.0),
        downloaded_bytes: downloaded,
        total_bytes: total,
        speed_bytes_per_sec,
    });
}

/// 单线程下载。在网络读取失败时最多重连三次；重连前先用 Range 探测，
/// 支持时从临时文件当前长度继续，否则清空临时文件并重新下载。
fn download_single(
    url: &str,
    output_path: &Path,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
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
    let mut last_report = started;
    let mut speed_meter = SpeedMeter::new(started);

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }
        wait_if_paused(cancel_flag, pause_flag)?;

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
                    report_progress(progress_callback, 0, 0, 0.0);
                    let now = Instant::now();
                    last_report = now;
                    speed_meter = SpeedMeter::new(now);
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
            wait_if_paused(cancel_flag, pause_flag)?;
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
                let now = Instant::now();
                // 即使进度没动也要定时上报，卡住时界面上的速度才会掉下去。
                if progress - last_progress >= 0.1
                    || now.duration_since(last_report) >= PROGRESS_INTERVAL
                {
                    let speed = speed_meter.record(now, downloaded);
                    report_progress(progress_callback, downloaded, total_size, speed);
                    last_progress = progress;
                    last_report = now;
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
    pause_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new().write(true).open(output_path)?;
    let mut offset = start;
    let mut retries_used = 0usize;

    while offset <= end {
        if cancel_flag.load(Ordering::Relaxed) {
            bail!("Download canceled");
        }
        wait_if_paused(cancel_flag, pause_flag)?;

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
            wait_if_paused(cancel_flag, pause_flag)?;
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
    pause_flag: &Arc<AtomicBool>,
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
        return download_single(url, output_path, progress_callback, cancel_flag, pause_flag);
    }

    let file = std::fs::File::create(output_path)?;
    file.set_len(content_length)?;

    let chunk_size = content_length.div_ceil(NUM_THREADS as u64);
    let downloaded_bytes = Arc::new(Mutex::new(0u64));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let started = Instant::now();
    let mut speed_meter = SpeedMeter::new(started);
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
        let pause_flag = Arc::clone(pause_flag);

        handles.push(std::thread::spawn(move || {
            if let Err(error) = download_range_part(
                &url,
                &output_path,
                start,
                end,
                content_length,
                &downloaded_bytes,
                &cancel_flag,
                &pause_flag,
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
        let speed = speed_meter.record(Instant::now(), downloaded);
        report_progress(progress_callback, downloaded, content_length, speed);
        if all_done || cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(PROGRESS_INTERVAL);
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

    let speed = speed_meter.record(Instant::now(), content_length);
    report_progress(progress_callback, content_length, content_length, speed);
    Ok(())
}

pub fn download_file_to_path_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    crate::logging::info(format_args!("[ DOWNLOAD ] {} -> {}", url, output_path));

    let output = Path::new(output_path);
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut result = if multi_thread {
        download_multi_thread(url, output, progress_callback, cancel_flag, pause_flag)
    } else {
        download_single(url, output, progress_callback, cancel_flag, pause_flag)
    };
    // 不使用多线程分段时（服务器不支持 Range，或分段下载中途失败），
    // 回退到同一 URL 的单连接下载，而不是改写到某个固定的镜像节点。
    if result.is_err() && multi_thread && !cancel_flag.load(Ordering::Relaxed) {
        crate::logging::warn(format_args!(
            "Parallel download failed; retrying with a single connection: {url}"
        ));
        result = download_single(url, output, progress_callback, cancel_flag, pause_flag);
    }

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
    pause_flag: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let output = Path::new(output_path);
    let temporary = sidecar_download_path(output);
    let result = download_file_to_path_with_progress(
        url,
        temporary.to_string_lossy().as_ref(),
        progress_callback,
        multi_thread,
        cancel_flag,
        pause_flag,
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
    use std::sync::{Arc, Mutex, atomic::AtomicBool};
    use std::time::{Duration, Instant};

    use super::{
        SpeedMeter, download_file_to_path_with_progress, download_single, parse_content_range,
    };

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

    const MIB: f64 = 1024.0 * 1024.0;

    #[test]
    fn speed_meter_reports_current_not_lifetime_average() {
        let start = Instant::now();
        let mut meter = SpeedMeter::new(start);

        // 第一秒下了 4 MiB，窗口还没铺满，退回整段平均：4 MiB/s。
        let speed = meter.record(start + Duration::from_secs(1), 4 * MIB as u64);
        assert!((speed - 4.0 * MIB).abs() < 1.0, "{speed}");

        // 之后镜像卡了 4 秒：旧的「整段平均」只会从 4 MiB/s 慢慢往下掉，
        // 新的窗口速度直接是 0。
        let speed = meter.record(start + Duration::from_secs(5), 4 * MIB as u64);
        assert_eq!(speed, 0.0);

        // 又恢复成 1 MiB/s，报出来的也是 1 MiB/s，而不是被前面的高速率拉高。
        let speed = meter.record(start + Duration::from_secs(6), 5 * MIB as u64);
        assert!((speed - MIB).abs() < 1.0, "{speed}");
    }

    #[test]
    fn speed_meter_drops_samples_outside_the_window() {
        let start = Instant::now();
        let mut meter = SpeedMeter::new(start);
        for second in 1..=5 {
            meter.record(start + Duration::from_secs(second), second * MIB as u64);
        }
        // 最近 3 秒共 3 MiB -> 1 MiB/s；如果窗口没丢掉旧采样点会报得更高。
        let speed = meter.record(start + Duration::from_secs(5), 5 * MIB as u64);
        assert!((speed - MIB).abs() < 1.0, "{speed}");
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
            &Arc::new(AtomicBool::new(false)),
        );

        server.join().unwrap();
        result.unwrap();
        assert_eq!(std::fs::read(&output_path).unwrap(), b"0123456789");
        std::fs::remove_file(output_path).unwrap();
    }

    #[test]
    fn multi_thread_download_falls_back_to_single_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_requests = Arc::clone(&requests);
        let server = std::thread::spawn(move || {
            let payload = b"0123456789";
            // HEAD、Range 探测和回退后的完整 GET 各占一个连接。
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_request(&mut stream);
                let lower = request.to_ascii_lowercase();
                server_requests.lock().unwrap().push(lower.clone());
                if lower.starts_with("head ") {
                    stream
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n")
                        .unwrap();
                    continue;
                }
                // 模拟忽略 Range、始终返回完整 200 响应的镜像节点。
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n",
                    )
                    .unwrap();
                stream.write_all(payload).unwrap();
            }
        });

        let output_path = std::env::temp_dir().join(format!(
            "celemod-range-fallback-test-{}-{}.tmp",
            std::process::id(),
            address.port()
        ));
        let result = download_file_to_path_with_progress(
            &format!("http://{address}/gamebanana-file/a.zip"),
            output_path.to_string_lossy().as_ref(),
            &mut |_| {},
            true,
            &Arc::new(AtomicBool::new(false)),
            &Arc::new(AtomicBool::new(false)),
        );

        server.join().unwrap();
        result.unwrap();
        assert_eq!(std::fs::read(&output_path).unwrap(), b"0123456789");

        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 3, "{requests:?}");
        assert!(requests[0].starts_with("head "), "{requests:?}");
        assert!(requests[1].contains("range:"), "{requests:?}");
        assert!(
            !requests[2].contains("range:"),
            "fallback should keep the same URL with a plain GET: {requests:?}"
        );
        drop(requests);
        std::fs::remove_file(output_path).unwrap();
    }
}
