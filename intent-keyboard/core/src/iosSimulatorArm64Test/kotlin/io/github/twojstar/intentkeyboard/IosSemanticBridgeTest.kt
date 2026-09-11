package io.github.twojstar.intentkeyboard

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class IosSemanticBridgeTest {
    private val bridge = IosSemanticBridge()

    @Test
    fun parsesSwiftFriendlyNamesAndNormalizesLanguageHints() = runTest {
        val result = bridge.render(
            rawIntent = "  hej   jutro  ",
            registerName = "civilized",
            toneName = "work",
            sourceLanguage = " Polish ",
            targetLanguage = " English ",
            recipientProfileName = "client",
        )

        assertEquals("Hej jutro.", result.text)
        assertTrue(result.warnings.any { "semantic rewriting" in it })
        assertTrue(result.warnings.any { "tone" in it })
        assertTrue(result.warnings.any { "recipient" in it })
        assertTrue(result.warnings.any { "translate" in it })
    }

    @Test
    fun fallsBackSafelyForUnknownNamesAndBlankLanguages() = runTest {
        val unknown = "unknown"
        val result = bridge.render(
            rawIntent = "hej jutro",
            registerName = unknown,
            toneName = unknown,
            sourceLanguage = "   ",
            targetLanguage = "",
            recipientProfileName = unknown,
        )

        assertEquals("Hej jutro.", result.text)
        assertTrue(result.warnings.isEmpty())
        assertTrue(result.canCommit)
    }

    @Test
    fun detectsProtectedValuesBeforeRendering() = runTest {
        val result = bridge.render(
            rawIntent = "zapłać 120 zł o 18:30",
            registerName = "natural",
        )

        assertEquals("Zapłać 120 zł o 18:30.", result.text)
        assertTrue(result.canCommit)
        assertTrue(result.violatedLocks.isEmpty())
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
