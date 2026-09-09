buildscript {
    val kotlinVersion = providers.gradleProperty("kotlinVersion").get()

    repositories {
        mavenCentral()
    }

    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}

plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "io.github.twojstar.intentkeyboard.android"
    compileSdk = libs.versions.androidCompileSdk.get().toInt()

    defaultConfig {
        applicationId = "io.github.twojstar.intentkeyboard.android"
        minSdk = libs.versions.androidMinSdk.get().toInt()
        targetSdk = libs.versions.androidCompileSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0-dev"
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.litert.lm.android)
}
