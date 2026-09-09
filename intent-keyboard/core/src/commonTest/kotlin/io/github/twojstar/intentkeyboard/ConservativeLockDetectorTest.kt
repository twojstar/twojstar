package io.github.twojstar.intentkeyboard

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConservativeLockDetectorTest {
    @Test
    fun detectsExplicitUrlsAndQuotedLiterals() {
        val text = """Wyślij "ABC-123" przez https://example.com/a?x=1&y=2, potem `nie zmieniaj` i „ważne”"""
        val values = ConservativeLockDetector.detect(text).map { it.value }

        assertTrue("https://example.com/a?x=1&y=2" in values)
        assertFalse("https://example.com/a?x=1&y=2," in values)
        assertTrue("\"ABC-123\"" in values)
        assertTrue("`nie zmieniaj`" in values)
        assertTrue("„ważne”" in values)
    }

    @Test
    fun keepsNestedFactsAndLiteralAsSeparateLocks() {
        val values = ConservativeLockDetector.detect("Spotkanie „18:30” kosztuje 120 zł.")
            .map { it.value }

        assertTrue("18:30" in values)
        assertTrue("„18:30”" in values)
        assertTrue("120 zł" in values)
    }

    @Test
    fun repeatedUrlsRemainRepeatedLocks() {
        val url = "https://example.com/path"
        val values = ConservativeLockDetector.detect("$url i jeszcze raz $url").map { it.value }

        assertEquals(2, values.count { it == url })
    }

    @Test
    fun avoidsBareDomainsSingleQuotesAndEmptyQuotes() {
        val values = ConservativeLockDetector.detect("don't lock 'word', example.com, \"\" ani ``")
            .map { it.value }

        assertTrue(values.isEmpty())
    }

    @Test
    fun acceptsCaseInsensitiveHttpScheme() {
        val values = ConservativeLockDetector.detect("HTTP://example.com/resource;").map { it.value }

        assertTrue("HTTP://example.com/resource" in values)
    }

    @Test
    fun keepsInternalApostrophesAndDropsTrailingProsePunctuation() {
        val text = "Use 'https://example.com/O'Reilly?author=O'Reilly'! Then visit https://example.org?"
        val values = ConservativeLockDetector.detect(text).map { it.value }

        assertTrue("https://example.com/O'Reilly?author=O'Reilly" in values)
        assertTrue("https://example.org" in values)
        assertFalse(values.any { it.endsWith("'!") || it.endsWith("?") })
    }
}
