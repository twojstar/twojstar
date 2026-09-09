package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.LiteRtLmJniException
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.ModelSemanticRenderer
import io.github.twojstar.intentkeyboard.OpenAiCompatibleCompletionClient
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.SemanticPipeline
import io.github.twojstar.intentkeyboard.SemanticRenderException
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface LocalSemanticRuntimeState {
    data object Mechanical : LocalSemanticRuntimeState

    data class Loading(val displayName: String) : LocalSemanticRuntimeState

    data class Ready(val displayName: String) : LocalSemanticRuntimeState

    data class Failed(
        val displayName: String,
        val message: String,
    ) : LocalSemanticRuntimeState
}

private data class LocalModelLoadFailure(
    val message: String,
    val cause: Throwable,
)

/**
 * Owns the Android semantic renderer and its optional LiteRT-LM engine.
 *
 * Engine swaps and renders share one mutex so an old native engine is never closed underneath an
 * in-flight render. Model initialization stays outside that mutex and is cancellation-safe through
 * [createCpuLiteRtLmEngine]. A newly selected model is not committed as the stable choice until its
 * engine reaches Ready; failed replacements roll back to the previously working private copy.
 *
 * Remote rendering is opt-in and remains a fallback: a ready local model is always tried first.
 * Without a ready local model an explicitly enabled remote provider is tried before the mechanical
 * fallback. Provider failures retain the draft and degrade to the mechanical renderer with a warning.
 */
