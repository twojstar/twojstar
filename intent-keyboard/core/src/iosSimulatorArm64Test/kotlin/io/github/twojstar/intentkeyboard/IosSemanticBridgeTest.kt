package io.github.twojstar.intentkeyboard

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
            targetLanguage = "Polish",
            recipientProfileName = "client",
        )

        assertEquals("Hej jutro.", result.text)
        assertTrue(result.warnings.any { "semantic rewriting" in it })
        assertTrue(result.warnings.any { "tone" in it })
        assertTrue(result.warnings.any { "recipient" in it })
        assertFalse(result.warnings.any { "translate" in it })
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
        val rawIntent = "zapłać 120 zł o 18:30"
        val detected = ConservativeLockDetector.detect(rawIntent).map { it.value }.toSet()

        assertEquals(setOf("120 zł", "18:30"), detected)

        val result = bridge.render(
            rawIntent = rawIntent,
            registerName = "natural",
        )

        assertEquals("Zapłać 120 zł o 18:30.", result.text)
        assertTrue(result.canCommit)
        assertTrue(result.violatedLocks.isEmpty())
    }
}
