package io.github.twojstar.intentkeyboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteProviderSettingsTest {
    @Test
    fun disabledProviderNeverCreatesConfig() {
        val settings = RemoteProviderSettings(
            enabled = false,
            baseUrl = "not-a-url",
            model = "",
            hasToken = true,
        )

        assertNull(settings.configOrNull())
    }

    @Test
    fun enabledValidProviderCreatesConfig() {
        val settings = RemoteProviderSettings(
            enabled = true,
            baseUrl = VALID_BASE_URL,
            model = VALID_MODEL,
        )

        val config = settings.configOrNull()
        assertNotNull(config)
        assertEquals(VALID_BASE_URL, config?.baseUrl)
        assertEquals(VALID_MODEL, config?.model)
    }

    @Test
    fun enabledInvalidProviderFailsClosed() {
        val invalidSettings = listOf(
            RemoteProviderSettings(
                enabled = true,
                baseUrl = "http://provider.example/v1",
                model = VALID_MODEL,
            ),
            RemoteProviderSettings(
                enabled = true,
                baseUrl = VALID_BASE_URL,
                model = "   ",
            ),
        )

        for (settings in invalidSettings) {
            assertNull(settings.configOrNull())
        }
    }

    private companion object {
        const val VALID_BASE_URL = "https://provider.example/v1"
        const val VALID_MODEL = "test-model"
    }
}
