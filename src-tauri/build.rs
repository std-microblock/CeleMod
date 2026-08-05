use std::{fs, process::Command};

fn main() {
    tauri_build::build();

    let git_hash = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir("..")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_else(|| "unknown".to_string());
    let version = fs::read_to_string("../version.txt")
        .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string());

    println!("cargo:rerun-if-changed=../version.txt");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rustc-env=VERSION={}", version.trim());
    println!("cargo:rustc-env=GIT_HASH={}", git_hash.trim());
}
