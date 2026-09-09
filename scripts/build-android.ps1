param([switch]$SkipFrontend, [switch]$SkipRust, [switch]$Release)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    if (!(Test-Path android/runtime/assets/dotnet.tar.xz)) { throw 'Run scripts/prepare-android-runtime.ps1 first.' }
    & "$PSScriptRoot/build-android-hooks.ps1"
    & "$PSScriptRoot/build-android-native.ps1"
    & "$PSScriptRoot/build-android-steam.ps1"
    if (!$SkipFrontend) {
        pnpm --dir src/celemod-ui build
        if ($LASTEXITCODE) { throw 'Frontend build failed' }
    }
    $project = Join-Path $repo 'src-tauri/gen/android'
    $generated = Join-Path $project 'app/src/main/java/cc/microblock/celemod/generated'
    New-Item -ItemType Directory -Force $generated | Out-Null
    # The copy-based build bypasses the Tauri CLI, including its version writer.
    # Generate this ignored file on every build instead of relying on local state.
    $version = (Get-Content version.txt -Raw).Trim()
    if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw 'Android version.txt must use major.minor.patch.' }
    $major, $minor, $patch = [long]$Matches[1], [long]$Matches[2], [long]$Matches[3]
    $versionCode = $major * 1000000 + $minor * 1000 + $patch
    if ($minor -gt 999 -or $patch -gt 999 -or $versionCode -lt 1 -or $versionCode -gt 2100000000) {
        throw 'Android version is outside the supported versionCode range.'
    }
    if ((Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version -ne $version) {
        throw 'version.txt and tauri.conf.json versions must match.'
    }
    "tauri.android.versionName=$version`ntauri.android.versionCode=$versionCode" |
        Set-Content (Join-Path $project 'app/tauri.properties') -Encoding ascii
    $env:TAURI_ANDROID_PROJECT_PATH = $project
    $env:WRY_ANDROID_PACKAGE = 'cc.microblock.celemod'
    $env:WRY_ANDROID_LIBRARY = 'cele_mod_lib'
    $env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR = $generated
    $env:TAURI_CONFIG = Get-Content src-tauri/tauri.android.conf.json -Raw
    $profile = if ($Release) { 'release' } else { 'debug' }
    if (!$SkipRust) {
        $cargoArgs = @('build', '--locked', '--target', 'aarch64-linux-android', '-p', 'cele-mod', '--lib', '--features', 'custom-protocol')
        if ($Release) { $cargoArgs += '--release' }
        cargo @cargoArgs
        if ($LASTEXITCODE) { throw 'Rust Android build failed' }
    }
    $jni = Join-Path $project 'app/src/main/jniLibs/arm64-v8a'
    New-Item -ItemType Directory -Force $jni | Out-Null
    Copy-Item "target/aarch64-linux-android/$profile/libcele_mod_lib.so" $jni -Force
    # Keep the full symbol file under target/ for debugging, not inside every test APK.
    & "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" --strip-debug "$jni/libcele_mod_lib.so"
    if ($LASTEXITCODE) { throw 'Failed to strip packaged debug info' }
    Push-Location $project
    try {
        $task = if ($Release) { ':app:assembleArm64Release' } else { ':app:assembleArm64Debug' }
        ./gradlew.bat $task -PcelemodPrebuiltRust=true --console=plain --no-daemon
        if ($LASTEXITCODE) { throw 'Gradle build failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
