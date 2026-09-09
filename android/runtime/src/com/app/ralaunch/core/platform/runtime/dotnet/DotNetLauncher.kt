// JNI contract from RotatingArtLauncher v2.1.1 (GPL-3.0).
// Kept in the original package because the embedded native library exports these names.
package com.app.ralaunch.core.platform.runtime.dotnet

object DotNetLauncher {
    external fun getNativeDotNetLauncherHostfxrLastErrorMsg(): String
    external fun nativeDotNetLauncherHostfxrLaunch(path: String, args: Array<String>, root: String): Int
}
