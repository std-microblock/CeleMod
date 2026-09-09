param([string]$SourceZip, [string]$RuntimeApk)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$lock = Get-Content "$repo/android/runtime/upstream.json" -Raw | ConvertFrom-Json
$work = "$repo/.local/runtime-bootstrap"
New-Item -ItemType Directory -Force $work | Out-Null
function Get-VerifiedFile($url, $path, $hash) {
    if (!(Test-Path -LiteralPath $path)) {
        curl.exe --fail --location --retry 3 $url --output $path
        if ($LASTEXITCODE) { throw "Download failed: $url" }
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $hash) { throw "Checksum mismatch: $path" }
}
if (!$SourceZip) { $SourceZip = "$work/source.zip" }
if (!$RuntimeApk) { $RuntimeApk = "$work/runtime.apk" }
Get-VerifiedFile "https://api.github.com/repos/FireworkSky/RotatingartLauncher/zipball/$($lock.commit)" $SourceZip $lock.sourceArchiveSha256
Get-VerifiedFile $lock.apk $RuntimeApk $lock.apkSha256
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Extract-Entry($zip, $entryName, $destination) {
    $entry = $zip.GetEntry($entryName)
    if (!$entry) { throw "Missing upstream entry: $entryName" }
    New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
}
function Optimize-DotnetRuntime($archive) {
    $sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if (!$sevenZip) { throw '7-Zip is required to create the size-optimized Android runtime archive.' }
    $opt = [IO.Path]::GetFullPath((Join-Path $work 'dotnet-optimize'))
    $workRoot = [IO.Path]::GetFullPath($work) + [IO.Path]::DirectorySeparatorChar
    if (!$opt.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe optimization directory: $opt" }
    if (Test-Path -LiteralPath $opt) { Remove-Item -LiteralPath $opt -Recurse -Force }
    New-Item -ItemType Directory -Force $opt | Out-Null
    & $sevenZip.Source x $archive "-o$opt" -y | Out-Null
    if ($LASTEXITCODE) { throw 'Failed to decompress the Android .NET runtime.' }
    $tar = Join-Path $opt 'dotnet.tar'
    if (!(Test-Path -LiteralPath $tar)) { throw 'The Android .NET runtime did not contain dotnet.tar.' }
    # Diagnostics are disabled by RuntimeHost and the JNI host launches hostfxr
    # directly, so the debugger/DAC and dotnet muxer are dead weight in the APK.
    & $sevenZip.Source d $tar @(
        'dotnet',
        'shared/Microsoft.NETCore.App/10.0.4/libmscordaccore.so',
        'shared/Microsoft.NETCore.App/10.0.4/libmscordbi.so',
        'shared/Microsoft.NETCore.App/10.0.4/libSystem.Security.Cryptography.Native.Android.dex',
        'shared/Microsoft.NETCore.App/10.0.4/libSystem.Security.Cryptography.Native.Android.jar'
    ) -y | Out-Null
    if ($LASTEXITCODE) { throw 'Failed to remove unused Android .NET runtime files.' }
    $optimized = Join-Path $opt 'dotnet.tar.xz'
    & $sevenZip.Source a -txz $optimized $tar -mx=9 '-m0=LZMA2:d=64m:fb=273' -mmt=on -y | Out-Null
    if ($LASTEXITCODE) { throw 'Failed to recompress the Android .NET runtime.' }
    if ((Get-Item -LiteralPath $optimized).Length -ge (Get-Item -LiteralPath $archive).Length) {
        throw 'Optimized Android .NET runtime is not smaller than the upstream archive.'
    }
    Copy-Item -LiteralPath $optimized -Destination $archive -Force
}
function Convert-ZipAssetToTarXz($zipAsset, $archive, $rootName) {
    $sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
    if (!$sevenZip) { throw '7-Zip is required to optimize Android runtime assets.' }
    $opt = [IO.Path]::GetFullPath((Join-Path $work "$rootName-optimize"))
    $workRoot = [IO.Path]::GetFullPath($work) + [IO.Path]::DirectorySeparatorChar
    if (!$opt.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe optimization directory: $opt" }
    if (Test-Path -LiteralPath $opt) { Remove-Item -LiteralPath $opt -Recurse -Force }
    $content = Join-Path $opt $rootName
    New-Item -ItemType Directory -Force $content | Out-Null
    & $sevenZip.Source x $zipAsset "-o$content" -y | Out-Null
    if ($LASTEXITCODE) { throw "Failed to extract $zipAsset." }
    $tar = Join-Path $opt "$rootName.tar"
    Push-Location $opt
    try {
        & $sevenZip.Source a -ttar $tar $rootName -mx=0 -y | Out-Null
        if ($LASTEXITCODE) { throw "Failed to create $rootName.tar." }
    } finally { Pop-Location }
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    & $sevenZip.Source a -txz $archive $tar -mx=9 '-m0=LZMA2:d=16m:fb=273' -mmt=on -y | Out-Null
    if ($LASTEXITCODE) { throw "Failed to create $archive." }
}
$source = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $SourceZip))
$apk = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $RuntimeApk))
try {
    $prefix = ($source.Entries | Select-Object -First 1).FullName.Split('/')[0] + '/'
    foreach ($entry in $source.Entries) {
        $sdl = $prefix + 'app/src/main/java/org/libsdl/app/'
        if ($entry.FullName.StartsWith($sdl) -and $entry.Name.EndsWith('.java')) {
            Extract-Entry $source $entry.FullName "$repo/android/runtime/vendor/org/libsdl/app/$($entry.Name)"
            if ($entry.Name -eq 'SDLSurface.java') {
                $file = "$repo/android/runtime/vendor/org/libsdl/app/SDLSurface.java"
                # Unused import ties SDL to RAL's Compose controls; CeleMod supplies its own overlay.
                (Get-Content $file -Raw).Replace('import com.app.ralaunch.feature.controls.TouchPointerTracker;', '') | Set-Content $file
            }
            if ($entry.Name -eq 'SDLControllerManager.java') {
                $file = "$repo/android/runtime/vendor/org/libsdl/app/SDLControllerManager.java"
                # CeleMod maps its touch stick to keyboard directions; do not register
                # RAL's unused virtual gamepad ahead of a user's real controller.
                (Get-Content $file -Raw).Replace('if (!virtualJoystickAdded) {', 'if (!virtualJoystickAdded && com.app.ralaunch.core.common.SettingsAccess.getInstance().isVirtualControllerEnabled()) {') | Set-Content $file
            }
        }
    }
    Extract-Entry $source ($prefix + 'LICENSE') "$repo/android/runtime/LICENSE.RotatingArtLauncher"
    Extract-Entry $source ($prefix + 'external/libs/fmod.jar') "$repo/android/runtime/libs/fmod.jar"
    Extract-Entry $source ($prefix + 'app/libs/libSystem.Security.Cryptography.Native.Android.jar') "$repo/android/runtime/libs/libSystem.Security.Cryptography.Native.Android.jar"
    foreach ($lib in $lock.nativeLibraries) {
        Extract-Entry $apk "lib/arm64-v8a/$lib" "$repo/android/runtime/jniLibs/arm64-v8a/$lib"
    }
    foreach ($asset in 'dotnet.tar.xz', 'MonoMod.zip', 'patches/com.app.ralaunch.everest.fix.zip', 'patches/com.app.ralaunch.everest.miniinstaller.fix.zip') {
        Extract-Entry $apk "assets/$asset" "$repo/android/runtime/assets/$asset"
    }
    Optimize-DotnetRuntime "$repo/android/runtime/assets/dotnet.tar.xz"
    Convert-ZipAssetToTarXz "$repo/android/runtime/assets/MonoMod.zip" "$repo/android/runtime/assets/monomod.tar.xz" 'monomod'
} finally { $source.Dispose(); $apk.Dispose() }
Write-Host 'Pinned RAL runtime ready. No Celeste game resources were extracted or bundled.'
