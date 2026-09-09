param(
    [Parameter(Mandatory=$true)][string]$GameDirectory,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Name = 'celeste',
    [string]$Serial
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$source = (Resolve-Path -LiteralPath $GameDirectory).Path
if (!(Test-Path -LiteralPath "$source/Content") -or
    (!(Test-Path -LiteralPath "$source/Celeste.exe") -and !(Test-Path -LiteralPath "$source/Celeste.dll"))) {
    throw 'Choose the extracted game directory containing Content and Celeste.exe or Celeste.dll.'
}
$device = @()
if ($Serial) { $device = @('-s', $Serial) }
$root = '/sdcard/Android/data/cc.microblock.celemod/files/games'
$target = "$root/$Name"
adb @device shell mkdir -p $target
if ($LASTEXITCODE) { throw 'Install and open CeleMod before deploying the game.' }
# No --delete, no uninstall, no modification of the desktop copy or other games.
adb @device push --sync "$source/." "$target/"
if ($LASTEXITCODE) { throw 'adb push failed' }
Write-Host "Deployed to $target. Reopen CeleMod to discover this game."
