plugins {
    id("org.jetbrains.kotlin.multiplatform") apply false
    id("org.jetbrains.kotlin.jvm") apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.kotlin.multiplatform.library) apply false
}
