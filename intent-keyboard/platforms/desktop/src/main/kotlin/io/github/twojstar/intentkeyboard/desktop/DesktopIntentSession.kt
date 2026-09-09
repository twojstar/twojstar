package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.ConservativeLockDetector
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.SemanticPipeline
import io.github.twojstar.intentkeyboard.SemanticRenderer

data class DesktopIntentState(
    val rawIntent: String,
    val register: Register,
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
    private var renderedSource = ""
    private var renderedRegister = register
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

    suspend fun render(): DesktopIntentState {
        val token = synchronized(stateLock) {
            renderSequence += 1
            RenderToken(
                rawIntent = rawIntent,
                register = register,
                revision = revision,
                sequence = renderSequence,
            )
        }

        val result = pipeline.render(
            RenderRequest(
                rawIntent = token.rawIntent,
                register = token.register,
                locks = ConservativeLockDetector.detect(token.rawIntent),
            ),
        )

        return synchronized(stateLock) {
            if (
                token.revision == revision &&
                token.sequence == renderSequence &&
                token.rawIntent == rawIntent &&
                token.register == register
            ) {
                renderedSource = token.rawIntent
                renderedRegister = token.register
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

        renderedResult
            ?.takeIf { hasCurrentPreviewLocked() && it.canCommit }
            ?.text
    }

    private fun hasCurrentPreviewLocked(): Boolean =
        renderedResult != null && renderedSource == rawIntent && renderedRegister == register

    private fun snapshotLocked(): DesktopIntentState {
        val currentResult = renderedResult?.takeIf { hasCurrentPreviewLocked() }
        return DesktopIntentState(
            rawIntent = rawIntent,
            register = register,
            previewText = currentResult?.text,
            warnings = currentResult?.warnings.orEmpty(),
            canCopy = when {
                rawIntent.isEmpty() -> false
                register == Register.RAW -> true
                else -> currentResult?.canCommit == true
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
        val revision: Long,
        val sequence: Long,
    )
}
