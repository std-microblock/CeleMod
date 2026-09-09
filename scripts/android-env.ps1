# Dot-source before invoking cargo/tauri/gradle. Does not change machine-wide settings.
$repo = Split-Path $PSScriptRoot -Parent
if (!$env:CARGO_HOME) { $env:CARGO_HOME = "$repo/.local/cargo" }
if (!$env:RUSTUP_HOME) { $env:RUSTUP_HOME = "$repo/.local/rustup" }
if (!$env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Android/openjdk/jdk-21.0.8' }
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = "$repo/.local/android-sdk" }
if (!$env:NDK_HOME) { $env:NDK_HOME = "$env:ANDROID_HOME/ndk/28.2.13676358" }
$env:PATH = "$env:CARGO_HOME/bin;$env:JAVA_HOME/bin;$env:ANDROID_HOME/platform-tools;$env:PATH"
$env:GRADLE_USER_HOME = "$repo/.local/gradle"
$env:CC_aarch64_linux_android = "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android28-clang.cmd"
$env:AR_aarch64_linux_android = "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe"
$env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = $env:CC_aarch64_linux_android
