package io.github.twojstar.intentkeyboard.android

import android.content.Context
import io.github.twojstar.intentkeyboard.RecipientProfile
import io.github.twojstar.intentkeyboard.Tone

data class RenderPreferences(
    val tone: Tone = Tone.DEFAULT,
    val sourceLanguage: String? = null,
    val targetLanguage: String? = null,
    val recipientProfile: RecipientProfile = RecipientProfile.NONE,
)

class RenderPreferenceStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun current(): RenderPreferences = RenderPreferences(
        tone = preferences.getString(KEY_TONE, null)
            ?.let { stored -> runCatching { Tone.valueOf(stored) }.getOrNull() }
            ?: Tone.DEFAULT,
        sourceLanguage = preferences.getString(KEY_SOURCE_LANGUAGE, null).normalizedLanguage(),
        targetLanguage = preferences.getString(KEY_TARGET_LANGUAGE, null).normalizedLanguage(),
        recipientProfile = preferences.getString(KEY_RECIPIENT_PROFILE, null)
            ?.let { stored -> runCatching { RecipientProfile.valueOf(stored) }.getOrNull() }
            ?: RecipientProfile.NONE,
    )

    fun setTone(tone: Tone) {
        preferences.edit().putString(KEY_TONE, tone.name).apply()
    }

    fun setSourceLanguage(language: String?) {
        setLanguage(KEY_SOURCE_LANGUAGE, language)
    }

    fun setTargetLanguage(language: String?) {
        setLanguage(KEY_TARGET_LANGUAGE, language)
    }

    fun setRecipientProfile(profile: RecipientProfile) {
        preferences.edit().apply {
            if (profile == RecipientProfile.NONE) {
                remove(KEY_RECIPIENT_PROFILE)
            } else {
                putString(KEY_RECIPIENT_PROFILE, profile.name)
            }
        }.apply()
    }

    private fun setLanguage(key: String, language: String?) {
        val normalized = language.normalizedLanguage()
        preferences.edit().apply {
            if (normalized == null) remove(key) else putString(key, normalized)
        }.apply()
    }

    private fun String?.normalizedLanguage(): String? =
        this?.trim()?.takeIf { it.isNotEmpty() }

    private companion object {
        const val PREFERENCES_NAME = "intent_keyboard_render_preferences"
        const val KEY_TONE = "tone"
        const val KEY_SOURCE_LANGUAGE = "source_language"
        const val KEY_TARGET_LANGUAGE = "target_language"
        const val KEY_RECIPIENT_PROFILE = "recipient_profile"
    }
}
