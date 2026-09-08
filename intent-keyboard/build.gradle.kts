buildscript {
    val kotlinVersion = providers.gradleProperty("kotlinVersion").get()

    repositories {
        mavenCentral()
    }

    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}
