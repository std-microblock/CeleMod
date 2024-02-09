use std::cell::RefCell;
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::rc::Rc;
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
            #[cfg(debug_assertions)]
            panic!("aria2c.exe not found.");

            #[cfg(not(debug_assertions))]
            std::fs::write(&path, include_bytes_zstd!("./resources/aria2c.exe", 21)).unwrap();
        }
        path
    };
}

pub struct DownloadCallbackInfo<'a> {
    pub progress: f32,
    pub child: &'a mut std::process::Child,
}

pub fn download_file_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &mut dyn FnMut(DownloadCallbackInfo),
) -> anyhow::Result<()> {
    let aria2c_path = &*ARIA2C_PATH;

    println!("[ ARIA2C ] Downloading {} to {}", url, output_path);

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const DETACHED_PROCESS: u32 = 0x00000008;

    let output_path = Path::new(output_path);
    // 构建 aria2c 命令
    let command = Command::new(aria2c_path)
        .arg("-x8")
        .arg("-s8")
        .arg("-d")
        .arg(output_path.parent().unwrap())
        .arg("-o")
        .arg(output_path.file_name().unwrap())
        .arg(url)
        .arg("--console-log-level=error")
        .arg("--allow-overwrite=true")
        .arg("--summary-interval=1")
        // .arg("--max-tries=5")
        // .arg("--timeout=600000")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();

    // 检查是否成功启动子进程
    let mut child = match command {
        Ok(child) => child,
        Err(_) => bail!("Failed to start aria2c process."),
    };

    let mut err: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
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
                    progress_callback(DownloadCallbackInfo {
                        progress,
                        child: &mut child,
                    });
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
                bail!(format!("Failed to download file. {}", err.lock().unwrap()))
            } else {
                Ok(())
            }
        }
        Err(_) => bail!("Failed to download file."),
    }
}
