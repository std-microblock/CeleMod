param([switch]$SkipFrontend, [switch]$SkipRust)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    if (!(Test-Path android/runtime/assets/dotnet.tar.xz)) { throw 'Run scripts/prepare-android-runtime.ps1 first.' }
    & "$PSScriptRoot/build-android-hooks.ps1"
    & "$PSScriptRoot/build-android-steam.ps1"
    if (!$SkipFrontend) {
        pnpm --dir src/celemod-ui build
        if ($LASTEXITCODE) { throw 'Frontend build failed' }
    }
    $project = Join-Path $repo 'src-tauri/gen/android'
    $generated = Join-Path $project 'app/src/main/java/cc/microblock/celemod/generated'
    $env:TAURI_ANDROID_PROJECT_PATH = $project
    $env:WRY_ANDROID_PACKAGE = 'cc.microblock.celemod'
    $env:WRY_ANDROID_LIBRARY = 'cele_mod_lib'
    $env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $generated
    $env:TAURI_CONFIG = Get-Content src-tauri/tauri.android.conf.json -Raw
    if (!$SkipRust) {
        cargo build --target aarch64-linux-android -p cele-mod --lib --features custom-protocol
        if ($LASTEXITCODE) { throw 'Rust Android build failed' }
    }
    $jni = Join-Path $project 'app/src/main/jniLibs/arm64-v8a'
    New-Item -ItemType Directory -Force $jni | Out-Null
    Copy-Item target/aarch64-linux-android/debug/libcele_mod_lib.so $jni -Force
    # Keep the full symbol file under target/ for debugging, not inside every test APK.
    & "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" --strip-debug "$jni/libcele_mod_lib.so"
    if ($LASTEXITCODE) { throw 'Failed to strip packaged debug info' }
    Push-Location $project
    try {
        ./gradlew.bat :app:assembleArm64Debug -PcelemodPrebuiltRust=true --console=plain
        if ($LASTEXITCODE) { throw 'Gradle build failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
