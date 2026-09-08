package io.github.twojstar.intentkeyboard

import kotlin.test.Test
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

    private fun runTest(block: suspend () -> Unit) {
        var failure: Throwable? = null
        block.startCoroutine(
            object : kotlin.coroutines.Continuation<Unit> {
                override val context = kotlin.coroutines.EmptyCoroutineContext
                override fun resumeWith(result: Result<Unit>) {
                    failure = result.exceptionOrNull()
                }
            },
        )
        failure?.let { throw it }
    }
}
