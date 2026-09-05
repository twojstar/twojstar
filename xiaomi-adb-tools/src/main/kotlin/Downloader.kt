import javafx.scene.control.Label
import kotlinx.coroutines.*
import java.io.File
import java.net.URI

class Downloader(val link: String, val target: File, val progressLabel: Label) {
    private val url = URI(link).toURL()
    private fun connection() = url.openConnection().apply {
        connectTimeout = 15_000
        readTimeout = 30_000
    }
    private val size = connection().contentLengthLong.toFloat()
    private var startTime = 0L
    val progress: Float get() = if (size > 0) (target.length() / size) * 100f else 0f
    val speed: Float get() = target.length() / ((System.currentTimeMillis() - startTime).coerceAtLeast(1) / 1000.0f)

    suspend fun start() = coroutineScope {
        startTime = System.currentTimeMillis()
        val download = async(Dispatchers.IO) {
            connection().getInputStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
        }
        while (!download.isCompleted) {
            val currentSpeed = speed / 1000f
            val currentProgress = progress.toString().take(4)
            withContext(Dispatchers.Main) {
                progressLabel.text = if (currentSpeed < 1000f)
                    "$currentProgress %\t${currentSpeed.toString().take(5)} KB/s"
                else "$currentProgress %\t${(currentSpeed / 1000f).toString().take(5)} MB/s"
            }
            delay(1000)
        }
        download.await()
    }
}
