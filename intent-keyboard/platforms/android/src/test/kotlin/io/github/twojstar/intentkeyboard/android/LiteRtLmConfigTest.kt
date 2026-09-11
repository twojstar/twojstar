package io.github.twojstar.intentkeyboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class LiteRtLmConfigTest {
    @Test
    fun cpuConfigKeepsSafeOptionalDefaults() {
        val config = LiteRtLmCpuConfig(modelPath = "/models/qwen.litertlm")

        assertEquals("/models/qwen.litertlm", config.modelPath)
        assertNull(config.cacheDir)
        assertNull(config.threadCount)
        assertNull(config.maxNumTokens)
    }

    @Test
    fun cpuConfigRejectsInvalidValues() {
        val modelPath = "/model"

        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmCpuConfig(modelPath = "   ")
        }
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmCpuConfig(modelPath = modelPath, cacheDir = "")
        }
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmCpuConfig(modelPath = modelPath, threadCount = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmCpuConfig(modelPath = modelPath, maxNumTokens = -1)
        }
    }

    @Test
    fun generationConfigUsesKeyboardLimitAndRejectsNonPositiveValues() {
        assertEquals(
            LiteRtLmGenerationConfig.DEFAULT_KEYBOARD_MAX_OUTPUT_TOKENS,
            LiteRtLmGenerationConfig().maxOutputToken,
        )
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmGenerationConfig(maxOutputToken = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LiteRtLmGenerationConfig(maxOutputToken = -1)
        }
    }
}
