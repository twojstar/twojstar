package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.os.StatFs
import com.google.ai.edge.litertlm.LiteRtLmJniException
import io.github.twojstar.intentkeyboard.CompletionOutcome
import io.github.twojstar.intentkeyboard.ModelPrompt
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class ManagedModelSpec(
    val id: String,
    val displayName: String,
    val downloadUrl: String,
    val sourceUrl: String,
    val licenseName: String,
    val sizeBytes: Long,
    val sha256: String,
)

object ManagedModelCatalog {
    val recommended = ManagedModelSpec(
        id = "qwen3-0.6b-int4-nothink-6aa2daf",
        displayName = "Qwen3 0.6B INT4 (no-think).litertlm",
        downloadUrl = "https://huggingface.co/litert-community/Qwen3-0.6B-int4/resolve/6aa2daf8aba4aa456797fb8040b36a3948bcfda7/qwen3_0.6b_nothink_q4_block32_ekv1280.litertlm?download=true",
        sourceUrl = "https://huggingface.co/litert-community/Qwen3-0.6B-int4/tree/6aa2daf8aba4aa456797fb8040b36a3948bcfda7",
        licenseName = "Apache-2.0",
        sizeBytes = 347_251_840L,
        sha256 = "2df6821ec12702dafd33915e7a1a1adc7c4b053f3672fd9555dfaf3a114c4139",
    )
}

sealed interface ManagedModelInstallProgress {
    data object Connecting : ManagedModelInstallProgress
    data class Downloading(
        val downloadedBytes: Long,
        val totalBytes: Long,
    ) : ManagedModelInstallProgress
    data object Verifying : ManagedModelInstallProgress
    data object Testing : ManagedModelInstallProgress
    data object Activating : ManagedModelInstallProgress
}

class ManagedModelInstallException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * Downloads a pinned, known model artifact and hands the verified file to [LocalModelStore].
 *
 * The catalog pins both the upstream commit and SHA-256. Redirects are allowed only over HTTPS and
 * the final artifact must match both the expected byte count and digest before selection changes.
 * A tiny LiteRT-LM inference smoke test runs before activation so an incompatible artifact cannot
 * replace the last known good model merely because its bytes were downloaded correctly.
 */
