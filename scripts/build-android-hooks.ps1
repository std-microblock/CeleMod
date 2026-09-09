param([string]$Dotnet)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (!$Dotnet) {
    $Dotnet = if (Test-Path "$repo/.local/dotnet-sdk/dotnet.exe") { "$repo/.local/dotnet-sdk/dotnet.exe" } else { 'dotnet' }
}
& $Dotnet build "$repo/android/runtime/managed/CeleMod.Android.csproj" -c Release --nologo
if ($LASTEXITCODE) { throw 'Managed Android hooks build failed. Install a .NET 8 SDK or newer.' }
Copy-Item "$repo/android/runtime/managed/bin/Release/net8.0/CeleMod.Android.dll" "$repo/android/runtime/assets/CeleMod.Android.dll" -Force
