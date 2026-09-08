package io.github.twojstar.intentkeyboard.android

import android.inputmethodservice.InputMethodService
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import io.github.twojstar.intentkeyboard.ConservativeLockDetector
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.SemanticPipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class IntentKeyboardService : InputMethodService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val pipeline = SemanticPipeline(MechanicalRenderer())
    private val buffer = StringBuilder()

    private var register = Register.NATURAL
    private var renderedSource = ""
    private var renderedText = ""
    private var sensitiveField = false

    private var rawView: TextView? = null
    private var previewView: TextView? = null
    private var statusView: TextView? = null
    private var modeButton: Button? = null

    override fun onCreateInputView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(6), dp(6), dp(6), dp(8))

        rawView = TextView(context).also { view ->
            view.textSize = 14f
            view.setPadding(dp(8), dp(4), dp(8), dp(4))
            addView(view, matchWidth())
        }

        previewView = TextView(context).also { view ->
            view.textSize = 16f
            view.setPadding(dp(8), dp(4), dp(8), dp(8))
            addView(view, matchWidth())
        }

        addView(toolbar())
        addView(keyRow("qwertyuiop"))
        addView(keyRow("asdfghjkl"))
        addView(keyRow("zxcvbnm"))
        addView(bottomRow())

        statusView = TextView(context).also { view ->
            view.textSize = 12f
            view.gravity = Gravity.CENTER_HORIZONTAL
            view.setPadding(dp(8), dp(4), dp(8), 0)
            addView(view, matchWidth())
        }

        refreshViews()
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        sensitiveField = isSensitive(attribute)
        clearInternalBuffer()
        if (sensitiveField) {
            statusView?.text = "Sensitive field: semantic buffering disabled."
        }
    }

    override fun onFinishInput() {
        clearInternalBuffer()
        sensitiveField = false
        super.onFinishInput()
    }

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun toolbar(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL

        modeButton = Button(context).also { button ->
            button.isAllCaps = false
            button.setOnClickListener { cycleRegister() }
            addView(button, weighted())
        }

        addView(Button(context).apply {
            text = "Render"
            isAllCaps = false
            setOnClickListener { renderBuffer() }
        }, weighted())

        addView(Button(context).apply {
            text = "Commit"
            isAllCaps = false
            setOnClickListener { commitBuffer() }
        }, weighted())
    }

    private fun keyRow(keys: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        keys.forEach { key ->
            addView(keyButton(key.toString()) { append(key.toString()) }, weighted(dp(46)))
        }
    }

    private fun bottomRow(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(keyButton("🌐") { switchToNextInputMethod(false) }, weighted(dp(46)))
        addView(keyButton(",") { append(",") }, weighted(dp(46)))
        addView(keyButton("space") { append(" ") }, weighted(dp(46), 3f))
        addView(keyButton(".") { append(".") }, weighted(dp(46)))
        addView(keyButton("⌫") { backspace() }, weighted(dp(46)))
        addView(keyButton("↵") { append("\n") }, weighted(dp(46)))
    }

    private fun keyButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        minWidth = 0
        setPadding(0, 0, 0, 0)
        setOnClickListener { action() }
    }

    private fun append(text: String) {
        if (sensitiveField) {
            currentInputConnection?.commitText(text, 1)
            return
        }

        buffer.append(text)
        invalidateRenderedPreview()
        refreshViews()
    }

    private fun backspace() {
        if (sensitiveField || buffer.isEmpty()) {
            currentInputConnection?.deleteSurroundingText(1, 0)
            return
        }

        buffer.deleteCharAt(buffer.lastIndex)
        invalidateRenderedPreview()
        refreshViews()
    }

    private fun renderBuffer() {
        if (sensitiveField) {
            statusView?.text = "Semantic rendering is disabled for sensitive fields."
            return
        }

        val raw = buffer.toString()
        if (raw.isBlank()) return

        statusView?.text = "Rendering…"
        scope.launch {
            runCatching {
                pipeline.render(
                    RenderRequest(
                        rawIntent = raw,
                        register = register,
                        locks = ConservativeLockDetector.detect(raw),
                    ),
                )
            }.onSuccess { result ->
                renderedSource = raw
                renderedText = result.text
                previewView?.text = "preview: ${result.text}"
                statusView?.text = result.warnings.joinToString(" · ").ifBlank { "Ready to commit." }
            }.onFailure { error ->
                statusView?.text = "Render failed: ${error.message ?: error::class.simpleName}"
            }
        }
    }

    private fun commitBuffer() {
        if (sensitiveField) return

        val raw = buffer.toString()
        if (raw.isEmpty()) return

        val output = if (renderedSource == raw && renderedText.isNotBlank()) {
            renderedText
        } else {
            raw
        }

        currentInputConnection?.commitText(output, 1)
        clearInternalBuffer()
        statusView?.text = "Committed."
    }

    private fun cycleRegister() {
        register = when (register) {
            Register.RAW -> Register.NATURAL
            Register.NATURAL -> Register.CIVILIZED
            Register.CIVILIZED -> Register.RAW
        }
        invalidateRenderedPreview()
        refreshViews()
    }

    private fun invalidateRenderedPreview() {
        renderedSource = ""
        renderedText = ""
    }

    private fun clearInternalBuffer() {
        buffer.clear()
        invalidateRenderedPreview()
        refreshViews()
    }

    private fun refreshViews() {
        rawView?.text = if (buffer.isEmpty()) "intent: …" else "intent: $buffer"
        previewView?.text = if (renderedText.isEmpty()) "preview: …" else "preview: $renderedText"
        modeButton?.text = register.name.lowercase().replaceFirstChar { it.titlecase() }
        if (!sensitiveField && statusView?.text?.startsWith("Sensitive field") == true) {
            statusView?.text = ""
        }
    }

    private fun isSensitive(info: EditorInfo?): Boolean {
        val inputType = info?.inputType ?: return false
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION

        return when (inputClass) {
            InputType.TYPE_CLASS_TEXT -> variation in setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
            )
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun weighted(height: Int = dp(44), weight: Float = 1f) = LinearLayout.LayoutParams(
        0,
        height,
        weight,
    )

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
