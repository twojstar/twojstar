import org.jetbrains.kotlin.gradle.plugin.mpp.apple.XCFramework

plugins {
    id("org.jetbrains.kotlin.multiplatform")
    alias(libs.plugins.android.kotlin.multiplatform.library)
}

kotlin {
    android {
        namespace = "io.github.twojstar.intentkeyboard.core"
        compileSdk = libs.versions.androidCompileSdk.get().toInt()
        minSdk = libs.versions.androidMinSdk.get().toInt()
        withHostTest { }
    }

    jvm("desktop")

    val xcframeworkName = "IntentKeyboardCore"
    val xcframework = XCFramework(xcframeworkName)

    listOf(
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = xcframeworkName
            binaryOption("bundleId", "io.github.twojstar.intentkeyboard.core")
            isStatic = true
            xcframework.add(this)
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.ktor.client.core)
            implementation(libs.kotlinx.serialization.json)
        }

        named("androidMain") {
            dependencies {
                implementation(libs.ktor.client.okhttp)
            }
        }

        named("desktopMain") {
            dependencies {
                implementation(libs.ktor.client.cio)
            }
        }

        val iosMain = maybeCreate("iosMain").apply {
            dependsOn(commonMain.get())
            dependencies {
                implementation(libs.ktor.client.darwin)
            }
        }
        named("iosArm64Main") {
            dependsOn(iosMain)
        }
        named("iosSimulatorArm64Main") {
            dependsOn(iosMain)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
    }
}
