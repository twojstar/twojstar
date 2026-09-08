buildscript {
    val kotlinVersion = providers.gradleProperty("kotlinVersion").get()

    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}
