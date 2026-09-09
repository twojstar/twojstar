package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

data class LocalModelSelection(
    val path: String,
    val displayName: String,
    val sizeBytes: Long,
    val managedModelId: String? = null,
    val managedSha256: String? = null,
)

class LocalModelStoreException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * Single source of truth for the Android on-device model selection.
 *
 * Selected documents are copied into app-private storage so LiteRT-LM always receives a stable
 * filesystem path and the keyboard never depends on a long-lived external content URI grant.
 * A previously working selection is retained as rollback metadata until the runtime confirms that
 * its replacement initialized successfully.
 */
class LocalModelStore(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun current(): LocalModelSelection? = readSelection(
        pathKey = KEY_PATH,
        displayNameKey = KEY_DISPLAY_NAME,
        sizeKey = KEY_SIZE_BYTES,
        managedModelIdKey = KEY_MANAGED_MODEL_ID,
        managedSha256Key = KEY_MANAGED_SHA256,
    )

    fun registerChangeListener(onChanged: () -> Unit): SharedPreferences.OnSharedPreferenceChangeListener {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == KEY_REVISION) onChanged()
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        return listener
    }

    fun unregisterChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        preferences.unregisterOnSharedPreferenceChangeListener(listener)
    }

    suspend fun importModel(uri: Uri): LocalModelSelection = withContext(Dispatchers.IO) {
        importModelOnIo(uri)
    }

    /**
     * Activates an app-private model file only after its caller has independently verified it.
     *
     * Managed downloads use this path after checking the pinned byte count and SHA-256. The file is
     * moved into the normal model directory when possible; a cancellable copy is used only as a
     * fallback. Selection changes keep the same rollback semantics as manual document imports.
     */
    internal suspend fun installVerifiedModelFile(
        source: File,
        displayName: String,
        sizeBytes: Long,
        managedModelId: String,
        managedSha256: String,
    ): LocalModelSelection = withContext(Dispatchers.IO) {
        var target: File? = null
        var committed = false

        try {
            if (!displayName.endsWith(".litertlm", ignoreCase = true)) {
                throw LocalModelStoreException("Managed models must use the .litertlm format.")
            }
            if (managedModelId.isBlank() || managedSha256.isBlank()) {
                throw LocalModelStoreException("Managed model identity is incomplete.")
            }
            if (sizeBytes <= 0L || !source.isFile || source.length() != sizeBytes) {
                throw LocalModelStoreException("The verified model file is incomplete.")
            }

            val directory = requireModelsDirectory()
            target = File(directory, "model-${UUID.randomUUID()}.litertlm")
            currentCoroutineContext().ensureActive()

            if (!source.renameTo(target)) {
                copyFile(source, target)
            }

            currentCoroutineContext().ensureActive()
            val selection = commitSelectionOnIo(
                target = target,
                displayName = displayName,
                sizeBytes = sizeBytes,
                managedModelId = managedModelId,
                managedSha256 = managedSha256,
            )
            committed = true
            deleteBestEffort(source)
            selection
        } catch (error: IOException) {
            throw LocalModelStoreException(
                "The verified model could not be moved into private storage.",
                error,
            )
        } catch (error: SecurityException) {
            throw LocalModelStoreException(
                "Android denied access while activating the verified model.",
                error,
            )
        } finally {
            if (!committed) target?.let(::deleteBestEffort)
        }
    }

    suspend fun confirmSelection(path: String) = withContext(Dispatchers.IO) {
        if (current()?.path != path) return@withContext

        val committed = preferences.edit()
            .remove(KEY_ROLLBACK_PATH)
            .remove(KEY_ROLLBACK_DISPLAY_NAME)
            .remove(KEY_ROLLBACK_SIZE_BYTES)
            .remove(KEY_ROLLBACK_MANAGED_MODEL_ID)
            .remove(KEY_ROLLBACK_MANAGED_SHA256)
            .commit()

        if (!committed) {
            throw LocalModelStoreException("Could not confirm the local model selection.")
        }
    }

    suspend fun rollbackSelection(failedPath: String): LocalModelSelection? = withContext(Dispatchers.IO) {
        if (current()?.path != failedPath) return@withContext null

        val rollback = rollbackSelectionSnapshot()
        val editor = preferences.edit()
            .remove(KEY_ROLLBACK_PATH)
            .remove(KEY_ROLLBACK_DISPLAY_NAME)
            .remove(KEY_ROLLBACK_SIZE_BYTES)
            .remove(KEY_ROLLBACK_MANAGED_MODEL_ID)
            .remove(KEY_ROLLBACK_MANAGED_SHA256)

        if (rollback == null) {
            editor
                .remove(KEY_PATH)
                .remove(KEY_DISPLAY_NAME)
                .remove(KEY_SIZE_BYTES)
                .remove(KEY_MANAGED_MODEL_ID)
                .remove(KEY_MANAGED_SHA256)
        } else {
            editor
                .putString(KEY_PATH, rollback.path)
                .putString(KEY_DISPLAY_NAME, rollback.displayName)
                .putLong(KEY_SIZE_BYTES, rollback.sizeBytes)
                .putOptionalString(KEY_MANAGED_MODEL_ID, rollback.managedModelId)
                .putOptionalString(KEY_MANAGED_SHA256, rollback.managedSha256)
        }

        if (!editor.commit()) {
            throw LocalModelStoreException("Could not restore the previous local model selection.")
        }

        rollback
    }

    suspend fun clearModel() = withContext(Dispatchers.IO) {
        val committed = preferences.edit()
            .remove(KEY_PATH)
            .remove(KEY_DISPLAY_NAME)
            .remove(KEY_SIZE_BYTES)
            .remove(KEY_MANAGED_MODEL_ID)
            .remove(KEY_MANAGED_SHA256)
            .remove(KEY_ROLLBACK_PATH)
            .remove(KEY_ROLLBACK_DISPLAY_NAME)
            .remove(KEY_ROLLBACK_SIZE_BYTES)
            .remove(KEY_ROLLBACK_MANAGED_MODEL_ID)
            .remove(KEY_ROLLBACK_MANAGED_SHA256)
            .putLong(KEY_REVISION, nextRevision())
            .commit()

        if (!committed) {
            throw LocalModelStoreException("Could not clear the local model selection.")
        }
    }

    /**
     * Deletes private model copies that are neither selected nor retained for rollback.
     *
     * Call this only after the runtime has released any engine that could still reference an older
     * model file.
     */
    suspend fun pruneObsoleteModels() = withContext(Dispatchers.IO) {
        val retainedPaths = setOfNotNull(
            current()?.path,
            rollbackSelectionSnapshot()?.path,
        )
        val directory = modelsDirectory()

        directory.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && it.extension.equals("litertlm", ignoreCase = true) }
            ?.filter { it.absolutePath !in retainedPaths }
            ?.forEach(::deleteBestEffort)
    }

    private suspend fun importModelOnIo(uri: Uri): LocalModelSelection {
        val displayName = try {
            queryDisplayName(uri) ?: "selected-model.litertlm"
        } catch (error: SecurityException) {
            throw LocalModelStoreException("Android did not grant access to the selected model.", error)
        } catch (error: IllegalArgumentException) {
            throw LocalModelStoreException("The selected document provider could not be read.", error)
        }

        if (!displayName.endsWith(".litertlm", ignoreCase = true)) {
            throw LocalModelStoreException("Choose a .litertlm model file.")
        }

        val directory = requireModelsDirectory()
        val target = File(directory, "model-${UUID.randomUUID()}.litertlm")
        val partial = File(directory, "${target.name}.part")
        var committed = false

        try {
            val copiedBytes = copyDocument(uri, partial)
            if (copiedBytes <= 0L) {
                throw LocalModelStoreException("The selected model file is empty.")
            }

            currentCoroutineContext().ensureActive()

            if (!partial.renameTo(target)) {
                throw LocalModelStoreException("Could not finalize the imported model file.")
            }

            currentCoroutineContext().ensureActive()
            val selection = commitSelectionOnIo(
                target = target,
                displayName = displayName,
                sizeBytes = copiedBytes,
                managedModelId = null,
                managedSha256 = null,
            )
            committed = true
            return selection
        } catch (error: FileNotFoundException) {
            throw LocalModelStoreException("The selected model file could not be opened.", error)
        } catch (error: SecurityException) {
            throw LocalModelStoreException("Android denied access to the selected model.", error)
        } catch (error: IOException) {
            throw LocalModelStoreException("The model could not be copied into private storage.", error)
        } finally {
            deleteBestEffort(partial)
            if (!committed) deleteBestEffort(target)
        }
    }

    private fun commitSelectionOnIo(
        target: File,
        displayName: String,
        sizeBytes: Long,
        managedModelId: String?,
        managedSha256: String?,
    ): LocalModelSelection {
        val rollback = rollbackSelectionSnapshot() ?: current()
        val editor = preferences.edit()
            .putString(KEY_PATH, target.absolutePath)
            .putString(KEY_DISPLAY_NAME, displayName)
            .putLong(KEY_SIZE_BYTES, sizeBytes)
            .putOptionalString(KEY_MANAGED_MODEL_ID, managedModelId)
            .putOptionalString(KEY_MANAGED_SHA256, managedSha256)
            .putLong(KEY_REVISION, nextRevision())

        if (rollback == null) {
            editor
                .remove(KEY_ROLLBACK_PATH)
                .remove(KEY_ROLLBACK_DISPLAY_NAME)
                .remove(KEY_ROLLBACK_SIZE_BYTES)
                .remove(KEY_ROLLBACK_MANAGED_MODEL_ID)
                .remove(KEY_ROLLBACK_MANAGED_SHA256)
        } else {
            editor
                .putString(KEY_ROLLBACK_PATH, rollback.path)
                .putString(KEY_ROLLBACK_DISPLAY_NAME, rollback.displayName)
                .putLong(KEY_ROLLBACK_SIZE_BYTES, rollback.sizeBytes)
                .putOptionalString(KEY_ROLLBACK_MANAGED_MODEL_ID, rollback.managedModelId)
                .putOptionalString(KEY_ROLLBACK_MANAGED_SHA256, rollback.managedSha256)
        }

        if (!editor.commit()) {
            throw LocalModelStoreException("Could not save the local model selection.")
        }

        return LocalModelSelection(
            path = target.absolutePath,
            displayName = displayName,
            sizeBytes = sizeBytes,
            managedModelId = managedModelId,
            managedSha256 = managedSha256,
        )
    }

    private suspend fun copyDocument(uri: Uri, destination: File): Long {
        val input = appContext.contentResolver.openInputStream(uri)
            ?: throw FileNotFoundException("No stream for selected model")

        return input.use { source ->
            destination.outputStream().buffered().use { output ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0L

                while (true) {
                    currentCoroutineContext().ensureActive()
                    val read = source.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue

                    output.write(buffer, 0, read)
                    total += read
                }

                output.flush()
                total
            }
        }
    }

    private suspend fun copyFile(source: File, destination: File) {
        source.inputStream().buffered().use { input ->
            FileOutputStream(destination).use { fileOutput ->
                val output = fileOutput.buffered()
                try {
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val read = input.read(buffer)
                        if (read < 0) break
                        if (read == 0) continue
                        output.write(buffer, 0, read)
                    }
                    output.flush()
                    fileOutput.fd.sync()
                } finally {
                    output.close()
                }
            }
        }
    }

    private fun requireModelsDirectory(): File {
        val directory = modelsDirectory()
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw LocalModelStoreException("Could not create private storage for local models.")
        }
        return directory
    }

    private fun deleteBestEffort(file: File) {
        try {
            file.delete()
        } catch (_: SecurityException) {
            // Cleanup failure must never replace the primary model-selection result.
        }
    }

    private fun rollbackSelectionSnapshot(): LocalModelSelection? = readSelection(
        pathKey = KEY_ROLLBACK_PATH,
        displayNameKey = KEY_ROLLBACK_DISPLAY_NAME,
        sizeKey = KEY_ROLLBACK_SIZE_BYTES,
        managedModelIdKey = KEY_ROLLBACK_MANAGED_MODEL_ID,
        managedSha256Key = KEY_ROLLBACK_MANAGED_SHA256,
    )

    private fun readSelection(
        pathKey: String,
        displayNameKey: String,
        sizeKey: String,
        managedModelIdKey: String,
        managedSha256Key: String,
    ): LocalModelSelection? {
        val path = preferences.getString(pathKey, null) ?: return null
        val displayName = preferences.getString(displayNameKey, null) ?: File(path).name
        val sizeBytes = preferences.getLong(sizeKey, -1L)

        return LocalModelSelection(
            path = path,
            displayName = displayName,
            sizeBytes = sizeBytes,
            managedModelId = preferences.getString(managedModelIdKey, null),
            managedSha256 = preferences.getString(managedSha256Key, null),
        )
    }

    private fun SharedPreferences.Editor.putOptionalString(
        key: String,
        value: String?,
    ): SharedPreferences.Editor = if (value == null) remove(key) else putString(key, value)

    private fun queryDisplayName(uri: Uri): String? =
        appContext.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
        }?.takeIf { it.isNotBlank() }

    private fun modelsDirectory(): File = File(appContext.filesDir, MODELS_DIRECTORY)

    private fun nextRevision(): Long = preferences.getLong(KEY_REVISION, 0L) + 1L

    private companion object {
        const val PREFERENCES_NAME = "intent_keyboard_local_model"
        const val MODELS_DIRECTORY = "models"
        const val KEY_PATH = "path"
        const val KEY_DISPLAY_NAME = "display_name"
        const val KEY_SIZE_BYTES = "size_bytes"
        const val KEY_MANAGED_MODEL_ID = "managed_model_id"
        const val KEY_MANAGED_SHA256 = "managed_sha256"
        const val KEY_ROLLBACK_PATH = "rollback_path"
        const val KEY_ROLLBACK_DISPLAY_NAME = "rollback_display_name"
        const val KEY_ROLLBACK_SIZE_BYTES = "rollback_size_bytes"
        const val KEY_ROLLBACK_MANAGED_MODEL_ID = "rollback_managed_model_id"
        const val KEY_ROLLBACK_MANAGED_SHA256 = "rollback_managed_sha256"
        const val KEY_REVISION = "revision"
    }
}
