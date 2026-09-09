// JNI contract from RotatingArtLauncher v2.1.1 (GPL-3.0).
package com.app.ralaunch.core.common.util

object NativeMethods {
    @JvmStatic external fun nativeChdir(path: String): Int
}
