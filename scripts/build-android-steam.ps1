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
