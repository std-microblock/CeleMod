# Add project specific ProGuard rules here.
-keep class com.app.ralaunch.** { *; }
-keep class org.libsdl.app.** { *; }
-keep class org.fmod.** { *; }
# RuntimePlugin's annotated commands are kept by Tauri's consumer rules;
# Android manifest components are kept by the Android Gradle plugin.  Avoid
# pinning every helper/data class so R8 can optimize and obfuscate them.
# .NET's Android TLS backend loads these through JNI, not Java call sites.
-keep class net.dot.android.crypto.** { *; }
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
