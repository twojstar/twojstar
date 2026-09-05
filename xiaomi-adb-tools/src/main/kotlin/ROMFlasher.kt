import javafx.scene.control.ProgressBar
import javafx.scene.control.ProgressIndicator
import javafx.scene.control.TextInputControl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.*

object ROMFlasher {
    var directory = XiaomiADBFastbootTools.dir
    lateinit var progressBar: ProgressBar
    lateinit var outputTextArea: TextInputControl
    lateinit var progressIndicator: ProgressIndicator

    private suspend fun setupScript(arg: String): File? = withContext(Dispatchers.IO) {
        val extension = if (XiaomiADBFastbootTools.win) "bat" else "sh"
        val source = File(directory, "$arg.$extension")
        val target = File(directory, "script.$extension")
        try {
            target.writeText(source.readText().replace("fastboot", "${Command.prefix}fastboot"))
            target.setExecutable(true, false)
            target
        } catch (ex: Exception) {
            ex.printStackTrace()
            ex.alert()
            null
        }
    }

    suspend fun flash(arg: String?) {
        if (arg == null) return
        withContext(Dispatchers.Main) {
            progressBar.progress = 0.0
            progressIndicator.isVisible = true
            outputTextArea.text = ""
        }
        val success = withContext(Dispatchers.IO) {
            val script = setupScript(arg) ?: return@withContext false
            val commandCount = (script.readText().split("fastboot").size - 1).coerceAtLeast(1)
            val process = runScript(script, redirectErrorStream = true)
            var aborted = false
            try {
                Scanner(process.inputStream, "UTF-8").useDelimiter("").use { scanner ->
                    val output = StringBuilder()
                    while (scanner.hasNext()) {
                        val next = scanner.next()
                        output.append(next)
                        val full = output.toString()
                        if ("pause" in full) { aborted = true; break }
                        withContext(Dispatchers.Main) {
                            outputTextArea.appendText(next)
                            progressBar.progress = 1.0 * (full.lowercase().split("finished.").size - 1) / commandCount
                        }
                    }
                }
                if (aborted) process.destroy()
                val exitCode = process.waitFor()
                !aborted && exitCode == 0
            } finally {
                if (process.isAlive) process.destroyForcibly()
                script.delete()
            }
        }
        withContext(Dispatchers.Main) {
            outputTextArea.appendText(if (success) "\nDone!" else "\nERROR: flashing did not complete successfully.")
            progressBar.progress = 0.0
            progressIndicator.isVisible = false
        }
    }
}
