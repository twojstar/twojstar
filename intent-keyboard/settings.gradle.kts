pluginManagement {
    val kotlinVersion = providers.gradleProperty("kotlinVersion").get()

    plugins {
        id("org.jetbrains.kotlin.multiplatform") version kotlinVersion
        id("org.jetbrains.kotlin.jvm") version kotlinVersion
    }

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "intent-keyboard"
include(":core")
include(":platforms:android")
include(":platforms:desktop")
