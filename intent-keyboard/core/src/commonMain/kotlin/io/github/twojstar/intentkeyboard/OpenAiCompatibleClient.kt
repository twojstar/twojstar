package io.github.twojstar.intentkeyboard

import io.ktor.client.HttpClient
import io.ktor.client.request.accept
import io.ktor.client.request.header
import io.ktor.client.request.preparePost
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.URLBuilder
import io.ktor.http.URLParserException
import io.ktor.http.URLProtocol
import io.ktor.http.Url
import io.ktor.http.appendPathSegments
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

data class OpenAiCompatibleConfig(
    val baseUrl: String,
    val model: String,
    val requestTimeoutMillis: Long = 15_000,
) {
    init {
        val parsedBaseUrl = try {
            Url(baseUrl)
        } catch (error: URLParserException) {
            throw IllegalArgumentException("baseUrl must be a valid absolute HTTPS URL", error)
        }

        require(parsedBaseUrl.protocol == URLProtocol.HTTPS && parsedBaseUrl.host.isNotBlank()) {
            "baseUrl must be a valid absolute HTTPS URL"
        }
        require(parsedBaseUrl.parameters.entries().isEmpty() && parsedBaseUrl.fragment.isEmpty()) {
            "baseUrl must not contain a query or fragment"
        }
        require(parsedBaseUrl.user == null && parsedBaseUrl.password == null) {
            "baseUrl must not contain user credentials"
        }
        require(model.isNotBlank()) { "model must not be blank" }
        require(requestTimeoutMillis > 0) { "requestTimeoutMillis must be positive" }
    }
}

fun interface BearerTokenProvider {
    suspend fun token(): String?
}

object NoBearerTokenProvider : BearerTokenProvider {
    override suspend fun token(): String? = null
}

class ProviderRequestTimeoutException(timeoutMillis: Long) :
    Exception("Provider request exceeded ${timeoutMillis}ms.")

/**
 * Minimal Chat Completions transport for OpenAI-compatible providers.
 *
 * Credentials are supplied at request time and are never persisted by this class.
 * The caller owns [httpClient], should reuse it across requests, and must close it.
 */
