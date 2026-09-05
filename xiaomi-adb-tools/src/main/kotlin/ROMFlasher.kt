import javafx.scene.control.ProgressBar
import javafx.scene.control.ProgressIndicator
import javafx.scene.control.TextInputControl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.util.*

object ROMFlasher {
    var directory = XiaomiADBFastbootTools.dir
    lateinit var progressBar: ProgressBar
    lateinit var outputTextArea: TextInputControl
    lateinit var progressIndicator: ProgressIndicator
    private val flashMutex = Mutex()

    private suspend fun setupScript(arg: String): File? = withContext(Dispatchers.IO) {
        val extension = if (XiaomiADBFastbootTools.win) "bat" else "sh"
        val source = File(directory, "$arg.$extension")
        val target = File.createTempFile("xiaomi-adb-flash-", ".$extension", directory)
        try {
            val fastbootPath = "${Command.prefix}fastboot"
            val fastbootToken = if (XiaomiADBFastbootTools.win) {
                "\"$fastbootPath\""
            } else {
                "'${fastbootPath.replace("'", "'\\''")}'"
            }
            val sourceText = source.readText()
            val prepared = sourceText.lineSequence()
                .filterNot { line -> XiaomiADBFastbootTools.win && Regex("(?i)^\\s*@?pause(?:\\s*>.*)?\\s*$").matches(line) }
                .joinToString(System.lineSeparator())
                .replace(Regex("\\bfastboot\\b"), fastbootToken)
            target.writeText(prepared)
            target.setExecutable(true, false)
            target
        } catch (ex: Exception) {
            target.delete()
            ex.printStackTrace()
            ex.alert(fatal = false)
            null
        }
    }

    suspend fun flash(arg: String?) {
        if (arg == null) return
        flashMutex.withLock {
            withContext(Dispatchers.Main) {
                progressBar.progress = 0.0
                progressIndicator.isVisible = true
                outputTextArea.text = ""
            }
            val success = withContext(Dispatchers.IO) {
                val script = setupScript(arg) ?: return@withContext false
                var process: Process? = null
                try {
                    val commandCount = (script.readText().split("fastboot").size - 1).coerceAtLeast(1)
                    val started = runScript(script, redirectErrorStream = true)
                    process = started
                    Scanner(started.inputStream, "UTF-8").useDelimiter("").use { scanner ->
                        val output = StringBuilder()
                        while (scanner.hasNext()) {
                            val next = scanner.next()
                            output.append(next)
                            val full = output.toString()
                            withContext(Dispatchers.Main) {
                                outputTextArea.appendText(next)
                                progressBar.progress = 1.0 * (full.lowercase().split("finished.").size - 1) / commandCount
                            }
                        }
                    }
                    started.waitFor() == 0
                } catch (ex: Exception) {
                    ex.printStackTrace()
                    ex.alert(fatal = false)
                    false
                } finally {
                    if (process?.isAlive == true) process.destroyForcibly()
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
}
