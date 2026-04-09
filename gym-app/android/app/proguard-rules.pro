# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve line numbers for debugging crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---- Capacitor ----
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep class com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.PluginMethod public *;
}

# Capacitor WebView JS bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ---- Firebase / FCM ----
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ---- MLKit Barcode Scanning ----
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# ---- Capgo Updater ----
-keep class ee.nicord.** { *; }
-dontwarn ee.nicord.**

# ---- Health Connect ----
-keep class androidx.health.connect.** { *; }
-dontwarn androidx.health.connect.**

# ---- TuGymPR custom classes ----
-keep class com.tugympr.app.** { *; }
