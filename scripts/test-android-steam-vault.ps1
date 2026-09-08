# Tests the installed Debug APK's actual Android Keystore vault in separate
# processes. Refuses existing credentials/pending saves. Never connects to Steam.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/android-env.ps1"
$repo = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $repo '.local/steam-ux/vault-test'
$bt = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0'
$android = Join-Path $env:ANDROID_HOME 'platforms/android-36/android.jar'
function Check-Exit { if ($LASTEXITCODE) { throw 'Steam vault test tool failed' } }
if ((adb shell pidof cc.microblock.celemod:game)) { throw 'Exit the game before testing' }
New-Item -ItemType Directory -Force $dir, "$dir/classes", "$dir/dex" | Out-Null
@'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.celemod.steam.test"><uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/><application android:label="CeleMod vault test" android:debuggable="true"/><instrumentation android:name="com.celemod.tests.SteamVaultCheck" android:targetPackage="cc.microblock.celemod"/></manifest>
'@ | Set-Content -LiteralPath "$dir/AndroidManifest.xml" -Encoding utf8
& "$env:JAVA_HOME/bin/javac.exe" -encoding UTF-8 -source 8 -target 8 -cp $android -d "$dir/classes" "$repo/android/steam-tests/SteamVaultCheck.java"
Check-Exit
& "$bt/d8.bat" --lib $android --min-api 28 --output "$dir/dex" "$dir/classes/com/celemod/tests/SteamVaultCheck.class"
Check-Exit
& "$bt/aapt2.exe" link -I $android --manifest "$dir/AndroidManifest.xml" -o "$dir/fixture.apk"
Check-Exit
& "$env:JAVA_HOME/bin/jar.exe" uf "$dir/fixture.apk" -C "$dir/dex" classes.dex
Check-Exit
& "$bt/apksigner.bat" sign --ks "$env:USERPROFILE/.android/debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android "$dir/fixture.apk"
Check-Exit
adb install -r "$dir/fixture.apk"
Check-Exit
$nonce = [Guid]::NewGuid().ToString('N').Substring(0,12)
try {
    foreach ($phase in @('write', 'read')) {
        $result = adb shell am instrument -w -e nonce $nonce -e phase $phase com.celemod.steam.test/com.celemod.tests.SteamVaultCheck
        Check-Exit
        $result
        if (($result -join "`n") -notmatch "PASS $phase") { throw "Steam vault $phase test failed" }
    }
} finally {
    # The test only clears a fixture owned by this nonce, never another account.
    $cleanup = adb shell am instrument -w -e nonce $nonce -e phase clear com.celemod.steam.test/com.celemod.tests.SteamVaultCheck
    $cleanup
    if (($cleanup -join "`n") -notmatch 'PASS clear') { throw 'Fixture cleanup failed; inspect the test owner marker before continuing' }
    adb uninstall com.celemod.steam.test
    adb shell am start -n cc.microblock.celemod/.MainActivity
}
