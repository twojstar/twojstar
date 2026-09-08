package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.LiteRtLmJniException
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.ModelSemanticRenderer
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.SemanticPipeline
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

/**
 * Owns the Android semantic renderer and its optional LiteRT-LM engine.
 *
 * Engine swaps and renders share one mutex so an old native engine is never closed underneath an
 * in-flight render. Model initialization stays outside that mutex and is cancellation-safe through
 * [createCpuLiteRtLmEngine].
 */
class LocalSemanticRuntime(
    context: Context,
    private val scope: CoroutineScope,
    private val onStateChanged: (LocalSemanticRuntimeState) -> Unit,
) {
    private val appContext = context.applicationContext
    private val store = LocalModelStore(appContext)
    private val runtimeMutex = Mutex()
    private val reloadMutex = Mutex()
    private val fallbackPipeline = SemanticPipeline(MechanicalRenderer())

    private var activePipeline = fallbackPipeline
    private var activeEngine: Engine? = null
    private var reloadJob: Job? = null
    private var preferenceListener: SharedPreferences.OnSharedPreferenceChangeListener? = null
    private var closed = false

    fun start() {
        check(preferenceListener == null) { "LocalSemanticRuntime is already started" }

        preferenceListener = store.registerChangeListener(::reload)
        reload()
    }

    suspend fun render(request: RenderRequest): RenderResult = runtimeMutex.withLock {
        activePipeline.render(request)
    }

    fun close() {
        if (closed) return
        closed = true

        preferenceListener?.let(store::unregisterChangeListener)
        preferenceListener = null

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
            }
            cleanupScope.cancel()
        }
    }

    private fun reload() {
        if (closed) return

        reloadJob?.cancel()
        reloadJob = scope.launch {
            reloadMutex.withLock {
                currentCoroutineContext().ensureActive()
                val selection = store.current()

                if (selection == null) {
                    installFallback()
                    publish(LocalSemanticRuntimeState.Mechanical)
                } else {
                    load(selection)
                }
            }
        }
    }

    private suspend fun load(selection: LocalModelSelection) {
        publish(LocalSemanticRuntimeState.Loading(selection.displayName))

        var candidate: Engine? = null
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

            publish(LocalSemanticRuntimeState.Ready(selection.displayName))
        } catch (error: CancellationException) {
            throw error
        } catch (error: IllegalArgumentException) {
            fail(selection, "Model file is unavailable.")
        } catch (error: LiteRtLmJniException) {
            fail(selection, "LiteRT-LM could not initialize this model.")
        } catch (error: IllegalStateException) {
            fail(selection, "LiteRT-LM engine initialization failed.")
        } catch (error: UnsatisfiedLinkError) {
            fail(selection, "LiteRT-LM native runtime is unavailable on this device.")
        } finally {
            releaseEngine(candidate)
        }
    }

    private suspend fun fail(selection: LocalModelSelection, message: String) {
        installFallback()
        publish(
            LocalSemanticRuntimeState.Failed(
                displayName = selection.displayName,
                message = message,
            ),
        )
    }

    private suspend fun installFallback() {
        runtimeMutex.withLock {
            val previous = activeEngine
            activeEngine = null
            activePipeline = fallbackPipeline
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
