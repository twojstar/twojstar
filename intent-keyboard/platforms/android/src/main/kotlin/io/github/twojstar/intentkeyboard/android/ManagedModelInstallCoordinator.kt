package io.github.twojstar.intentkeyboard.android

import android.content.Context
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface ManagedModelInstallState {
    data object Idle : ManagedModelInstallState
    data class Running(val progress: ManagedModelInstallProgress) : ManagedModelInstallState
    data class Completed(val selection: LocalModelSelection) : ManagedModelInstallState
    data object Cancelled : ManagedModelInstallState
    data class Failed(
        val message: String,
        val cause: Throwable? = null,
    ) : ManagedModelInstallState
}

/**
 * Process-scoped owner for the long-running managed model install.
 *
 * SetupActivity may be recreated for rotation, locale or other configuration changes while a
 * 347 MB model is downloading. Keeping the job here lets replacement activities reconnect to the
 * current state without duplicating or cancelling the transfer. The process dying still ends the
 * operation; stale partial files are removed before the next explicit install.
 */
class ManagedModelInstallCoordinator private constructor(context: Context) {
    private val appContext = context.applicationContext
    private val modelStore = LocalModelStore(appContext)
    private val installer = ManagedModelInstaller(appContext, modelStore)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val listeners = CopyOnWriteArraySet<(ManagedModelInstallState) -> Unit>()

    @Volatile
    private var currentState: ManagedModelInstallState = ManagedModelInstallState.Idle
    private var installJob: Job? = null

    val state: ManagedModelInstallState
        get() = currentState

    fun addListener(listener: (ManagedModelInstallState) -> Unit) {
        listeners += listener
        listener(currentState)
    }

    fun removeListener(listener: (ManagedModelInstallState) -> Unit) {
        listeners -= listener
    }

    fun start(spec: ManagedModelSpec = ManagedModelCatalog.recommended) {
        if (installJob?.isActive == true) return

        publish(ManagedModelInstallState.Running(ManagedModelInstallProgress.Connecting))
        installJob = scope.launch {
            try {
                val selection = installer.install(spec) { progress ->
                    withContext(Dispatchers.Main.immediate) {
                        publish(ManagedModelInstallState.Running(progress))
                    }
                }
                publish(ManagedModelInstallState.Completed(selection))
            } catch (error: CancellationException) {
                withContext(NonCancellable + Dispatchers.Main.immediate) {
                    publish(ManagedModelInstallState.Cancelled)
                }
            } catch (error: ManagedModelInstallException) {
                publish(
                    ManagedModelInstallState.Failed(
                        message = error.message ?: "Offline model installation failed.",
                        cause = error,
                    ),
                )
            } finally {
                installJob = null
            }
        }
    }

    fun cancel() {
        val job = installJob ?: return
        job.cancel()
        installer.cancelActiveDownload()
    }

    private fun publish(state: ManagedModelInstallState) {
        currentState = state
        listeners.forEach { listener -> listener(state) }
    }

    companion object {
        @Volatile
        private var instance: ManagedModelInstallCoordinator? = null

        fun get(context: Context): ManagedModelInstallCoordinator =
            instance ?: synchronized(this) {
                instance ?: ManagedModelInstallCoordinator(context).also { created ->
                    instance = created
                }
            }
    }
}