class ManagedModelInstaller(
    context: Context,
    private val modelStore: LocalModelStore,
) {
    private val appContext = context.applicationContext
    private val activeConnection = AtomicReference<HttpURLConnection?>(null)

    suspend fun install(
        spec: ManagedModelSpec = ManagedModelCatalog.recommended,
        onProgress: suspend (ManagedModelInstallProgress) -> Unit = {},
    ): LocalModelSelection = withContext(Dispatchers.IO) {
        installMutex.withLock {
            currentManagedSelection(spec)?.let { return@withLock it }

            cleanupStaleDownloads()
            ensureEnoughSpace(spec)

            val downloadDirectory = requireDownloadDirectory()
            val stagingFile = File(
                downloadDirectory,
                "${spec.id}-${UUID.randomUUID()}.litertlm.part",
            )

            try {
                onProgress(ManagedModelInstallProgress.Connecting)
                downloadAndVerify(spec, stagingFile, onProgress)
                currentCoroutineContext().ensureActive()

                onProgress(ManagedModelInstallProgress.Testing)
                smokeTestModel(stagingFile)
                currentCoroutineContext().ensureActive()

                onProgress(ManagedModelInstallProgress.Activating)
                modelStore.installVerifiedModelFile(
                    source = stagingFile,
                    displayName = spec.displayName,
                    sizeBytes = spec.sizeBytes,
                    managedModelId = spec.id,
                    managedSha256 = spec.sha256,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: ManagedModelInstallException) {
                throw error
            } catch (error: LocalModelStoreException) {
                throw ManagedModelInstallException(
                    "The downloaded model was verified but could not be activated.",
                    error,
                )
            } finally {
                deleteBestEffort(stagingFile)
            }
        }
    }

    /** Interrupts a blocking HttpURLConnection read when the owning job is cancelled. */
    fun cancelActiveDownload() {
        activeConnection.get()?.disconnect()
    }

    private fun currentManagedSelection(spec: ManagedModelSpec): LocalModelSelection? {
        val selection = modelStore.current() ?: return null
        if (selection.managedModelId != spec.id) return null
        if (!selection.managedSha256.equals(spec.sha256, ignoreCase = true)) return null
        if (selection.sizeBytes != spec.sizeBytes) return null

        return try {
            File(selection.path)
                .takeIf { it.isFile && it.length() == spec.sizeBytes }
                ?.let { selection }
        } catch (_: SecurityException) {
            null
        }
    }

    private suspend fun smokeTestModel(modelFile: File) {
        val engine = try {
            createCpuLiteRtLmEngine(
                LiteRtLmCpuConfig(
                    modelPath = modelFile.absolutePath,
                    cacheDir = null,
                ),
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: LiteRtLmJniException) {
            throw ManagedModelInstallException("The offline model could not initialize.", error)
        } catch (error: IllegalStateException) {
            throw ManagedModelInstallException("The offline model is incompatible with this runtime.", error)
        } catch (error: UnsatisfiedLinkError) {
            throw ManagedModelInstallException("LiteRT-LM is unavailable on this device.", error)
        }

        var closeFailure: Throwable? = null
        try {
            when (
                val outcome = LiteRtLmCompletionClient(engine).complete(
                    ModelPrompt(
                        instructions = "Return one short plain-text answer and nothing else.",
                        input = "Reply with OK.",
                    ),
                )
            ) {
                is CompletionOutcome.Success -> {
                    if (outcome.text.isBlank()) {
                        throw ManagedModelInstallException("The offline model returned no smoke-test output.")
                    }
                }
                is CompletionOutcome.Failure -> {
                    throw ManagedModelInstallException(
                        "The offline model failed its inference smoke test.",
                        outcome.cause,
                    )
                }
            }
        } finally {
            withContext(Dispatchers.IO + NonCancellable) {
                try {
                    engine.close()
                } catch (error: LiteRtLmJniException) {
                    closeFailure = error
                } catch (error: IllegalStateException) {
                    closeFailure = error
                } catch (error: UnsatisfiedLinkError) {
                    closeFailure = error
                }
            }
        }

        currentCoroutineContext().ensureActive()
        closeFailure?.let { error ->
            throw ManagedModelInstallException(
                "The offline model passed inference but its test engine could not close cleanly.",
                error,
            )
        }
    }

    private suspend fun downloadAndVerify(
        spec: ManagedModelSpec,
        destination: File,
        onProgress: suspend (ManagedModelInstallProgress) -> Unit,
    ) {
        var connection: HttpURLConnection? = null

        try {
            connection = openHttpsConnection(spec.downloadUrl)
            validateDeclaredLength(connection, spec)

            val digest = MessageDigest.getInstance("SHA-256")
            val downloadedBytes = copyResponseBody(
                connection = connection,
                destination = destination,
                spec = spec,
                digest = digest,
                onProgress = onProgress,
            )

            verifyDownloadedArtifact(
                spec = spec,
                downloadedBytes = downloadedBytes,
                digest = digest,
                onProgress = onProgress,
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: ManagedModelInstallException) {
            throw error
        } catch (error: IOException) {
            currentCoroutineContext().ensureActive()
            throw ManagedModelInstallException(
                "Could not download the offline model.",
                error,
            )
        } catch (error: SecurityException) {
            throw ManagedModelInstallException(
                "Android blocked access to the model download.",
                error,
            )
        } finally {
            connection?.let { opened ->
                activeConnection.compareAndSet(opened, null)
                opened.disconnect()
            }
        }
    }

    private fun validateDeclaredLength(
        connection: HttpURLConnection,
        spec: ManagedModelSpec,
    ) {
        val declaredLength = connection.contentLengthLong
        if (declaredLength > 0L && declaredLength != spec.sizeBytes) {
            throw ManagedModelInstallException(
                "The model source reported an unexpected file size.",
            )
        }
    }

    private suspend fun copyResponseBody(
        connection: HttpURLConnection,
        destination: File,
        spec: ManagedModelSpec,
        digest: MessageDigest,
        onProgress: suspend (ManagedModelInstallProgress) -> Unit,
    ): Long {
        var downloaded = 0L
        var nextProgressAt = 0L

        connection.inputStream.use { networkInput ->
            BufferedInputStream(networkInput, BUFFER_SIZE).use { input ->
                FileOutputStream(destination).use { fileOutput ->
                    BufferedOutputStream(fileOutput, BUFFER_SIZE).use { output ->
                        val buffer = ByteArray(BUFFER_SIZE)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val read = input.read(buffer)
                            if (read < 0) break
                            if (read == 0) continue

                            downloaded += read
                            if (downloaded > spec.sizeBytes) {
                                throw ManagedModelInstallException(
                                    "The downloaded model exceeded its pinned size.",
                                )
                            }

                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)

                            if (downloaded >= nextProgressAt || downloaded == spec.sizeBytes) {
                                onProgress(
                                    ManagedModelInstallProgress.Downloading(
                                        downloadedBytes = downloaded,
                                        totalBytes = spec.sizeBytes,
                                    ),
                                )
                                nextProgressAt = downloaded + PROGRESS_STEP_BYTES
                            }
                        }

                        output.flush()
                        fileOutput.fd.sync()
                    }
                }
            }
        }

        return downloaded
    }

    private suspend fun verifyDownloadedArtifact(
        spec: ManagedModelSpec,
        downloadedBytes: Long,
        digest: MessageDigest,
        onProgress: suspend (ManagedModelInstallProgress) -> Unit,
    ) {
        if (downloadedBytes != spec.sizeBytes) {
            throw ManagedModelInstallException("The model download was incomplete.")
        }

        onProgress(ManagedModelInstallProgress.Verifying)
        val actualSha256 = digest.digest().toHexString()
        if (!actualSha256.equals(spec.sha256, ignoreCase = true)) {
            throw ManagedModelInstallException(
                "The downloaded model failed its SHA-256 integrity check.",
            )
        }
    }

    private fun openHttpsConnection(initialUrl: String): HttpURLConnection {
        var url = URL(initialUrl)

        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            if (!url.protocol.equals("https", ignoreCase = true)) {
                throw ManagedModelInstallException("Model downloads must use HTTPS.")
            }

            val connection = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                requestMethod = "GET"
                setRequestProperty("Accept-Encoding", "identity")
                setRequestProperty("User-Agent", USER_AGENT)
            }
            if (!activeConnection.compareAndSet(null, connection)) {
                connection.disconnect()
                throw ManagedModelInstallException("Another managed model download is already active.")
            }
            var handedOff = false

            try {
                val status = connection.responseCode
                if (status in REDIRECT_CODES) {
                    val location = connection.getHeaderField("Location")
                    if (location.isNullOrBlank()) {
                        throw ManagedModelInstallException(
                            "The model source returned an invalid redirect.",
                        )
                    }
                    if (redirectCount == MAX_REDIRECTS) {
                        throw ManagedModelInstallException("Too many model download redirects.")
                    }

                    url = URL(url, location)
                } else {
                    if (status != HttpURLConnection.HTTP_OK) {
                        throw ManagedModelInstallException(
                            "Model download failed with HTTP $status.",
                        )
                    }

                    handedOff = true
                    return connection
                }
            } finally {
                if (!handedOff) {
                    activeConnection.compareAndSet(connection, null)
                    connection.disconnect()
                }
            }
        }

        throw ManagedModelInstallException("Too many model download redirects.")
    }

    private fun ensureEnoughSpace(spec: ManagedModelSpec) {
        val availableBytes = try {
            StatFs(appContext.filesDir.absolutePath).availableBytes
        } catch (error: IllegalArgumentException) {
            throw ManagedModelInstallException("Could not inspect available storage.", error)
        } catch (error: SecurityException) {
            throw ManagedModelInstallException("Android blocked the storage availability check.", error)
        }

        val requiredBytes = (spec.sizeBytes * 2L) + MIN_FREE_SPACE_BYTES
        if (availableBytes < requiredBytes) {
            throw ManagedModelInstallException(
                "Not enough free storage for download and safe model activation.",
            )
        }
    }

    private fun requireDownloadDirectory(): File {
        val directory = downloadDirectory()
        try {
            if (!directory.isDirectory && !directory.mkdirs()) {
                throw ManagedModelInstallException(
                    "Could not create temporary storage for the offline model.",
                )
            }
        } catch (error: SecurityException) {
            throw ManagedModelInstallException(
                "Android blocked temporary storage for the offline model.",
                error,
            )
        }
        return directory
    }

    private fun cleanupStaleDownloads() {
        try {
            downloadDirectory().listFiles()
                ?.asSequence()
                ?.filter { it.isFile && it.name.endsWith(".litertlm.part") }
                ?.forEach(::deleteBestEffort)
        } catch (_: SecurityException) {
            // Stale cache cleanup is optional and must not block a new verified download.
        }
    }

    private fun deleteBestEffort(file: File) {
        try {
            file.delete()
        } catch (_: SecurityException) {
            // Cache cleanup failure must not replace the primary installation result.
        }
    }

    private fun downloadDirectory(): File = File(appContext.cacheDir, DOWNLOAD_DIRECTORY)

    private fun ByteArray.toHexString(): String {
        val alphabet = "0123456789abcdef"
        return buildString(size * 2) {
            for (byte in this@toHexString) {
                val value = byte.toInt() and 0xff
                append(alphabet[value ushr 4])
                append(alphabet[value and 0x0f])
            }
        }
    }

    private companion object {
        val installMutex = Mutex()

        const val DOWNLOAD_DIRECTORY = "managed-model-downloads"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 60_000
        const val BUFFER_SIZE = 64 * 1024
        const val PROGRESS_STEP_BYTES = 4L * 1024L * 1024L
        const val MIN_FREE_SPACE_BYTES = 64L * 1024L * 1024L
        const val MAX_REDIRECTS = 8
        const val USER_AGENT = "IntentKeyboard/0.1 managed-model-installer"
        val REDIRECT_CODES = setOf(
            HttpURLConnection.HTTP_MOVED_PERM,
            HttpURLConnection.HTTP_MOVED_TEMP,
            HttpURLConnection.HTTP_SEE_OTHER,
            307,
            308,
        )
    }
}
