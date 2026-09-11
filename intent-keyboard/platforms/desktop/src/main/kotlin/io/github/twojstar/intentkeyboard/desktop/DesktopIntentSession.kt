package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.ConservativeLockDetector
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.RecipientProfile
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.SemanticPipeline
import io.github.twojstar.intentkeyboard.SemanticRenderer
import io.github.twojstar.intentkeyboard.Tone
import io.github.twojstar.intentkeyboard.normalizedLanguage

data class DesktopRenderPreferences(
    val tone: Tone = Tone.DEFAULT,
    val recipientProfile: RecipientProfile = RecipientProfile.NONE,
    val sourceLanguage: String? = null,
    val targetLanguage: String? = null,
)

data class DesktopIntentState(
    val rawIntent: String,
    val register: Register,
    val preferences: DesktopRenderPreferences,
    val previewText: String?,
    val warnings: List<String>,
    val canCopy: Boolean,
)

/**
 * Small desktop state holder around the shared semantic pipeline.
 *
 * The session owns no OS-wide insertion behavior. It only decides whether the current raw draft has
 * a current, lock-safe render that may be handed to an explicit desktop text sink.
 */
class DesktopIntentSession(
    renderer: SemanticRenderer = MechanicalRenderer(),
) {
    private val pipeline = SemanticPipeline(renderer)
    private val stateLock = Any()

    private var rawIntent = ""
    private var register = Register.NATURAL
    private var preferences = DesktopRenderPreferences()
    private var renderedSource = ""
    private var renderedRegister = register
    private var renderedPreferences = preferences
    private var renderedResult: RenderResult? = null
    private var revision = 0L
    private var renderSequence = 0L

    fun updateRawIntent(value: String): DesktopIntentState = synchronized(stateLock) {
        if (value != rawIntent) {
            rawIntent = value
            invalidatePreviewLocked()
        }
        snapshotLocked()
    }

    fun setRegister(value: Register): DesktopIntentState = synchronized(stateLock) {
        if (value != register) {
            register = value
            invalidatePreviewLocked()
        }
        snapshotLocked()
    }

    fun setTone(value: Tone): DesktopIntentState = updatePreferences { copy(tone = value) }

    fun setRecipientProfile(value: RecipientProfile): DesktopIntentState =
        updatePreferences { copy(recipientProfile = value) }

    fun setSourceLanguage(value: String?): DesktopIntentState =
        updatePreferences { copy(sourceLanguage = value.normalizedLanguage()) }

    fun setTargetLanguage(value: String?): DesktopIntentState =
        updatePreferences { copy(targetLanguage = value.normalizedLanguage()) }

    suspend fun render(): DesktopIntentState {
        val token = synchronized(stateLock) {
            renderSequence += 1
            RenderToken(
                rawIntent = rawIntent,
                register = register,
                preferences = preferences,
                revision = revision,
                sequence = renderSequence,
            )
        }

        val result = pipeline.render(
            RenderRequest(
                rawIntent = token.rawIntent,
                register = token.register,
                tone = token.preferences.tone,
                sourceLanguage = token.preferences.sourceLanguage,
                targetLanguage = token.preferences.targetLanguage,
                locks = ConservativeLockDetector.detect(token.rawIntent),
                recipientProfile = token.preferences.recipientProfile,
            ),
        )

        return synchronized(stateLock) {
            if (
                token.revision == revision &&
                token.sequence == renderSequence &&
                token.rawIntent == rawIntent &&
                token.register == register &&
                token.preferences == preferences
            ) {
                renderedSource = token.rawIntent
                renderedRegister = token.register
                renderedPreferences = token.preferences
                renderedResult = result
            }
            snapshotLocked()
        }
    }

    fun revert(): DesktopIntentState = synchronized(stateLock) {
        if (hasCurrentPreviewLocked()) {
            invalidatePreviewLocked()
        }
        snapshotLocked()
    }

    fun currentState(): DesktopIntentState = synchronized(stateLock) {
        snapshotLocked()
    }

    fun copyTextOrNull(): String? = synchronized(stateLock) {
        if (rawIntent.isEmpty()) return@synchronized null
        if (register == Register.RAW) return@synchronized rawIntent
        if (rawIntent.isBlank()) return@synchronized null

        renderedResult
            ?.takeIf {
                hasCurrentPreviewLocked() &&
                    it.canCommit &&
                    it.text.isNotBlank()
            }
            ?.text
    }

    private fun updatePreferences(
        transform: DesktopRenderPreferences.() -> DesktopRenderPreferences,
    ): DesktopIntentState = synchronized(stateLock) {
        val next = preferences.transform()
        if (next != preferences) {
            preferences = next
            invalidatePreviewLocked()
        }
        snapshotLocked()
    }

    private fun hasCurrentPreviewLocked(): Boolean =
        renderedResult != null &&
            renderedSource == rawIntent &&
            renderedRegister == register &&
            renderedPreferences == preferences

    private fun snapshotLocked(): DesktopIntentState {
        val currentResult = renderedResult?.takeIf { hasCurrentPreviewLocked() }
        return DesktopIntentState(
            rawIntent = rawIntent,
            register = register,
            preferences = preferences,
            previewText = currentResult?.text,
            warnings = currentResult?.warnings.orEmpty(),
            canCopy = when {
                rawIntent.isEmpty() -> false
                register == Register.RAW -> true
                rawIntent.isBlank() -> false
                else -> currentResult?.canCommit == true && currentResult.text.isNotBlank()
            },
        )
    }

    private fun invalidatePreviewLocked() {
        revision += 1
        renderSequence += 1
        renderedSource = ""
        renderedResult = null
    }

    private data class RenderToken(
        val rawIntent: String,
        val register: Register,
        val preferences: DesktopRenderPreferences,
        val revision: Long,
        val sequence: Long,
    )
}
