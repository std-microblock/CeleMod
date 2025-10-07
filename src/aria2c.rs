use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

use std::sync::{Arc, Mutex};

use anyhow::{bail, Context};
use lazy_static::lazy_static;

lazy_static! {
    static ref ARIA2C_PATH: String = {
        let path = std::env::current_dir()
            .unwrap()
            .join("aria2c.exe")
            .to_str()
            .unwrap()
            .to_string();
        if !Path::new(&path).exists() {
            let version_command = Command::new("aria2c").arg("--version").output();
            if version_command.is_err() {
                let _ = msgbox::create("aria2c not found\nIf you are in linux, please install it via package manager\nPlease extract all the files in the zip into a folder.\nIf you are using CI builds, obtain dependencies from the latest release build first.", "Dependency Missing", msgbox::IconType::Error);
                panic!("aria2c.exe not found.");
            } else {
                return "aria2c".to_string();
            }
        }
        path
    };
}

pub struct DownloadCallbackInfo {
    pub progress: f32,
}

pub fn download_file_with_progress_ureq(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
) -> anyhow::Result<()> {
    let tmp_dir_path = std::env::temp_dir().join("CelemodTemp");
    if !tmp_dir_path.exists() {
        std::fs::create_dir(&tmp_dir_path)?;
    }
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let tmp_output_path = tmp_dir_path
        .join(format!("{}.tmp", hasher.finish()))
        .to_str()
        .unwrap()
        .to_string();

    let tmp_path = Path::new(&tmp_output_path);
    let output_path = Path::new(output_path);
    let mut req = ureq::get(url);
    let req = 
        req.set("Connection", "keep-alive")
            .set(
                "User-Agent",
                format!(
                    "CeleMod/{}-{} ureq",
                    env!("VERSION"),
                    &env!("GIT_HASH")[..6]
                )
                .as_str(),
            )
            .set("Accept-Encoding", "gzip, deflate, br")
            .set("Accept", "*/*")
            .set("Cache-Control", "no-cache");

    let mut resp = req.call();
    let mut file = std::fs::File::create(&tmp_path)?;
    let mut total_size = 0;
    let mut downloaded_size = 0;
    let mut buffer = [0u8; 1024 * 1024];
    let mut progress = 0.0;
    let mut last_progress = 0.0;
    match resp {
        Ok(mut resp) => {
            total_size = resp
                .header("Content-Length")
                .unwrap_or("0")
                .parse()
                .unwrap();
            let mut reader = resp.into_reader();
            loop {
                let read_size = reader.read(&mut buffer)?;
                if read_size == 0 {
                    break;
                }

                file.write_all(&buffer[..read_size])?;
                downloaded_size += read_size;
                progress = (downloaded_size as f32 / total_size as f32) * 100.0;
                if progress - last_progress > 0.1 {
                    progress_callback(DownloadCallbackInfo { progress });
                    last_progress = progress;
                }
            }
        }
        Err(e) => {
            bail!(e);
        }
    }
    progress_callback(DownloadCallbackInfo { progress: 100.0 });
    std::fs::rename(&tmp_path, output_path)?;
    Ok(())
}

pub fn download_file_with_progress_aria2c(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    multi_thread: bool,
) -> anyhow::Result<()> {
    let aria2c_path = &*ARIA2C_PATH;

    println!("[ ARIA2C ] Downloading {} to {}", url, output_path);

    let output_path = Path::new(output_path);
    // 构建 aria2c 命令
    let mut command = Command::new(aria2c_path);
    let command = if multi_thread {
        command.arg("-x8").arg("-s8")
    } else {
        &mut command
    }
    .arg("--no-conf")
    .arg("-d")
    .arg(output_path.parent().unwrap())
    .arg("-o")
    .arg(output_path.file_name().unwrap())
    .arg(url)
    .arg("--timeout=600")
    .arg(format!(
        "--user-agent=CeleMod/{}-{}",
        env!("VERSION"),
        &env!("GIT_HASH")[..6]
    ))
    .arg("--console-log-level=error")
    .arg("--allow-overwrite=true")
    .arg("--summary-interval=1")
    // .arg("--max-tries=5")
    // .arg("--timeout=600000")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const DETACHED_PROCESS: u32 = 0x00000008;
    #[cfg(target_os = "windows")]
    let command = command.creation_flags(CREATE_NO_WINDOW).spawn();

    #[cfg(not(target_os = "windows"))]
    let command = command.spawn();

    // 检查是否成功启动子进程
    let mut child = match command {
        Ok(child) => child,
        Err(_) => bail!("Failed to start aria2c process."),
    };

    let err: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr = child.stderr.take().unwrap();
    let err_ref = Arc::clone(&err);
    // 读取错误输出
    let thread = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            println!("Error: {}", line);
            err_ref.lock().unwrap().push_str(&(line + "\n"));
        }
    });

    // 读取管道，实时报告进度
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    'a: for line in reader.lines().map_while(Result::ok) {
        for line in line.split('\n').map(|f| f.trim()) {
            println!("Recv: {}", line);
            if line.starts_with("[#") {
                let progress: anyhow::Result<f32> = try {
                    let start = line.find('(').context("Failed to find start index.")? + 1;
                    let end = line.find('%').context("Failed to find end index.")?;
                    let progress = line[start..end]
                        .parse::<f32>()
                        .context("Failed to parse progress.")?;
                    progress
                };
                if let Ok(progress) = progress {
                    progress_callback(DownloadCallbackInfo { progress });
                }
            }

            if line.contains("download completed") {
                break 'a;
            }
        }
    }

    thread.join().unwrap();
    // 等待子进程结束
    match child.wait() {
        Ok(status) => {
            if !status.success() || !Path::new(output_path).exists() {
                bail!(format!(
                    "Failed to download file. Reason: {}",
                    err.lock().unwrap()
                ))
            } else {
                Ok(())
            }
        }
        Err(_) => bail!("Failed to download file."),
    }
}

pub fn download_file_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
    use_aria2: bool,
) -> anyhow::Result<()> {
    if use_aria2 {
        download_file_with_progress_aria2c(url, output_path, progress_callback, true)
    } else {
        download_file_with_progress_ureq(url, output_path, progress_callback)
    }
}
