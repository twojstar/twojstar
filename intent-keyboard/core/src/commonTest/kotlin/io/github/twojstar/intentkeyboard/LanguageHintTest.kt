package io.github.twojstar.intentkeyboard

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LanguageHintTest {
    @Test
    fun normalizesOptionalLanguageHints() {
        assertNull((null as String?).normalizedLanguage())
        assertNull("".normalizedLanguage())
        assertNull("   ".normalizedLanguage())
        assertEquals("Polish", "  Polish  ".normalizedLanguage())
        assertEquals("English (US)", "English (US)".normalizedLanguage())
    }
}
