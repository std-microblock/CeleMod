param([string]$Dotnet)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (!$Dotnet) { $Dotnet = if (Test-Path "$repo/.local/dotnet-sdk/dotnet.exe") { "$repo/.local/dotnet-sdk/dotnet.exe" } else { 'dotnet' } }
& $Dotnet restore "$repo/android/steam/CeleMod.Steam.csproj" --locked-mode --nologo
if ($LASTEXITCODE) { throw 'Steam worker dependency restore failed' }
& $Dotnet publish "$repo/android/steam/CeleMod.Steam.csproj" -c Release --no-restore --nologo -p:UseAppHost=false -o "$repo/android/runtime/assets/steam"
if ($LASTEXITCODE) { throw 'Steam worker build failed' }
# Package dynamically linked SteamKit and dependency notices, not Steam client or proprietary game binaries.
Copy-Item "$repo/android/steam/THIRD-PARTY-NOTICES.txt" "$repo/android/runtime/assets/steam/THIRD-PARTY-NOTICES.txt" -Force
Get-ChildItem "$repo/android/steam/licenses" -File | ForEach-Object { Copy-Item $_.FullName "$repo/android/runtime/assets/steam/$($_.Name)" -Force }
$sevenZip = Get-Command 7z.exe -ErrorAction SilentlyContinue
if (!$sevenZip) { throw '7-Zip is required to package the size-optimized Steam worker.' }
$work = "$repo/.local/runtime-bootstrap"
New-Item -ItemType Directory -Force $work | Out-Null
$tar = "$work/steam.tar"
$archive = "$repo/android/runtime/assets/steam.tar.xz"
Remove-Item -LiteralPath $tar, $archive -Force -ErrorAction SilentlyContinue
Push-Location "$repo/android/runtime/assets"
try {
    & $sevenZip.Source a -ttar $tar steam -mx=0 -y | Out-Null
    if ($LASTEXITCODE) { throw 'Failed to create the Steam worker archive.' }
} finally { Pop-Location }
& $sevenZip.Source a -txz $archive $tar -mx=9 '-m0=LZMA2:d=32m:fb=273' -mmt=on -y | Out-Null
if ($LASTEXITCODE) { throw 'Failed to compress the Steam worker archive.' }
$assetsRoot = [IO.Path]::GetFullPath("$repo/android/runtime/assets") + [IO.Path]::DirectorySeparatorChar
$steamRoot = [IO.Path]::GetFullPath("$repo/android/runtime/assets/steam")
if (!$steamRoot.StartsWith($assetsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Steam asset directory: $steamRoot" }
Remove-Item -LiteralPath $steamRoot -Recurse -Force
$monoModZip = "$repo/android/runtime/assets/MonoMod.zip"
if ((Test-Path -LiteralPath "$repo/android/runtime/assets/monomod.tar.xz") -and (Test-Path -LiteralPath $monoModZip)) {
    Remove-Item -LiteralPath $monoModZip -Force
}
