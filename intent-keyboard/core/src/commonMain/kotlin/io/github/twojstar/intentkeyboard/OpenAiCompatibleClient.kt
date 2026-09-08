package io.github.twojstar.intentkeyboard

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.request.accept
import io.ktor.client.request.contentType
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.errors.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

data class OpenAiCompatibleConfig(
    val baseUrl: String,
    val model: String,
) {
    init {
        require(baseUrl.isNotBlank()) { "baseUrl must not be blank" }
        require(model.isNotBlank()) { "model must not be blank" }
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
 * The caller owns [httpClient] and its lifecycle.
 */
class OpenAiCompatibleCompletionClient(
    private val config: OpenAiCompatibleConfig,
    private val tokenProvider: BearerTokenProvider = NoBearerTokenProvider,
    private val httpClient: HttpClient = HttpClient(),
    private val json: Json = Json {
        ignoreUnknownKeys = true
        exceptionsWithDebugInfo = false
    },
) : SemanticCompletionClient {
    override suspend fun complete(prompt: ModelPrompt): CompletionOutcome {
        return try {
            val response = httpClient.post(endpoint()) {
                contentType(ContentType.Application.Json)
                accept(ContentType.Application.Json)
                tokenProvider.token()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                setBody(requestBody(prompt).toString())
            }

            if (!response.status.isSuccess()) {
                return CompletionOutcome.Failure(
                    "Provider returned HTTP ${response.status.value}.",
                )
            }

            val text = extractAssistantText(response.bodyAsText())
            if (text.isNullOrBlank()) {
                CompletionOutcome.Failure("Provider returned no text completion.")
            } else {
                CompletionOutcome.Success(text)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: HttpRequestTimeoutException) {
            CompletionOutcome.Failure("Provider request timed out.", error)
        } catch (error: IOException) {
            CompletionOutcome.Failure("Provider network request failed.", error)
        } catch (error: SerializationException) {
            CompletionOutcome.Failure("Provider returned invalid JSON.", error)
        }
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
        val root = json.parseToJsonElement(payload).jsonObject
        val content = root["choices"]
            ?.jsonArray
            ?.firstOrNull()
            ?.jsonObject
            ?.get("message")
            ?.jsonObject
            ?.get("content")
            ?: return null

        return content.asTextContent()
    }

    private fun JsonElement.asTextContent(): String? = when (this) {
        is JsonPrimitive -> contentOrNull
        is JsonArray -> mapNotNull { part ->
            (part as? JsonObject)
                ?.get("text")
                ?.jsonPrimitive
                ?.contentOrNull
        }.joinToString("").ifBlank { null }
        else -> null
    }
}
