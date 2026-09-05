import Command.prefix
import javafx.collections.FXCollections
import javafx.collections.ObservableList
import javafx.scene.control.ProgressBar
import javafx.scene.control.TextField
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.*

class FileExplorer(val statusTextField: TextField, val statusProgressBar: ProgressBar) {

    var path = "/"

    private fun makeFile(out: String): AndroidFile? {
        val bits = mutableListOf<String>().also {
            for (bit in out.split(' '))
                if (bit.isNotBlank()) {
                    if (bit == "->")
                        break
                    it.add(bit)
                }
        }
        return when {
            bits.size < 6 -> null
            bits.size >= 7 && bits[5].length == 10 && bits[6].length == 5 -> AndroidFile(
                bits[0][0] != '-',
                bits.drop(7).joinToString(" ").trim(),
                bits[4].toLong(),
                "${bits[5]} ${bits[6]}"
            )
            bits[4].length == 10 && bits[5].length == 5 -> AndroidFile(
                bits[0][0] != '-',
                bits.drop(6).joinToString(" ").trim(),
                bits[3].toLong(),
                "${bits[4]} ${bits[5]}"
            )
            bits[3].length == 10 && bits[4].length == 5 -> AndroidFile(
                bits[0][0] != '-',
                bits.drop(5).joinToString(" ").trim(),
                0L,
                "${bits[3]} ${bits[4]}"
            )
            else -> null
        }

    }

    fun navigate(where: String) {
        if (where == "..") {
            if (path.split('/').size < 3)
                return
            path = path.dropLast(1).substringBeforeLast('/') + "/"
        } else path += "$where/"
    }

    suspend fun getFiles(): ObservableList<AndroidFile> = withContext(Dispatchers.IO) {
        FXCollections.observableArrayList<AndroidFile>().also { list ->
            val files = Command.exec(mutableListOf("adb", "shell", "ls", "-l", path))
            files.trim().lines().forEach {
                if ("ls:" !in it && ':' in it)
                    makeFile(it)?.let { file -> list.add(file) }
            }
        }
    }

    private suspend fun exec(command: MutableList<String>): Boolean {
        withContext(Dispatchers.Main) { statusTextField.text = "" }
        command[0] = prefix + command[0]
        return withContext(Dispatchers.IO) {
            val process = startProcess(command, redirectErrorStream = true)
            Scanner(process.inputStream, "UTF-8").useDelimiter("").use { scanner ->
                while (scanner.hasNextLine()) {
                    val output = scanner.nextLine()
                    withContext(Dispatchers.Main) {
                        if ('%' in output) {
                            statusProgressBar.progress = output.substringBefore('%').trim('[', ' ').toInt() / 100.0
                            statusTextField.text = output
                        } else if ((command[1] == "shell" && command[2] in output) || "adb" in output) {
                            statusTextField.text = "ERROR: ${output.substringAfterLast(':').trim()}"
                        }
                    }
                }
            }
            process.waitFor() == 0
        }
    }

    private suspend fun finish(success: Boolean) = withContext(Dispatchers.Main) {
        if (success) statusTextField.text = "Done!"
        else if (!statusTextField.text.startsWith("ERROR:")) statusTextField.text = "ERROR: command failed"
        statusProgressBar.progress = 0.0
    }

    suspend fun pull(selected: List<AndroidFile>, to: File) {
        var success = true
        if (selected.isEmpty()) success = exec(mutableListOf("adb", "pull", path, to.absolutePath))
        else selected.forEach { success = exec(mutableListOf("adb", "pull", path + it.name, to.absolutePath)) && success }
        finish(success)
    }

    suspend fun push(selected: List<File>) {
        var success = true
        selected.forEach { success = exec(mutableListOf("adb", "push", it.absolutePath, path)) && success }
        finish(success)
    }

    suspend fun delete(selected: List<AndroidFile>) {
        var success = true
        selected.forEach {
            val command = if (it.dir)
                mutableListOf("adb", "shell", "rm", "-rf", (path + it.name).escape())
            else mutableListOf("adb", "shell", "rm", "-f", (path + it.name).escape())
            success = exec(command) && success
        }
        finish(success)
    }

    suspend fun mkdir(name: String) {
        finish(exec(mutableListOf("adb", "shell", "mkdir", (path + name).escape())))
    }

    suspend fun rename(selected: AndroidFile, to: String) {
        finish(exec(mutableListOf("adb", "shell", "mv", (path + selected.name).escape(), (path + to).escape())))
    }

}