# =============================================================================
# TraX Finance — ProGuard / R8 keep rules.
#
# Applied on top of the SDK's `proguard-android-optimize.txt`. With R8 +
# resource shrinking enabled in build.gradle's release buildType, every
# class not transitively reachable from a kept entry-point gets stripped.
# Each block below documents *why* a library needs to survive that pass.
# =============================================================================

# -----------------------------------------------------------------------------
# Hermes — JS engine glue. Native callers reach in by reflection.
# -----------------------------------------------------------------------------
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# -----------------------------------------------------------------------------
# React Native New Architecture (Fabric / TurboModules / Codegen)
# These are loaded reflectively from generated PackageList.java; without
# the keep rule R8 will inline-strip the modules.
# -----------------------------------------------------------------------------
-keep class com.facebook.react.** { *; }
-keep class com.facebook.fbreact.** { *; }
-keep class com.facebook.proguard.annotations.** { *; }
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keepclassmembers class * { @com.facebook.proguard.annotations.KeepGettersAndSetters *; }
-keep @com.facebook.proguard.annotations.DoNotStrip class *

# -----------------------------------------------------------------------------
# react-native-vector-icons
# -----------------------------------------------------------------------------
-keep class com.oblador.vectoricons.** { *; }

# -----------------------------------------------------------------------------
# react-native-keychain — interacts with Android Keystore via JNI.
# -----------------------------------------------------------------------------
-keep class com.oblador.keychain.** { *; }
-keep class com.facebook.crypto.** { *; }

# -----------------------------------------------------------------------------
# @notifee/react-native — uses reflection to instantiate AlarmManager
# receivers and to find the user-supplied smallIcon resource.
# -----------------------------------------------------------------------------
-keep class io.invertase.notifee.** { *; }
-keep class app.notifee.** { *; }
-keepclassmembers class app.notifee.** { *; }

# -----------------------------------------------------------------------------
# react-native-reanimated 4 + Worklets runtime
# -----------------------------------------------------------------------------
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# -----------------------------------------------------------------------------
# react-native-gesture-handler / react-navigation
# -----------------------------------------------------------------------------
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }

# -----------------------------------------------------------------------------
# @react-native-async-storage/async-storage
# -----------------------------------------------------------------------------
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# -----------------------------------------------------------------------------
# @react-native-community/netinfo
# -----------------------------------------------------------------------------
-keep class com.reactnativecommunity.netinfo.** { *; }

# -----------------------------------------------------------------------------
# react-native-keyboard-controller
# -----------------------------------------------------------------------------
-keep class com.reactnativekeyboardcontroller.** { *; }

# -----------------------------------------------------------------------------
# react-native-safe-area-context
# -----------------------------------------------------------------------------
-keep class com.th3rdwave.safeareacontext.** { *; }

# -----------------------------------------------------------------------------
# Square OkHttp / Okio — reachable from generated classes; suppress its
# reflective-only warnings so R8 doesn't fail the build.
# -----------------------------------------------------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# -----------------------------------------------------------------------------
# Kotlin metadata + coroutines
# -----------------------------------------------------------------------------
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.coroutines.**

# -----------------------------------------------------------------------------
# Generic safety: keep native-method signatures and Parcelables.
# -----------------------------------------------------------------------------
-keepclasseswithmembernames class * { native <methods>; }
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
