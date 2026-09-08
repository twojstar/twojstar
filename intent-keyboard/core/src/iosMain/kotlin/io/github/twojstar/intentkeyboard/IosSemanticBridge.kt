package io.github.twojstar.intentkeyboard

/**
 * Small Swift-friendly façade over the shared semantic pipeline.
 *
 * The iOS keyboard owns only platform text plumbing. Register parsing, automatic locks and
 * integrity validation stay in shared Kotlin code.
 */
class IosSemanticBridge {
    private val pipeline = SemanticPipeline(MechanicalRenderer())

    @Throws(SemanticRenderException::class)
    suspend fun render(
        rawIntent: String,
        registerName: String,
    ): RenderResult {
        val register = when (registerName.uppercase()) {
            Register.RAW.name -> Register.RAW
            Register.CIVILIZED.name -> Register.CIVILIZED
            else -> Register.NATURAL
        }

        return pipeline.render(
            RenderRequest(
                rawIntent = rawIntent,
                register = register,
                locks = ConservativeLockDetector.detect(rawIntent),
            ),
        )
    }
}
