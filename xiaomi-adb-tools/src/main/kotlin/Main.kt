import java.io.File

object Main {

    @JvmStatic
    fun main(args: Array<String>) {
        // JavaFX unpacks its native libraries into ~/.openjfx unless told otherwise, and it
        // reads this before the first JavaFX class touches them - so it has to be set here,
        // in the launcher, not inside the Application.
        System.setProperty(
            "javafx.cachedir",
            File(System.getProperty("user.home"), ".local/openjfx").absolutePath
        )
        XiaomiADBFastbootTools.main(args)
    }
}
