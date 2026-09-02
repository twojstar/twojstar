import javafx.application.Application
import javafx.fxml.FXMLLoader
import javafx.scene.Scene
import javafx.scene.image.Image
import javafx.stage.Stage
import kotlinx.coroutines.runBlocking
import java.io.File


class XiaomiADBFastbootTools : Application() {

    companion object {
        val version = "7.1"
        // Data lives under ~/.local, not straight in the home directory.
        val dir = File(System.getProperty("user.home"), ".local/xiaomi-adb-tools")
        val win = "win" in System.getProperty("os.name").lowercase()
        val linux = "linux" in System.getProperty("os.name").lowercase()

        @JvmStatic
        fun main(args: Array<String>) {
            launch(XiaomiADBFastbootTools::class.java)
        }
    }

    init {
        dir.mkdirs()
    }

    @Throws(Exception::class)
    override fun start(stage: Stage) {
        stage.scene = Scene(FXMLLoader.load(javaClass.classLoader.getResource("Main.fxml")))
        stage.title = "Xiaomi ADB/Fastboot Tools"
        stage.icons.add(Image("icon.png"))
        stage.show()
    }

    override fun stop() {
        runBlocking {
            try {
                Command.exec(mutableListOf("adb", "kill-server"))
            } catch (e: Exception) {
                // OK
            }
        }
    }

}
