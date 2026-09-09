package io.github.twojstar.intentkeyboard.desktop

import java.awt.Toolkit
import java.awt.datatransfer.StringSelection

fun interface DesktopTextSink {
    fun publish(text: String): Boolean
}

/** Explicit user-driven output boundary for the first desktop proof. */
class SystemClipboardTextSink : DesktopTextSink {
    override fun publish(text: String): Boolean = runCatching {
        Toolkit.getDefaultToolkit()
            .systemClipboard
            .setContents(StringSelection(text), null)
        true
    }.getOrDefault(false)
}
