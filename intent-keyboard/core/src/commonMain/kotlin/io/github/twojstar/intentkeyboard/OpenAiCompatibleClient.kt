package io.github.twojstar.intentkeyboard

import io.ktor.client.HttpClient
import io.ktor.client.request.accept
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.io.IOException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
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
        require(baseUrl.startsWith("https://", ignoreCase = true)) {
            "baseUrl must use HTTPS"
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

        val text = try {
            extractAssistantText(transport.body)
        } catch (_: SerializationException) {
            return CompletionOutcome.Failure("Provider returned invalid JSON.")
        }

        return if (text.isNullOrBlank()) {
            CompletionOutcome.Failure("Provider returned no text completion.")
        } else {
            CompletionOutcome.Success(text)
        }
    }

    private suspend fun request(prompt: ModelPrompt): TransportOutcome = try {
        withTimeout(config.requestTimeoutMillis) {
            val response = httpClient.post(endpoint()) {
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                accept(ContentType.Application.Json)
                tokenProvider.token()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                setBody(requestBody(prompt).toString())
            }
            TransportOutcome.Success(
                status = response.status,
                body = response.bodyAsText(),
            )
        }
    } catch (_: TimeoutCancellationException) {
        TransportOutcome.Failure(
            CompletionOutcome.Failure("Provider request timed out."),
        )
    } catch (error: IOException) {
        TransportOutcome.Failure(
            CompletionOutcome.Failure("Provider network request failed.", error),
        )
    }

    private fun endpoint(): String =
        "${config.baseUrl.trimEnd('/')}/chat/completions"

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

    private fun extractAssistantText(payload: String): String? {
        val root = json.parseToJsonElement(payload) as? JsonObject ?: return null
        val choices = root["choices"] as? JsonArray ?: return null
        val firstChoice = choices.firstOrNull() as? JsonObject ?: return null
        val message = firstChoice["message"] as? JsonObject ?: return null
        val content = message["content"] ?: return null

        return content.asTextContent()
    }

    private fun JsonElement.asTextContent(): String? = when (this) {
        is JsonPrimitive -> contentOrNull
        is JsonArray -> mapNotNull { part ->
            ((part as? JsonObject)?.get("text") as? JsonPrimitive)?.contentOrNull
        }.joinToString("").ifBlank { null }
        else -> null
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
}
