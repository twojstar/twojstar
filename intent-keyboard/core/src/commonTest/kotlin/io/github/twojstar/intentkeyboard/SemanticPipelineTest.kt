package io.github.twojstar.intentkeyboard

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SemanticPipelineTest {
    @Test
    fun reportsChangedVerbatimLock() = runTest {
        val pipeline = SemanticPipeline(
            renderer = object : SemanticRenderer {
                override suspend fun render(request: RenderRequest) =
                    RenderResult("Jutro powinienem być około 19:00.")
            },
        )

        val result = pipeline.render(
            RenderRequest(
                rawIntent = "jutro byc 18:30",
                locks = listOf(SemanticLock("18:30")),
            ),
        )

        assertTrue(result.warnings.any { "18:30" in it })
    }

    @Test
    fun mechanicalRendererNormalizesNaturalDraft() = runTest {
        val raw = "  jutro   byc 18:30  "
        val result = SemanticPipeline(MechanicalRenderer()).render(
            RenderRequest(
                rawIntent = raw,
                register = Register.NATURAL,
                locks = ConservativeLockDetector.detect(raw),
            ),
        )

        assertEquals("Jutro byc 18:30.", result.text)
        assertTrue(result.warnings.isEmpty())
    }

    @Test
    fun detectorLocksObviousTimeAndMoneyValues() {
        val locks = ConservativeLockDetector.detect("jutro 18:30, budzet 120 zł, 7€ i 12\$")
            .map { it.value }

        assertTrue("18:30" in locks)
        assertTrue("120 zł" in locks)
        assertTrue("7€" in locks)
        assertTrue("12\$" in locks)
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
