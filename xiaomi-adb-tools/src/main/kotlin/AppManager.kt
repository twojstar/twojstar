import Command.prefix
import javafx.collections.ObservableList
import javafx.scene.control.ProgressBar
import javafx.scene.control.ProgressIndicator
import javafx.scene.control.TableView
import javafx.scene.control.TextInputControl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.*


object AppManager {

    lateinit var uninstallerTableView: TableView<App>
    lateinit var reinstallerTableView: TableView<App>
    lateinit var disablerTableView: TableView<App>
    lateinit var enablerTableView: TableView<App>
    lateinit var progress: ProgressBar
    lateinit var progressInd: ProgressIndicator
    lateinit var outputTextArea: TextInputControl
    var user = "0"
    val customApps = File(XiaomiADBFastbootTools.dir, "apps.yml")
    private val potentialApps = mutableMapOf<String, String>()

    // Packages the curated list vouches for. Everything else comes straight off the device and
    // has never been checked by anyone, which is what the Vetted column in the tables says.
    private val vettedApps = mutableSetOf<String>()

    init {
        if (!customApps.exists())
            customApps.createNewFile()
    }

    suspend fun readPotentialApps() {
        potentialApps.clear()
        vettedApps.clear()
        potentialApps["android.autoinstalls.config.Xiaomi.${Device.codename}"] = "PAI"
        vettedApps += "android.autoinstalls.config.Xiaomi.${Device.codename}"
        withContext(Dispatchers.IO) {
            // This used to fetch apps.yml from Szaki/XiaomiADBFastbootTools, which no longer
            // exists on GitHub, so every run paid for a failing request before falling back.
            // These names are only labels now: the tables themselves come from the device.
            this::class.java.classLoader.getResource("apps.yml")?.readText()?.trim()?.lines()
                ?.forEach {
                    val entry = it.toAppEntry()
                    potentialApps += entry
                    vettedApps += entry.first
                }
        }
        customApps.forEachLine { potentialApps += it.toAppEntry() }
        potentialApps.remove("")
        vettedApps.remove("")
    }

    private fun String.toAppEntry(): Pair<String, String> {
        val app = split(':', limit = 2)
        val pkg = app[0].trim()
        return pkg to if (app.size == 2 && app[1].isNotBlank()) app[1].trim() else pkg
    }

    suspend fun createTables() {
        val uninstallApps = mutableMapOf<String, MutableList<String>>()
        val reinstallApps = mutableMapOf<String, MutableList<String>>()
        val disableApps = mutableMapOf<String, MutableList<String>>()
        val enableApps = mutableMapOf<String, MutableList<String>>()
        val deviceApps = mutableMapOf<String, String>()
        Command.exec(mutableListOf("adb", "shell", "pm", "list", "packages", "-u", "--user", user)).trim().lines()
            .filter { it.isNotBlank() }
            .forEach {
                deviceApps[it.substringAfter(':').trim()] = "uninstalled"
            }
        Command.exec(mutableListOf("adb", "shell", "pm", "list", "packages", "-d", "--user", user)).trim().lines()
            .filter { it.isNotBlank() }
            .forEach {
                deviceApps[it.substringAfter(':').trim()] = "disabled"
            }
        Command.exec(mutableListOf("adb", "shell", "pm", "list", "packages", "-e", "--user", user)).trim().lines()
            .filter { it.isNotBlank() }
            .forEach {
                deviceApps[it.substringAfter(':').trim()] = "enabled"
            }
        // Walk what the device actually has, not just the curated list: apps.yml is a source
        // of readable names, and anything missing from it shows up under its package name.
        deviceApps.forEach { (pkg, state) ->
            val name = potentialApps[pkg] ?: pkg
            when (state) {
                "disabled" -> {
                    uninstallApps.add(name, pkg)
                    enableApps.add(name, pkg)
                }
                "enabled" -> {
                    uninstallApps.add(name, pkg)
                    disableApps.add(name, pkg)
                }
                "uninstalled" -> reinstallApps.add(name, pkg)
            }
        }
        withContext(Dispatchers.Main) {
            uninstallerTableView.items.setAll(uninstallApps.toSortedMap()
                .map { App(it.key, it.value, isVetted = it.value.all(vettedApps::contains)) })
            reinstallerTableView.items.setAll(reinstallApps.toSortedMap()
                .map { App(it.key, it.value, isVetted = it.value.all(vettedApps::contains)) })
            disablerTableView.items.setAll(disableApps.toSortedMap()
                .map { App(it.key, it.value, isVetted = it.value.all(vettedApps::contains)) })
            enablerTableView.items.setAll(enableApps.toSortedMap()
                .map { App(it.key, it.value, isVetted = it.value.all(vettedApps::contains)) })
            uninstallerTableView.refresh()
            reinstallerTableView.refresh()
            disablerTableView.refresh()
            enablerTableView.refresh()
        }
    }

