# Build the matching Android/ARM64 backend for ImGuiHelper's ImGui.NET binding.
# All source revisions and download hashes are pinned; no game/Mod files bundled.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$repo = Split-Path $PSScriptRoot -Parent
$lockPath = "$repo/android/runtime/cimgui.json"
$lock = Get-Content $lockPath -Raw | ConvertFrom-Json
$work = "$repo/.local/cimgui-build"
$output = "$repo/android/runtime/jniLibs/arm64-v8a/libcimgui.so"
$stampPath = "$work/build-stamp.json"
$key = (Get-FileHash $lockPath).Hash + (Get-FileHash $PSCommandPath).Hash +
    (Get-FileHash "$env:NDK_HOME/source.properties").Hash
if ((Test-Path $output) -and (Test-Path $stampPath)) {
    $stamp = Get-Content $stampPath -Raw | ConvertFrom-Json
    if ($stamp.key -eq $key -and $stamp.sha256 -eq (Get-FileHash $output).Hash) { return }
}
New-Item -ItemType Directory -Force $work, (Split-Path $output -Parent) | Out-Null
function Get-Source($repository, $commit, $hash, $name) {
    $archive = "$work/$name.zip"
    if (!(Test-Path $archive)) {
        curl.exe --fail --location --retry 3 "https://api.github.com/repos/$repository/zipball/$commit" --output $archive
        if ($LASTEXITCODE) { throw "Failed to download $repository at $commit" }
    }
    if ((Get-FileHash $archive).Hash -ne $hash) { throw "Source checksum mismatch: $archive" }
    $directory = "$work/pinned-$name"
    Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
    $roots = @(Get-ChildItem -LiteralPath $directory -Directory)
    if ($roots.Count -ne 1) { throw "Unexpected archive root: $directory" }
    return $roots[0].FullName
}
$src = Get-Source 'cimgui/cimgui' $lock.cimguiCommit $lock.cimguiArchiveSha256 'cimgui'
$imgui = Get-Source 'ocornut/imgui' $lock.imguiCommit $lock.imguiArchiveSha256 'imgui'
Copy-Item "$imgui/*" "$src/imgui" -Recurse -Force
$compiler = "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android28-clang++.cmd"
$temporary = "$output.tmp"
# Match upstream's default CMake options; retain 16 KiB page compatibility.
& $compiler -shared -fPIC -O2 -std=c++11 -DIMGUI_DISABLE_OBSOLETE_FUNCTIONS=1 `
    "-I$src" "-I$src/imgui" "$src/cimgui.cpp" "$src/imgui/imgui.cpp" `
    "$src/imgui/imgui_draw.cpp" "$src/imgui/imgui_demo.cpp" `
    "$src/imgui/imgui_widgets.cpp" "$src/imgui/imgui_tables.cpp" `
    '-Wl,-soname,libcimgui.so' '-Wl,-z,max-page-size=16384' -o $temporary
if ($LASTEXITCODE) { throw 'Android cimgui build failed' }
& "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe" --strip-unneeded $temporary
if ($LASTEXITCODE) { throw 'Android cimgui strip failed' }
Move-Item -LiteralPath $temporary -Destination $output -Force
@{ key = $key; sha256 = (Get-FileHash $output).Hash } | ConvertTo-Json | Set-Content $stampPath
