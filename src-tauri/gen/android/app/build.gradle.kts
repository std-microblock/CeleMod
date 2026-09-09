import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "cc.microblock.celemod"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "cc.microblock.celemod"
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main") {
        java.srcDirs("../../../../android/runtime/src", "../../../../android/runtime/vendor")
        assets.srcDir("../../../../android/runtime/assets")
        assets.exclude("**/steam/**", "**/MonoMod.zip")
        jniLibs.srcDir("../../../../android/runtime/jniLibs")
    }
    packaging.jniLibs.useLegacyPackaging = true
    // Compressed DEX saves about 1.2 MiB in the single-APK arm64 build.  The
    // minimum SDK is 28, so Android can safely extract it at install time.
    packaging.dex.useLegacyPackaging = true
    packaging.jniLibs.excludes += setOf(
        "**/libfmodL.so",
        "**/libfmodstudioL.so",
    )
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// Tauri core and deep-link declare Material even though they do not use it;
// dialog only needs an AlertDialog builder.  A tiny AppCompat-compatible shim
// keeps that ABI without packaging the full Material component/resource set.
configurations.configureEach {
    exclude(group = "com.google.android.material", module = "material")
}

dependencies {
    implementation(fileTree("../../../../android/runtime/libs") { include("*.jar") })
    implementation("org.tukaani:xz:1.10")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
