package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.Register
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JFrame
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.SwingUtilities
import javax.swing.WindowConstants
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private class DesktopIntentWindow(
    private val session: DesktopIntentSession = DesktopIntentSession(),
    private val textSink: DesktopTextSink = SystemClipboardTextSink(),
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var renderJob: Job? = null

    private val frame = JFrame("Intent Keyboard")
    private val rawArea = JTextArea(8, 64)
    private val previewArea = JTextArea(8, 64)
    private val registerBox = JComboBox(Register.entries.toTypedArray())
    private val revertButton = JButton("Revert")
    private val copyButton = JButton("Copy")
    private val statusLabel = JLabel("Type an intent, render it, then copy the safe output.")

    fun show() {
        rawArea.lineWrap = true
        rawArea.wrapStyleWord = true
        rawArea.font = Font(Font.SANS_SERIF, Font.PLAIN, 16)

        previewArea.isEditable = false
        previewArea.lineWrap = true
        previewArea.wrapStyleWord = true
        previewArea.font = Font(Font.SANS_SERIF, Font.PLAIN, 16)

        registerBox.selectedItem = Register.NATURAL
        registerBox.addActionListener {
            val selected = registerBox.selectedItem as? Register ?: return@addActionListener
            renderJob?.cancel()
            applyState(session.setRegister(selected))
            statusLabel.text = "Register changed. Render a fresh preview before copying."
        }

        rawArea.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(event: DocumentEvent) = draftChanged()
            override fun removeUpdate(event: DocumentEvent) = draftChanged()
            override fun changedUpdate(event: DocumentEvent) = draftChanged()
        })

        val renderButton = JButton("Render").apply {
            addActionListener { renderCurrentDraft() }
        }
        revertButton.addActionListener {
            renderJob?.cancel()
            val before = session.currentState()
            val state = session.revert()
            applyState(state)
            statusLabel.text = if (before.previewText != null) {
                "Reverted to the raw draft."
            } else {
                "No current preview to revert."
            }
        }
        copyButton.addActionListener { copyCurrentOutput() }

        val controls = JPanel(FlowLayout(FlowLayout.LEFT)).apply {
            add(JLabel("Register:"))
            add(registerBox)
            add(renderButton)
            add(revertButton)
            add(copyButton)
        }

        val content = JPanel(BorderLayout(8, 8)).apply {
            border = BorderFactory.createEmptyBorder(12, 12, 12, 12)
            add(JPanel(BorderLayout(4, 4)).apply {
                add(JLabel("Raw intent"), BorderLayout.NORTH)
                add(JScrollPane(rawArea), BorderLayout.CENTER)
            }, BorderLayout.NORTH)
            add(JPanel(BorderLayout(4, 4)).apply {
                add(JLabel("Preview"), BorderLayout.NORTH)
                add(JScrollPane(previewArea), BorderLayout.CENTER)
            }, BorderLayout.CENTER)
            add(JPanel(BorderLayout()).apply {
                add(controls, BorderLayout.NORTH)
                add(statusLabel, BorderLayout.SOUTH)
            }, BorderLayout.SOUTH)
        }

        frame.defaultCloseOperation = WindowConstants.DO_NOTHING_ON_CLOSE
        frame.addWindowListener(object : WindowAdapter() {
            override fun windowClosing(event: WindowEvent) {
                renderJob?.cancel()
                scope.cancel()
                frame.dispose()
            }
        })
        frame.contentPane = content
        frame.minimumSize = Dimension(640, 460)
        frame.pack()
        frame.setLocationRelativeTo(null)
        applyState(session.currentState())
        frame.isVisible = true
    }

    private fun draftChanged() {
        renderJob?.cancel()
        applyState(session.updateRawIntent(rawArea.text))
        statusLabel.text = "Draft changed. Render a fresh preview before copying."
    }

    private fun renderCurrentDraft() {
        renderJob?.cancel()
        statusLabel.text = "Rendering…"
        renderJob = scope.launch {
            try {
                val state = session.render()
                SwingUtilities.invokeLater {
                    applyState(state)
                    statusLabel.text = when {
                        state.previewText == null -> "Draft changed before rendering completed."
                        state.warnings.isNotEmpty() -> state.warnings.joinToString(" · ")
                        state.canCopy -> "Preview ready to copy."
                        else -> "Preview is not safe to copy."
                    }
                }
            } catch (_: CancellationException) {
                // A newer edit or render owns the UI now.
            } catch (error: Exception) {
                SwingUtilities.invokeLater {
                    statusLabel.text = "Render failed: ${error.message ?: "renderer error"}"
                }
            }
        }
    }

    private fun copyCurrentOutput() {
        val output = session.copyTextOrNull()
        if (output == null) {
            statusLabel.text = "Nothing safe and current is ready to copy."
            return
        }

        statusLabel.text = if (textSink.publish(output)) {
            "Copied. Paste it into the target app when ready."
        } else {
            "Clipboard is unavailable. The draft was kept."
        }
    }

    private fun applyState(state: DesktopIntentState) {
        previewArea.text = state.previewText.orEmpty()
        revertButton.isEnabled = state.previewText != null
        copyButton.isEnabled = state.canCopy
    }
}

fun main() {
    SwingUtilities.invokeLater {
        DesktopIntentWindow().show()
    }
}
