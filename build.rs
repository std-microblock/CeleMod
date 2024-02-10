use std::{fs::File, io::Read, process::Command};

fn main() {
    let output = Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
        .unwrap();
    let git_hash = String::from_utf8(output.stdout).unwrap();
    let mut version = "".to_string();
    File::open("version.txt").unwrap()
                            .read_to_string(&mut version).unwrap();
    println!("cargo:rustc-env=VERSION={}", version);
    println!("cargo:rustc-env=GIT_HASH={}", git_hash);

    // possible architecture: win-x64 win-x86 linux osx
    let target = std::env::var("TARGET").unwrap();
    let target = target.split('-').collect::<Vec<_>>();
    let target = target[2];
    let target = match target {
        "windows" => {
            let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
            match arch.as_str() {
                "x86_64" => "win-x64",
                "x86" => "win-x86",
                _ => panic!("Unsupported target"),
            }
        },
        "linux" => "linux",
        "darwin" => "osx",
        _ => panic!("Unsupported target"),
    };
    println!("cargo:rustc-env=TARGET={}", target);
    

    Command::new("./sciter/packfolder.exe")
        .arg("./src/celemod-ui/dist")
        .arg("./resources/dist.rc")
        .arg("-binary")
        .spawn()
        .unwrap();
}
