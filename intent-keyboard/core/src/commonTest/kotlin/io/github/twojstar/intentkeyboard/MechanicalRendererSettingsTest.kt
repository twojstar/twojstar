package io.github.twojstar.intentkeyboard

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertTrue

class MechanicalRendererSettingsTest {
    @Test
    fun warnsWhenSemanticToneOrTranslationCannotBeApplied() = runTest {
        val result = SemanticPipeline(MechanicalRenderer()).render(
            RenderRequest(
                rawIntent = "hej jutro",
                register = Register.NATURAL,
                tone = Tone.WORK,
                sourceLanguage = "Polish",
                targetLanguage = "English",
            ),
        )

        assertTrue(result.warnings.any { "tone" in it.lowercase() })
        assertTrue(result.warnings.any { "translate" in it.lowercase() })
    }

    private fun runTest(block: suspend () -> Unit) {
        var failure: Throwable? = null
        block.startCoroutine(
            object : Continuation<Unit> {
                override val context = EmptyCoroutineContext
                override fun resumeWith(result: Result<Unit>) {
                    failure = result.exceptionOrNull()
                }
            },
        )
        failure?.let { throw it }
    }
}
