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
    application
}

apply(plugin = "org.jetbrains.kotlin.jvm")

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.core)
    testImplementation(kotlin("test"))
}

application {
    mainClass.set("io.github.twojstar.intentkeyboard.desktop.DesktopAppKt")
}