class LocalSemanticRuntime(
    context: Context,
    private val scope: CoroutineScope,
    private val onRenderPreferencesChanged: () -> Unit = {},
    private val onStateChanged: (LocalSemanticRuntimeState) -> Unit,
) {
    private val appContext = context.applicationContext
    private val store = LocalModelStore(appContext)
    private val renderPreferenceStore = RenderPreferenceStore(appContext)
    private val remoteProviderStore = RemoteProviderStore(appContext)
    private val remoteHttpClient = HttpClient(OkHttp)
    private val runtimeMutex = Mutex()
    private val reloadMutex = Mutex()
    private val fallbackPipeline = SemanticPipeline(MechanicalRenderer())

    private var activePipeline = fallbackPipeline
    private var activeEngine: Engine? = null
    private var reloadJob: Job? = null
    private var modelPreferenceListener: SharedPreferences.OnSharedPreferenceChangeListener? = null
    private var renderPreferenceListener: SharedPreferences.OnSharedPreferenceChangeListener? = null
    private var closed = false

    fun start() {
        check(modelPreferenceListener == null && renderPreferenceListener == null) {
            "LocalSemanticRuntime is already started"
        }

        modelPreferenceListener = store.registerChangeListener(::reload)
        renderPreferenceListener = renderPreferenceStore.registerChangeListener {
            if (!closed) onRenderPreferencesChanged()
        }
        reload()
    }

    suspend fun render(request: RenderRequest): RenderResult {
        val preferences = renderPreferenceStore.current()
        val effectiveRequest = request.copy(
            tone = preferences.tone,
            sourceLanguage = preferences.sourceLanguage,
            targetLanguage = preferences.targetLanguage,
            recipientProfile = preferences.recipientProfile,
        )

        return runtimeMutex.withLock {
            if (effectiveRequest.register == Register.RAW) {
                return@withLock fallbackPipeline.render(effectiveRequest)
            }

            if (activeEngine == null) {
                renderRemoteOrMechanical(effectiveRequest)
            } else {
                val startedAtNanos = System.nanoTime()
                try {
                    val result = activePipeline.render(effectiveRequest)
                    LocalInferenceMetrics.recordSuccess(
                        latencyMillis = (System.nanoTime() - startedAtNanos) / 1_000_000L,
                        inputCharacters = effectiveRequest.rawIntent.length,
                        outputCharacters = result.text.length,
                    )
                    result
                } catch (_: SemanticRenderException) {
                    LocalInferenceMetrics.recordFailure()
                    renderRemoteAfterLocalFailure(effectiveRequest)
                }
            }
        }
    }

    fun close() {
        if (closed) return
        closed = true

        modelPreferenceListener?.let(store::unregisterChangeListener)
        modelPreferenceListener = null
        renderPreferenceListener?.let(renderPreferenceStore::unregisterChangeListener)
        renderPreferenceListener = null

        val pendingReload = reloadJob
        pendingReload?.cancel()
        reloadJob = null

        val cleanupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        cleanupScope.launch {
            pendingReload?.join()
            runtimeMutex.withLock {
                val previous = activeEngine
                activeEngine = null
                activePipeline = fallbackPipeline
                releaseEngine(previous)
                remoteHttpClient.close()
            }
            cleanupScope.cancel()
        }
    }

    private suspend fun renderRemoteAfterLocalFailure(request: RenderRequest): RenderResult {
        val remote = remotePipeline() ?: return fallbackPipeline.render(request).withWarning(
            "Local rendering failed; mechanical fallback used.",
        )

        return try {
            remote.render(request).withWarning(
                "Local render failed; remote fallback used. Draft text left this device.",
            )
        } catch (_: SemanticRenderException) {
            fallbackPipeline.render(request).withWarning(
                "Local and remote rendering failed; mechanical fallback used. " +
                    "Remote request was attempted; draft may have left this device.",
            )
        }
    }

    private suspend fun renderRemoteOrMechanical(request: RenderRequest): RenderResult {
        val remote = remotePipeline() ?: return fallbackPipeline.render(request)
        return try {
            remote.render(request).withWarning("Remote fallback used; draft text left this device.")
        } catch (_: SemanticRenderException) {
            fallbackPipeline.render(request).withWarning(
                "Remote provider failed; mechanical fallback used. " +
                    "Remote request was attempted; draft may have left this device.",
            )
        }
    }

    private fun remotePipeline(): SemanticPipeline? {
        val config = remoteProviderStore.current().configOrNull() ?: return null
        return SemanticPipeline(
            ModelSemanticRenderer(
                OpenAiCompatibleCompletionClient(
                    config = config,
                    httpClient = remoteHttpClient,
                    tokenProvider = remoteProviderStore,
                ),
            ),
        )
    }

    private fun RenderResult.withWarning(warning: String): RenderResult =
        copy(warnings = listOf(warning) + warnings)

    private fun reload() {
        if (closed) return

        reloadJob?.cancel()
        reloadJob = scope.launch {
            reloadMutex.withLock {
                currentCoroutineContext().ensureActive()
                val selection = store.current()

                if (selection == null) {
                    installFallback()
                    store.pruneObsoleteModels()
                    publish(LocalSemanticRuntimeState.Mechanical)
                } else {
                    load(selection)
                }
            }
        }
    }

    private suspend fun load(selection: LocalModelSelection) {
        installFallback()
        currentCoroutineContext().ensureActive()
        publish(LocalSemanticRuntimeState.Loading(selection.displayName))

        var candidate: Engine? = null
        var failure: LocalModelLoadFailure? = null

        try {
            val initialized = createCpuLiteRtLmEngine(
                LiteRtLmCpuConfig(
                    modelPath = selection.path,
                    cacheDir = appContext.cacheDir.absolutePath,
                ),
            )
            candidate = initialized

            val nextPipeline = SemanticPipeline(
                ModelSemanticRenderer(LiteRtLmCompletionClient(initialized)),
            )

            currentCoroutineContext().ensureActive()

            runtimeMutex.withLock {
                currentCoroutineContext().ensureActive()
                val previous = activeEngine
                activeEngine = initialized
                activePipeline = nextPipeline
                candidate = null
                releaseEngine(previous)
            }

            try {
                store.confirmSelection(selection.path)
                store.pruneObsoleteModels()
            } catch (error: LocalModelStoreException) {
                Log.w(TAG, "Model is ready, but selection metadata cleanup failed", error)
            }

            publish(LocalSemanticRuntimeState.Ready(selection.displayName))
        } catch (error: CancellationException) {
            throw error
        } catch (error: IllegalArgumentException) {
            failure = LocalModelLoadFailure("Model file is unavailable.", error)
        } catch (error: LiteRtLmJniException) {
            failure = LocalModelLoadFailure("LiteRT-LM could not initialize this model.", error)
        } catch (error: IllegalStateException) {
            failure = LocalModelLoadFailure("LiteRT-LM engine initialization failed.", error)
        } catch (error: UnsatisfiedLinkError) {
            failure = LocalModelLoadFailure("LiteRT-LM native runtime is unavailable on this device.", error)
        } finally {
            releaseEngine(candidate)
        }

        failure?.let { recoverOrFail(selection, it) }
    }

    private suspend fun recoverOrFail(
        rejected: LocalModelSelection,
        failure: LocalModelLoadFailure,
    ) {
        Log.w(TAG, "Local model load failed for ${rejected.displayName}: ${failure.message}", failure.cause)

        if (store.current()?.path != rejected.path) {
            return
        }

        val rollback = try {
            store.rollbackSelection(rejected.path)
        } catch (error: LocalModelStoreException) {
            Log.w(TAG, "Could not restore previous local model metadata", error)
            installFallback()
            publish(LocalSemanticRuntimeState.Failed(rejected.displayName, failure.message))
            return
        }

        store.pruneObsoleteModels()

        if (rollback != null && rollback.path != rejected.path) {
            load(rollback)
        } else {
            installFallback()
            publish(LocalSemanticRuntimeState.Failed(rejected.displayName, failure.message))
        }
    }

    private suspend fun installFallback() {
        runtimeMutex.withLock {
            val previous = activeEngine
            activeEngine = null
            activePipeline = fallbackPipeline
            LocalInferenceMetrics.reset()
            releaseEngine(previous)
        }
    }

    private fun publish(state: LocalSemanticRuntimeState) {
        if (!closed) onStateChanged(state)
    }

    private suspend fun releaseEngine(engine: Engine?) {
        if (engine?.isInitialized() != true) return

        withContext(Dispatchers.IO + NonCancellable) {
            try {
                engine.close()
            } catch (error: LiteRtLmJniException) {
                Log.w(TAG, "LiteRT-LM engine cleanup failed", error)
            } catch (error: IllegalStateException) {
                Log.w(TAG, "LiteRT-LM engine was already unavailable during cleanup", error)
            } catch (error: UnsatisfiedLinkError) {
                Log.w(TAG, "LiteRT-LM native runtime disappeared during cleanup", error)
            }
        }
    }

    private companion object {
        const val TAG = "IntentKeyboardModel"
    }
}
