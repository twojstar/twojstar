package io.github.twojstar.intentkeyboard

import kotlin.coroutines.cancellation.CancellationException

/**
 * Small Swift-friendly façade over the shared semantic pipeline.
 *
 * The iOS keyboard owns only platform text plumbing. Register/settings parsing, automatic locks and
 * integrity validation stay in shared Kotlin code.
 */
class IosSemanticBridge {
    private val pipeline = SemanticPipeline(MechanicalRenderer())

    @Throws(SemanticRenderException::class, CancellationException::class)
    suspend fun render(
        rawIntent: String,
        registerName: String,
        toneName: String = Tone.DEFAULT.name,
        sourceLanguage: String? = null,
        targetLanguage: String? = null,
        recipientProfileName: String = RecipientProfile.NONE.name,
    ): RenderResult {
        val register = enumValueOrDefault(registerName, Register.NATURAL)
        val tone = enumValueOrDefault(toneName, Tone.DEFAULT)
        val recipientProfile = enumValueOrDefault(recipientProfileName, RecipientProfile.NONE)

        return pipeline.render(
            RenderRequest(
                rawIntent = rawIntent,
                register = register,
                tone = tone,
                sourceLanguage = sourceLanguage.normalizedLanguage(),
                targetLanguage = targetLanguage.normalizedLanguage(),
                locks = ConservativeLockDetector.detect(rawIntent),
                recipientProfile = recipientProfile,
            ),
        )
    }

    private inline fun <reified T : Enum<T>> enumValueOrDefault(
        value: String,
        fallback: T,
    ): T = enumValues<T>().firstOrNull { it.name == value.uppercase() } ?: fallback
}
