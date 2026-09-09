package io.github.twojstar.intentkeyboard.android

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.LiteRtLmJniException
import io.github.twojstar.intentkeyboard.CompletionOutcome
import io.github.twojstar.intentkeyboard.ModelPrompt
import io.github.twojstar.intentkeyboard.SemanticCompletionClient
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class LiteRtLmCpuConfig(
    val modelPath: String,
    val cacheDir: String? = null,
    val threadCount: Int? = null,
    val maxNumTokens: Int? = null,
) {
    init {
        require(modelPath.isNotBlank()) { "modelPath must not be blank" }
        require(cacheDir == null || cacheDir.isNotBlank()) { "cacheDir must be null or non-blank" }
        require(threadCount == null || threadCount > 0) { "threadCount must be positive or null" }
        require(maxNumTokens == null || maxNumTokens > 0) { "maxNumTokens must be positive or null" }
    }
}

data class LiteRtLmGenerationConfig(
    val maxOutputToken: Int = DEFAULT_KEYBOARD_MAX_OUTPUT_TOKENS,
) {
    init {
        require(maxOutputToken > 0) { "maxOutputToken must be positive" }
    }

    companion object {
        const val DEFAULT_KEYBOARD_MAX_OUTPUT_TOKENS = 512
    }
}

data class LocalInferenceMetricsSnapshot(
    val successfulSamples: Int,
    val failedSamples: Int,
    val lastLatencyMillis: Long?,
    val medianLatencyMillis: Long?,
    val lastInputCharacters: Int?,
    val lastOutputCharacters: Int?,
)

/**
 * Process-local performance samples for real-device tuning.
 *
 * Only timings and character counts are retained. Draft or completion text is never stored, and all
 * samples disappear when the app process exits.
 */
object LocalInferenceMetrics {
    private const val MAX_SAMPLES = 20
    private val lock = Any()
    private val successfulLatenciesMillis = ArrayDeque<Long>(MAX_SAMPLES)
    private var failedSamples = 0
    private var lastInputCharacters: Int? = null
    private var lastOutputCharacters: Int? = null

    fun recordSuccess(latencyMillis: Long, inputCharacters: Int, outputCharacters: Int) {
        synchronized(lock) {
            if (successfulLatenciesMillis.size == MAX_SAMPLES) {
                successfulLatenciesMillis.removeFirst()
            }
            successfulLatenciesMillis.addLast(latencyMillis)
            lastInputCharacters = inputCharacters
            lastOutputCharacters = outputCharacters
        }
    }

    fun recordFailure() {
        synchronized(lock) {
            failedSamples += 1
        }
    }

    fun snapshot(): LocalInferenceMetricsSnapshot = synchronized(lock) {
        val sorted = successfulLatenciesMillis.sorted()
        val median = when {
            sorted.isEmpty() -> null
            sorted.size % 2 == 1 -> sorted[sorted.size / 2]
            else -> (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2
        }

        LocalInferenceMetricsSnapshot(
            successfulSamples = successfulLatenciesMillis.size,
            failedSamples = failedSamples,
            lastLatencyMillis = successfulLatenciesMillis.lastOrNull(),
            medianLatencyMillis = median,
            lastInputCharacters = lastInputCharacters,
            lastOutputCharacters = lastOutputCharacters,
        )
    }
}

/**
 * Creates and initializes a CPU-only LiteRT-LM engine on a background dispatcher.
 *
 * The caller owns the returned [Engine] and must close it after all completions have stopped.
 * Models are intentionally supplied by local file path and are never bundled by this adapter.
 */
suspend fun createCpuLiteRtLmEngine(config: LiteRtLmCpuConfig): Engine {
    val modelFile = withContext(Dispatchers.IO) {
        File(config.modelPath).also { file ->
            require(file.isFile) { "LiteRT-LM model does not exist: ${config.modelPath}" }
        }
    }

    val engine = Engine(
        EngineConfig(
            modelPath = modelFile.absolutePath,
            backend = Backend.CPU(threadCount = config.threadCount),
            maxNumTokens = config.maxNumTokens,
            cacheDir = config.cacheDir,
        ),
    )

    return try {
        withContext(Dispatchers.IO) {
            engine.initialize()
        }
        engine
    } catch (error: CancellationException) {
        closeCancelledInitialization(engine, error)
        throw error
    }
}

private suspend fun closeCancelledInitialization(
    engine: Engine,
    cancellation: CancellationException,
) {
    if (!engine.isInitialized()) return

    withContext(Dispatchers.IO + NonCancellable) {
        try {
            engine.close()
        } catch (error: LiteRtLmJniException) {
            cancellation.addSuppressed(error)
        } catch (error: IllegalStateException) {
            cancellation.addSuppressed(error)
        } catch (error: UnsatisfiedLinkError) {
            cancellation.addSuppressed(error)
        }
    }
}

/**
 * Android LiteRT-LM adapter for the provider-neutral semantic completion contract.
 *
 * [engine] must already be initialized and remains owned by the caller. Completions are serialized
 * because the same engine is shared while each request gets a fresh conversation with no inherited
 * chat history.
 */
class LiteRtLmCompletionClient(
    private val engine: Engine,
    private val generationConfig: LiteRtLmGenerationConfig = LiteRtLmGenerationConfig(),
) : SemanticCompletionClient {
    private val inferenceMutex = Mutex()

    init {
        require(engine.isInitialized()) { "LiteRT-LM engine must be initialized before use" }
    }

    override suspend fun complete(prompt: ModelPrompt): CompletionOutcome = inferenceMutex.withLock {
        try {
            val text = withContext(Dispatchers.IO) {
                engine.createConversation(
                    ConversationConfig(
                        systemInstruction = Contents.of(prompt.instructions),
                        automaticToolCalling = false,
                        maxOutputToken = generationConfig.maxOutputToken,
                    ),
                ).use { conversation ->
                    conversation.sendMessage(prompt.input).toString()
                }
            }

            if (text.isBlank()) {
                CompletionOutcome.Failure("LiteRT-LM returned no text completion.")
            } else {
                CompletionOutcome.Success(text)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: LiteRtLmJniException) {
            CompletionOutcome.Failure("LiteRT-LM inference failed.", error)
        } catch (error: IllegalStateException) {
            CompletionOutcome.Failure("LiteRT-LM engine is unavailable.", error)
        } catch (error: UnsatisfiedLinkError) {
            CompletionOutcome.Failure("LiteRT-LM native runtime is unavailable.", error)
        }
    }
}
