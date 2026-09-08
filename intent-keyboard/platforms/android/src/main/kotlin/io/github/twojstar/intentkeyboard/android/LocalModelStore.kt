package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException
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
 */
class LocalModelStore(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun current(): LocalModelSelection? {
        val path = preferences.getString(KEY_PATH, null) ?: return null
        val displayName = preferences.getString(KEY_DISPLAY_NAME, null) ?: File(path).name
        val sizeBytes = preferences.getLong(KEY_SIZE_BYTES, -1L)

        return LocalModelSelection(
            path = path,
            displayName = displayName,
            sizeBytes = sizeBytes,
        )
    }

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

    suspend fun clearModel() = withContext(Dispatchers.IO) {
        val previous = current()
        val committed = preferences.edit()
            .remove(KEY_PATH)
            .remove(KEY_DISPLAY_NAME)
            .remove(KEY_SIZE_BYTES)
            .putLong(KEY_REVISION, nextRevision())
            .commit()

        if (!committed) {
            throw LocalModelStoreException("Could not clear the local model selection.")
        }

        deleteManagedFile(previous?.path)
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

        val directory = modelsDirectory()
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw LocalModelStoreException("Could not create private storage for local models.")
        }

        val target = File(directory, "model-${UUID.randomUUID()}.litertlm")
        val partial = File(directory, "${target.name}.part")
        val previous = current()
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

            committed = preferences.edit()
                .putString(KEY_PATH, target.absolutePath)
                .putString(KEY_DISPLAY_NAME, displayName)
                .putLong(KEY_SIZE_BYTES, copiedBytes)
                .putLong(KEY_REVISION, nextRevision())
                .commit()

            if (!committed) {
                throw LocalModelStoreException("Could not save the local model selection.")
            }

            deleteManagedFile(previous?.path)

            return LocalModelSelection(
                path = target.absolutePath,
                displayName = displayName,
                sizeBytes = copiedBytes,
            )
        } catch (error: FileNotFoundException) {
            throw LocalModelStoreException("The selected model file could not be opened.", error)
        } catch (error: SecurityException) {
            throw LocalModelStoreException("Android denied access to the selected model.", error)
        } catch (error: IOException) {
            throw LocalModelStoreException("The model could not be copied into private storage.", error)
        } finally {
            partial.delete()
            if (!committed) target.delete()
        }
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

    private fun deleteManagedFile(path: String?) {
        path ?: return
        val file = File(path)
        if (file.parentFile?.absoluteFile == modelsDirectory().absoluteFile) {
            file.delete()
        }
    }

    private fun nextRevision(): Long = preferences.getLong(KEY_REVISION, 0L) + 1L

    private companion object {
        const val PREFERENCES_NAME = "intent_keyboard_local_model"
        const val MODELS_DIRECTORY = "models"
        const val KEY_PATH = "path"
        const val KEY_DISPLAY_NAME = "display_name"
        const val KEY_SIZE_BYTES = "size_bytes"
        const val KEY_REVISION = "revision"
    }
}
