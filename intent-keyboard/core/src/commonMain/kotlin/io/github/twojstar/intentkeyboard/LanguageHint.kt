package io.github.twojstar.intentkeyboard

fun String?.normalizedLanguage(): String? =
    this?.trim()?.takeIf { it.isNotEmpty() }