class OpenAiCompatibleCompletionClient(
    private val config: OpenAiCompatibleConfig,
    private val httpClient: HttpClient,
    private val tokenProvider: BearerTokenProvider = NoBearerTokenProvider,
    private val json: Json = Json,
) : SemanticCompletionClient {
    override suspend fun complete(prompt: ModelPrompt): CompletionOutcome {
        val transport = request(prompt)
        if (transport is TransportOutcome.Failure) {
            return transport.failure
        }

        transport as TransportOutcome.Success
        if (!transport.status.isSuccess()) {
            return CompletionOutcome.Failure(
                "Provider returned HTTP ${transport.status.value}.",
            )
        }

        val extracted = try {
            extractAssistantText(transport.body)
        } catch (_: SerializationException) {
            return CompletionOutcome.Failure("Provider returned invalid JSON.")
        }

        return when (extracted) {
            is AssistantTextOutcome.Text -> {
                if (extracted.value.isBlank()) {
                    CompletionOutcome.Failure("Provider returned no text completion.")
                } else {
                    CompletionOutcome.Success(extracted.value)
                }
            }
            AssistantTextOutcome.Missing ->
                CompletionOutcome.Failure("Provider returned no text completion.")
            AssistantTextOutcome.InvalidContent ->
                CompletionOutcome.Failure("Provider returned invalid completion content.")
            is AssistantTextOutcome.Incomplete ->
                CompletionOutcome.Failure(
                    "Provider completion ended with finish_reason=${extracted.reason}.",
                )
        }
    }

    private suspend fun request(prompt: ModelPrompt): TransportOutcome = try {
        withTimeoutOrNull(config.requestTimeoutMillis) {
            httpClient.preparePost(endpoint()) {
                contentType(ContentType.Application.Json)
                accept(ContentType.Application.Json)
                tokenProvider.token()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                setBody(requestBody(prompt).toString())
            }.execute { response ->
                val body = if (response.status.isSuccess()) {
                    response.bodyAsText()
                } else {
                    response.bodyAsChannel().cancel(null)
                    ""
                }

                TransportOutcome.Success(
                    status = response.status,
                    body = body,
                )
            }
        } ?: TransportOutcome.Failure(
            CompletionOutcome.Failure(
                message = "Provider request timed out.",
                cause = ProviderRequestTimeoutException(config.requestTimeoutMillis),
            ),
        )
    } catch (error: IOException) {
        TransportOutcome.Failure(
            CompletionOutcome.Failure("Provider network request failed.", error),
        )
    }

    private fun endpoint(): String = URLBuilder(config.baseUrl)
        .appendPathSegments("chat", "completions")
        .buildString()

    private fun requestBody(prompt: ModelPrompt): JsonObject = buildJsonObject {
        put("model", config.model)
        put("stream", false)
        putJsonArray("messages") {
            add(message(role = "system", content = prompt.instructions))
            add(message(role = "user", content = prompt.input))
        }
    }

    private fun message(role: String, content: String): JsonObject = buildJsonObject {
        put("role", role)
        put("content", content)
    }

    private fun extractAssistantText(payload: String): AssistantTextOutcome {
        val root = json.parseToJsonElement(payload) as? JsonObject
            ?: return AssistantTextOutcome.InvalidContent
        val choices = root["choices"] as? JsonArray
            ?: return AssistantTextOutcome.Missing
        val firstChoice = choices.firstOrNull() as? JsonObject
            ?: return AssistantTextOutcome.Missing

        val finishReason = when (val rawFinishReason = firstChoice["finish_reason"]) {
            null, JsonNull -> null
            is JsonPrimitive -> rawFinishReason.stringContentOrNull()
                ?: return AssistantTextOutcome.InvalidContent
            else -> return AssistantTextOutcome.InvalidContent
        }
        finishReason
            ?.takeIf { it in NON_NORMAL_FINISH_REASONS }
            ?.let { return AssistantTextOutcome.Incomplete(it) }

        val message = firstChoice["message"] as? JsonObject
            ?: return AssistantTextOutcome.Missing
        val content = message["content"] ?: return AssistantTextOutcome.Missing

        return content.asTextContent()
    }

    private fun JsonElement.asTextContent(): AssistantTextOutcome {
        return when (this) {
            is JsonPrimitive -> stringContentOrNull()
                ?.let(AssistantTextOutcome::Text)
                ?: AssistantTextOutcome.InvalidContent
            is JsonArray -> {
                val parts = ArrayList<String>(size)
                for (part in this) {
                    val partObject = part as? JsonObject
                        ?: return AssistantTextOutcome.InvalidContent
                    val text = (partObject["text"] as? JsonPrimitive)?.stringContentOrNull()
                        ?: return AssistantTextOutcome.InvalidContent
                    parts += text
                }
                AssistantTextOutcome.Text(parts.joinToString(""))
            }
            else -> AssistantTextOutcome.InvalidContent
        }
    }

    private fun JsonPrimitive.stringContentOrNull(): String? =
        if (isString) contentOrNull else null

    private sealed interface AssistantTextOutcome {
        data class Text(val value: String) : AssistantTextOutcome
        data class Incomplete(val reason: String) : AssistantTextOutcome
        data object Missing : AssistantTextOutcome
        data object InvalidContent : AssistantTextOutcome
    }

    private sealed interface TransportOutcome {
        data class Success(
            val status: HttpStatusCode,
            val body: String,
        ) : TransportOutcome

        data class Failure(
            val failure: CompletionOutcome.Failure,
        ) : TransportOutcome
    }

    private companion object {
        val NON_NORMAL_FINISH_REASONS = setOf(
            "length",
            "content_filter",
            "tool_calls",
            "function_call",
        )
    }
}