    suspend fun uninstall(selected: ObservableList<App>, n: Int) {
        withContext(Dispatchers.Main) {
            outputTextArea.text = ""
            progress.progress = 0.0
            progressInd.isVisible = true
        }
        selected.forEach {
            it.packagenameProperty().get().trim().lines().forEach { pkg ->
                val sb = StringBuilder()
                withContext(Dispatchers.IO) {
                    Scanner(
                        startProcess(
                            mutableListOf(
                                "${prefix}adb",
                                "shell",
                                "pm",
                                "uninstall",
                                "--user",
                                user,
                                pkg.trim()
                            )
                        ).inputStream, "UTF-8"
                    ).useDelimiter("").use { scanner ->
                        while (scanner.hasNextLine())
                            sb.append(scanner.nextLine() + '\n')
                    }
                }
                withContext(Dispatchers.Main) {
                    outputTextArea.apply {
                        appendText("App: ${it.appnameProperty().get()}\n")
                        appendText("Package: $pkg\n")
                        appendText("Result: $sb\n")
                    }
                    progress.progress += 1.0 / n
                }
            }
        }
        withContext(Dispatchers.Main) {
            outputTextArea.appendText("Done!")
            progress.progress = 0.0
            progressInd.isVisible = false
            createTables()
        }
    }

    suspend fun reinstall(selected: ObservableList<App>, n: Int) {
        withContext(Dispatchers.Main) {
            outputTextArea.text = ""
            progress.progress = 0.0
            progressInd.isVisible = true
        }
        selected.forEach {
            it.packagenameProperty().get().trim().lines().forEach { pkg ->
                val sb = StringBuilder()
                withContext(Dispatchers.IO) {
                    Scanner(
                        startProcess(
                            mutableListOf(
                                "${prefix}adb",
                                "shell",
                                "cmd",
                                "package",
                                "install-existing",
                                "--user",
                                user,
                                pkg.trim()
                            )
                        ).inputStream, "UTF-8"
                    ).useDelimiter("").use { scanner ->
                        while (scanner.hasNextLine())
                            sb.append(scanner.nextLine() + '\n')
                    }
                }
                var output = sb.toString()
                output = if ("installed for user" in output)
                    "Success\n"
                else "Failure [${output.substringAfter(pkg).trim()}]\n"
                withContext(Dispatchers.Main) {
                    outputTextArea.apply {
                        appendText("App: ${it.appnameProperty().get()}\n")
                        appendText("Package: $pkg\n")
                        appendText("Result: $output\n")
                    }
                    progress.progress += 1.0 / n
                }
            }
        }
        withContext(Dispatchers.Main) {
            outputTextArea.appendText("Done!")
            progress.progress = 0.0
            progressInd.isVisible = false
            createTables()
        }
    }

    suspend fun disable(selected: ObservableList<App>, n: Int) {
        withContext(Dispatchers.Main) {
            outputTextArea.text = ""
            progress.progress = 0.0
            progressInd.isVisible = true
        }
        selected.forEach {
            it.packagenameProperty().get().trim().lines().forEach { pkg ->
                val sb = StringBuilder()
                withContext(Dispatchers.IO) {
                    Scanner(
                        startProcess(
                            mutableListOf(
                                "${prefix}adb",
                                "shell",
                                "pm",
                                "disable-user",
                                "--user",
                                user,
                                pkg.trim()
                            )
                        ).inputStream, "UTF-8"
                    ).useDelimiter("").use { scanner ->
                        while (scanner.hasNextLine())
                            sb.append(scanner.nextLine() + '\n')
                    }
                }
                val output = if ("disabled-user" in sb.toString())
                    "Success\n"
                else "Failure\n"
                withContext(Dispatchers.Main) {
                    outputTextArea.apply {
                        appendText("App: ${it.appnameProperty().get()}\n")
                        appendText("Package: $pkg\n")
                        appendText("Result: $output\n")
                    }
                    progress.progress += 1.0 / n
                }
            }
        }
        withContext(Dispatchers.Main) {
            outputTextArea.appendText("Done!")
            progress.progress = 0.0
            progressInd.isVisible = false
            createTables()
        }
    }

    suspend fun enable(selected: ObservableList<App>, n: Int) {
        withContext(Dispatchers.Main) {
            outputTextArea.text = ""
            progress.progress = 0.0
            progressInd.isVisible = true
        }
        selected.forEach {
            it.packagenameProperty().get().trim().lines().forEach { pkg ->
                val sb = StringBuilder()
                withContext(Dispatchers.IO) {
                    Scanner(
                        startProcess(mutableListOf("${prefix}adb", "shell", "pm", "enable", "--user", user, pkg.trim()))
                            .inputStream, "UTF-8"
                    ).useDelimiter("").use { scanner ->
                        while (scanner.hasNextLine())
                            sb.append(scanner.nextLine() + '\n')
                    }
                }
                val output = if ("enabled" in sb.toString())
                    "Success\n"
                else "Failure\n"
                withContext(Dispatchers.Main) {
                    outputTextArea.apply {
                        appendText("App: ${it.appnameProperty().get()}\n")
                        appendText("Package: $pkg\n")
                        appendText("Result: $output\n")
                    }
                    progress.progress += 1.0 / n
                }
            }
        }
        withContext(Dispatchers.Main) {
            outputTextArea.appendText("Done!")
            progress.progress = 0.0
            progressInd.isVisible = false
            createTables()
        }
    }
}