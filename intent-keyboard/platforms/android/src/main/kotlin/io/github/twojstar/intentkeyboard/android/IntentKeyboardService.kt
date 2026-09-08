package io.github.twojstar.intentkeyboard.android

import android.inputmethodservice.InputMethodService
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import io.github.twojstar.intentkeyboard.CharacterPage
import io.github.twojstar.intentkeyboard.ConservativeLockDetector
import io.github.twojstar.intentkeyboard.MechanicalRenderer
import io.github.twojstar.intentkeyboard.PrototypeKeyboardLayout
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.SemanticPipeline
import io.github.twojstar.intentkeyboard.SemanticRenderException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class IntentKeyboardService : InputMethodService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val pipeline = SemanticPipeline(MechanicalRenderer())
    private val buffer = StringBuilder()

    private var register = Register.NATURAL
    private var characterPage = CharacterPage.LETTERS
    private var uppercase = false
    private var renderedSource = ""
    private var renderedText = ""
    private var renderedCanCommit = true
    private var sensitiveField = false
    private var activeEditorInfo: EditorInfo? = null
    private var renderGeneration = 0L
    private var renderJob: Job? = null

    private var rawView: TextView? = null
    private var previewView: TextView? = null
    private var statusView: TextView? = null
    private var modeButton: Button? = null
    private var pageButton: Button? = null
    private var shiftButton: Button? = null
    private var enterButton: Button? = null
    private var keysContainer: LinearLayout? = null

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

        keysContainer = LinearLayout(context).also { container ->
            container.orientation = LinearLayout.VERTICAL
            addView(container, matchWidth())
        }
        rebuildCharacterRows()

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

        activeEditorInfo = attribute
        val nextSensitive = isSensitive(attribute)
        sensitiveField = nextSensitive

        if (nextSensitive || !restarting) {
            clearInternalBuffer()
        } else {
            refreshViews()
        }

        if (nextSensitive) {
            statusView?.text = "Sensitive field: semantic buffering disabled."
        }
    }

    override fun onFinishInput() {
        clearInternalBuffer()
        sensitiveField = false
        activeEditorInfo = null
        super.onFinishInput()
    }

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onDestroy() {
        renderJob?.cancel()
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

    private fun rebuildCharacterRows() {
        val container = keysContainer ?: return
        container.removeAllViews()

        PrototypeKeyboardLayout.layout(characterPage, uppercase).rows.forEach { row ->
            container.addView(keyRow(row), matchWidth())
        }

        pageButton?.text = if (characterPage == CharacterPage.LETTERS) "123" else "ABC"
        shiftButton?.isEnabled = characterPage == CharacterPage.LETTERS
        shiftButton?.text = if (uppercase) "⇧ ON" else "⇧"
    }

    private fun keyRow(keys: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        keys.forEach { key ->
            addView(keyButton(key.toString()) { append(key.toString()) }, weighted(dp(42)))
        }
    }

    private fun bottomRow(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL

        addView(keyButton("🌐") { switchToNextInputMethod(false) }, weighted(dp(44)))

        pageButton = keyButton("123") { toggleCharacterPage() }.also { button ->
            addView(button, weighted(dp(44)))
        }

        shiftButton = keyButton("⇧") { toggleUppercase() }.also { button ->
            addView(button, weighted(dp(44)))
        }

        addView(keyButton(",") { append(",") }, weighted(dp(44)))
        addView(keyButton("space") { append(" ") }, weighted(dp(44), 3f))
        addView(keyButton(".") { append(".") }, weighted(dp(44)))
        addView(keyButton("⌫") { backspace() }, weighted(dp(44)))

        enterButton = keyButton("↵") { handleEnter() }.also { button ->
            addView(button, weighted(dp(44)))
        }

        rebuildCharacterRows()
    }

    private fun keyButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        minWidth = 0
        setPadding(0, 0, 0, 0)
        setOnClickListener { action() }
    }

    private fun toggleCharacterPage() {
        characterPage = when (characterPage) {
            CharacterPage.LETTERS -> CharacterPage.NUMBERS
            CharacterPage.NUMBERS -> CharacterPage.LETTERS
        }
        if (characterPage == CharacterPage.NUMBERS) uppercase = false
        rebuildCharacterRows()
    }

    private fun toggleUppercase() {
        if (characterPage != CharacterPage.LETTERS) return
        uppercase = !uppercase
        rebuildCharacterRows()
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
            deleteHostSelectionOrPreviousCodePoint()
            return
        }

        buffer.deleteCharAt(buffer.lastIndex)
        invalidateRenderedPreview()
        refreshViews()
    }

    private fun deleteHostSelectionOrPreviousCodePoint() {
        val connection = currentInputConnection ?: return
        val selected = connection.getSelectedText(0)

        if (selected != null && selected.isNotEmpty()) {
            connection.commitText("", 1)
        } else {
            connection.deleteSurroundingTextInCodePoints(1, 0)
        }
    }

    private fun handleEnter() {
        val action = editorAction(activeEditorInfo)
        if (action != null) {
            if (!commitBuffer()) return

            val connection = currentInputConnection ?: return
            if (connection.performEditorAction(action)) return

            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
            return
        }

        if (supportsMultiline(activeEditorInfo)) {
            append("\n")
            return
        }

        if (!commitBuffer()) return

        val connection = currentInputConnection ?: return
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
        connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    }

    private fun renderBuffer() {
        if (sensitiveField) {
            statusView?.text = "Semantic rendering is disabled for sensitive fields."
            return
        }

        val raw = buffer.toString()
        if (raw.isBlank()) return

        renderJob?.cancel()
        val requestedRegister = register
        val generation = ++renderGeneration
        statusView?.text = "Rendering…"

        renderJob = scope.launch {
            try {
                val result = pipeline.render(
                    RenderRequest(
                        rawIntent = raw,
                        register = requestedRegister,
                        locks = ConservativeLockDetector.detect(raw),
                    ),
                )

                if (
                    generation != renderGeneration ||
                    raw != buffer.toString() ||
                    requestedRegister != register
                ) {
                    return@launch
                }

                renderedSource = raw
                renderedText = result.text
                renderedCanCommit = result.canCommit
                previewView?.text = "preview: ${result.text}"

                statusView?.text = when {
                    !result.canCommit -> {
                        val locked = result.violatedLocks.joinToString { it.value }
                        "Commit blocked: protected value changed ($locked)."
                    }
                    result.warnings.isNotEmpty() -> result.warnings.joinToString(" · ")
                    else -> "Ready to commit."
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: SemanticRenderException) {
                if (generation == renderGeneration) {
                    statusView?.text = "Render failed: ${error.message ?: "renderer error"}"
                }
            }
        }
    }

    private fun commitBuffer(): Boolean {
        if (sensitiveField) return true

        val raw = buffer.toString()
        if (raw.isEmpty()) return true

        val hasCurrentPreview = renderedSource == raw && renderedText.isNotBlank()
        if (hasCurrentPreview && !renderedCanCommit) {
            statusView?.text = "Commit blocked until protected values are preserved."
            return false
        }

        val output = if (hasCurrentPreview) renderedText else raw
        val connection = currentInputConnection
        if (connection == null || !connection.commitText(output, 1)) {
            statusView?.text = "Commit failed. Draft preserved."
            return false
        }

        clearInternalBuffer()
        statusView?.text = "Committed."
        return true
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
        renderJob?.cancel()
        renderJob = null
        renderGeneration += 1
        renderedSource = ""
        renderedText = ""
        renderedCanCommit = true
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
        pageButton?.text = if (characterPage == CharacterPage.LETTERS) "123" else "ABC"
        shiftButton?.isEnabled = characterPage == CharacterPage.LETTERS
        shiftButton?.text = if (uppercase) "⇧ ON" else "⇧"
        enterButton?.text = enterLabel(activeEditorInfo)

        if (!sensitiveField && statusView?.text?.startsWith("Sensitive field") == true) {
            statusView?.text = ""
        }
    }

    private fun supportsMultiline(info: EditorInfo?): Boolean {
        val inputType = info?.inputType ?: return false
        if (inputType and InputType.TYPE_MASK_CLASS != InputType.TYPE_CLASS_TEXT) return false

        val multilineFlags = InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_IME_MULTI_LINE
        return inputType and multilineFlags != 0
    }

    private fun editorAction(info: EditorInfo?): Int? {
        info ?: return null
        if (info.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION != 0) return null

        return when (val action = info.imeOptions and EditorInfo.IME_MASK_ACTION) {
            EditorInfo.IME_ACTION_GO,
            EditorInfo.IME_ACTION_SEARCH,
            EditorInfo.IME_ACTION_SEND,
            EditorInfo.IME_ACTION_NEXT,
            EditorInfo.IME_ACTION_DONE,
            EditorInfo.IME_ACTION_PREVIOUS,
            -> action
            else -> null
        }
    }

    private fun enterLabel(info: EditorInfo?): String = when (editorAction(info)) {
        EditorInfo.IME_ACTION_GO -> "Go"
        EditorInfo.IME_ACTION_SEARCH -> "Search"
        EditorInfo.IME_ACTION_SEND -> "Send"
        EditorInfo.IME_ACTION_NEXT -> "Next"
        EditorInfo.IME_ACTION_DONE -> "Done"
        EditorInfo.IME_ACTION_PREVIOUS -> "Prev"
        else -> "↵"
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
