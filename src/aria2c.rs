use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use anyhow::Context;
#[macro_use]
use lazy_static::lazy_static;

lazy_static! {
    static ref ARIA2C_PATH: String = {
        let path = std::env::current_dir()
            .unwrap()
            .join("aria2c.exe")
            .to_str()
            .unwrap()
            .to_string();
        std::fs::write(&path, include_bytes!("../resources/aria2c.exe")).unwrap();
        path
    };
}



pub struct DownloadCallbackInfo<'a> {
    pub progress: f32,
    pub child: & 'a mut std::process::Child,
}

pub fn download_file_with_progress(
    url: &str,
    output_path: &str,
    progress_callback: &dyn Fn(DownloadCallbackInfo),
) -> Result<(), String> {
    let aria2c_path = &*ARIA2C_PATH; // 从环境变量中获取 aria2c 路径

    println!("[ ARIA2C ] Downloading {} to {}", url, output_path);

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
        .stdout(Stdio::piped())
        .spawn();

    // 检查是否成功启动子进程
    let mut child = match command {
        Ok(child) => child,
        Err(_) => return Err(String::from("Failed to start aria2c process.")),
    };

    // 读取管道，实时报告进度
    let stdout = child.stdout.take().unwrap();
    let reader = BufReader::new(stdout);
    'a: for line in reader.lines().flatten() {
        for line in line.split("\n").map(|f| f.trim()) {
            println!("Recv: {}", line);
            // 处理 aria2c 控制台输出
            // [#798a50 27MiB/302MiB(9%) CN:8 DL:500KiB ETA:9m23s]
            if line.starts_with("[#") {
                let progress: anyhow::Result<f32> = try {
                    let start = line.find("(").context("Failed to find start index.")? + 1;
                    let end = line.find("%").context("Failed to find end index.")?;
                    let progress = line[start..end]
                        .parse::<f32>()
                        .context("Failed to parse progress.")?;
                    progress
                };
                if let Ok(progress) = progress {
                    progress_callback(DownloadCallbackInfo { progress, child: &mut child });
                }
            }

            if line.contains("download completed"){
                break 'a;
            }
        }
    }

    // 等待子进程结束
    match child.wait() {
        Ok(_) => Ok(()),
        Err(_) => Err(String::from("Failed to download file.")),
    }
}
