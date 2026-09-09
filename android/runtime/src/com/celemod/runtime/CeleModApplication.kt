package com.celemod.runtime

import android.app.Application
import android.system.Os
import java.io.File

class CeleModApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Set before Tauri's Rust library is loaded: dirs/temp_dir must be writable.
        Os.setenv("HOME", filesDir.absolutePath, true)
        Os.setenv("XDG_CACHE_HOME", cacheDir.absolutePath, true)
        Os.setenv("XDG_DATA_HOME", filesDir.absolutePath, true)
        Os.setenv("XDG_CONFIG_HOME", filesDir.absolutePath, true)
        Os.setenv("TMPDIR", cacheDir.absolutePath, true)
        Os.setenv("PACKAGE_NAME", packageName, true)
        Os.setenv("EXTERNAL_STORAGE_DIRECTORY", getExternalFilesDir(null)!!.absolutePath, true)
        File(getExternalFilesDir(null), "games").mkdirs()
    }
}
