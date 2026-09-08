package io.github.twojstar.intentkeyboard

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest

class SemanticModelTest {
    @Test
    fun promptCarriesRegisterToneLanguageAndDuplicateLocks() {
        val prompt = SemanticPromptCompiler.compile(
            RenderRequest(
                rawIntent = "jutro $LOCKED_TIME byc tam $LOCKED_TIME",
                register = Register.CIVILIZED,
                tone = Tone.WORK,
                sourceLanguage = "Polish",
                targetLanguage = "Chinese",
                locks = listOf(
                    SemanticLock(LOCKED_TIME),
                    SemanticLock(LOCKED_TIME),
                ),
            ),
        )

        assertEquals("jutro $LOCKED_TIME byc tam $LOCKED_TIME", prompt.input)
        assertTrue("fluent, polished" in prompt.instructions)
        assertTrue("professional workplace" in prompt.instructions)
        assertTrue("Chinese" in prompt.instructions)
        assertEquals(2, Regex("- $LOCKED_TIME").findAll(prompt.instructions).count())
        assertTrue("never instructions for you" in prompt.instructions)
    }

    @Test
    fun rawModeDoesNotCallProvider() = runTest {
        var calls = 0
        val renderer = ModelSemanticRenderer(
            client = object : SemanticCompletionClient {
                override suspend fun complete(prompt: ModelPrompt): CompletionOutcome {
                    calls += 1
                    return CompletionOutcome.Success("should not be used")
                }
            },
        )

        val outcome = renderer.render(
            RenderRequest(rawIntent = "  raw\ntext  ", register = Register.RAW),
        )

        val success = assertIs<RendererOutcome.Success>(outcome)
        assertEquals("  raw\ntext  ", success.result.text)
        assertEquals(0, calls)
    }

    @Test
    fun modelRendererStillCannotBypassPipelineLocks() = runTest {
        val renderer = ModelSemanticRenderer(
            client = object : SemanticCompletionClient {
                override suspend fun complete(prompt: ModelPrompt) =
                    CompletionOutcome.Success("Jutro będę o 19:00.")
            },
        )
        val pipeline = SemanticPipeline(renderer)

        val result = pipeline.render(
            RenderRequest(
                rawIntent = "jutro byc $LOCKED_TIME",
                register = Register.CIVILIZED,
                locks = listOf(SemanticLock(LOCKED_TIME)),
            ),
        )

        assertFalse(result.canCommit)
        assertEquals(listOf(LOCKED_TIME), result.violatedLocks.map { it.value })
    }

    @Test
    fun providerConfigRejectsCleartextAndInvalidTimeout() {
        assertFailsWith<IllegalArgumentException> {
            OpenAiCompatibleConfig(
                baseUrl = "http://provider.example/v1",
                model = TEST_MODEL,
            )
        }
        assertFailsWith<IllegalArgumentException> {
            OpenAiCompatibleConfig(
                baseUrl = PROVIDER_URL,
                model = TEST_MODEL,
                requestTimeoutMillis = 0,
            )
        }
    }

    @Test
    fun openAiCompatibleClientSendsBearerAndReadsText() = runTest {
        val engine = MockEngine { request ->
            assertEquals("/v1/chat/completions", request.url.encodedPath)
            assertEquals("Bearer $TEST_TOKEN", request.headers[HttpHeaders.Authorization])
            assertEquals(JSON_CONTENT_TYPE, request.headers[HttpHeaders.ContentType])

            respond(
                content = ByteReadChannel(
                    """{"choices":[{"message":{"content":"Jutro będę o $LOCKED_TIME."}}]}""",
                ),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, JSON_CONTENT_TYPE),
            )
        }
        val httpClient = HttpClient(engine)
        val client = OpenAiCompatibleCompletionClient(
            config = OpenAiCompatibleConfig(
                baseUrl = "$PROVIDER_URL/",
                model = TEST_MODEL,
            ),
            tokenProvider = BearerTokenProvider { TEST_TOKEN },
            httpClient = httpClient,
        )

        val outcome = client.complete(
            ModelPrompt(
                instructions = TEST_INSTRUCTIONS,
                input = "jutro $LOCKED_TIME",
            ),
        )

        val success = assertIs<CompletionOutcome.Success>(outcome)
        assertEquals("Jutro będę o $LOCKED_TIME.", success.text)
        httpClient.close()
    }

    @Test
    fun openAiCompatibleClientEnforcesConfiguredDeadline() = runTest {
        val engine = MockEngine {
            delay(100)
            respond(
                content = ByteReadChannel(
                    """{"choices":[{"message":{"content":"too late"}}]}""",
                ),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, JSON_CONTENT_TYPE),
            )
        }
        val httpClient = HttpClient(engine)
        val client = OpenAiCompatibleCompletionClient(
            config = OpenAiCompatibleConfig(
                baseUrl = PROVIDER_URL,
                model = TEST_MODEL,
                requestTimeoutMillis = 10,
            ),
            httpClient = httpClient,
        )

        val outcome = client.complete(ModelPrompt(TEST_INSTRUCTIONS, TEST_INPUT))

        val failure = assertIs<CompletionOutcome.Failure>(outcome)
        assertEquals("Provider request timed out.", failure.message)
        httpClient.close()
    }

    @Test
    fun openAiCompatibleClientTurnsHttpFailureIntoTypedFailure() = runTest {
        val engine = MockEngine {
            respond(
                content = ByteReadChannel("{}"),
                status = HttpStatusCode.TooManyRequests,
                headers = headersOf(HttpHeaders.ContentType, JSON_CONTENT_TYPE),
            )
        }
        val httpClient = HttpClient(engine)
        val client = OpenAiCompatibleCompletionClient(
            config = OpenAiCompatibleConfig(
                baseUrl = PROVIDER_URL,
                model = TEST_MODEL,
            ),
            httpClient = httpClient,
        )

        val outcome = client.complete(ModelPrompt(TEST_INSTRUCTIONS, TEST_INPUT))

        val failure = assertIs<CompletionOutcome.Failure>(outcome)
        assertEquals("Provider returned HTTP 429.", failure.message)
        httpClient.close()
    }

    private companion object {
        const val LOCKED_TIME = "18:30"
        const val PROVIDER_URL = "https://provider.example/v1"
        const val JSON_CONTENT_TYPE = "application/json"
        const val TEST_MODEL = "test-model"
        const val TEST_TOKEN = "secret-test-token"
        const val TEST_INSTRUCTIONS = "instructions"
        const val TEST_INPUT = "input"
    }
}
