package io.github.twojstar.intentkeyboard

import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SemanticPipelineTest {
    @Test
    fun reportsChangedVerbatimLockAndBlocksCommit() = runTest {
        val pipeline = SemanticPipeline(
            renderer = object : SemanticRenderer {
                override suspend fun render(request: RenderRequest) =
                    RendererOutcome.Success(RenderResult("Jutro powinienem być około 19:00."))
            },
        )

        val result = pipeline.render(
            RenderRequest(
                rawIntent = "jutro byc 18:30",
                locks = listOf(SemanticLock("18:30")),
            ),
        )

        assertTrue(result.warnings.any { "18:30" in it })
        assertTrue(result.violatedLocks.any { it.value == "18:30" })
        assertFalse(result.canCommit)
    }

    @Test
    fun rendererFailureBecomesSemanticRenderException() = runTest {
        val pipeline = SemanticPipeline(
            renderer = object : SemanticRenderer {
                override suspend fun render(request: RenderRequest) =
                    RendererOutcome.Failure("provider unavailable")
            },
        )

        var failure: SemanticRenderException? = null
        try {
            pipeline.render(RenderRequest(rawIntent = "hej"))
        } catch (error: SemanticRenderException) {
            failure = error
        }

        assertEquals("provider unavailable", failure?.message)
    }

    @Test
    fun exactLockDoesNotPassAsPartOfLargerValue() = runTest {
        val pipeline = SemanticPipeline(
            renderer = object : SemanticRenderer {
                override suspend fun render(request: RenderRequest) =
                    RendererOutcome.Success(RenderResult("Koszt to 17€."))
            },
        )

        val result = pipeline.render(
            RenderRequest(
                rawIntent = "koszt 7€",
                locks = listOf(SemanticLock("7€")),
            ),
        )

        assertFalse(result.canCommit)
        assertEquals(listOf("7€"), result.violatedLocks.map { it.value })
    }

    @Test
    fun repeatedLocksPreserveMultiplicity() = runTest {
        val pipeline = SemanticPipeline(
            renderer = object : SemanticRenderer {
                override suspend fun render(request: RenderRequest) =
                    RendererOutcome.Success(RenderResult("7€"))
            },
        )

        val result = pipeline.render(
            RenderRequest(
                rawIntent = "7€ i 7€",
                locks = listOf(SemanticLock("7€"), SemanticLock("7€")),
            ),
        )

        assertFalse(result.canCommit)
        assertEquals(1, result.violatedLocks.size)
    }

    @Test
    fun rawRegisterPreservesSourceExactly() = runTest {
        val raw = "  jutro   byc 18:30  \n"
        val result = SemanticPipeline(MechanicalRenderer()).render(
            RenderRequest(rawIntent = raw, register = Register.RAW),
        )

        assertEquals(raw, result.text)
        assertTrue(result.canCommit)
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
        assertTrue(result.canCommit)
    }

    @Test
    fun detectorLocksTimesAndSignedPrefixOrSuffixMoney() {
        val locks = ConservativeLockDetector.detect(
            "jutro 18:30, 120 zł, 7€, 12$, $12, €7, -12€, -$14 i +20 USD",
        ).map { it.value }

        listOf(
            "18:30",
            "120 zł",
            "7€",
            "12$",
            "$12",
            "€7",
            "-12€",
            "-$14",
            "+20 USD",
        ).forEach { expected -> assertTrue(expected in locks, "Missing lock: $expected") }
    }

    @Test
    fun prototypeLayoutCanTypePolishTimesMoneyAndUppercase() {
        val letters = PrototypeKeyboardLayout.layout(CharacterPage.LETTERS)
            .rows.joinToString("")
        val uppercase = PrototypeKeyboardLayout.layout(CharacterPage.LETTERS, uppercase = true)
            .rows.joinToString("")
        val symbols = PrototypeKeyboardLayout.layout(CharacterPage.NUMBERS)
            .rows.joinToString("")

        "ąćęłńóśźż".forEach { assertTrue(it in letters) }
        "ĄĆĘŁŃÓŚŹŻ".forEach { assertTrue(it in uppercase) }
        "0123456789:€$".forEach { assertTrue(it in symbols) }
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
