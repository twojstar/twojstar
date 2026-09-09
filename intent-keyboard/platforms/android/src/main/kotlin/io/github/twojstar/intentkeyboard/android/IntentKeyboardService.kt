package io.github.twojstar.intentkeyboard.android

import android.inputmethodservice.InputMethodService
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import io.github.twojstar.intentkeyboard.CharacterPage
import io.github.twojstar.intentkeyboard.ConservativeLockDetector
import io.github.twojstar.intentkeyboard.PrototypeKeyboardLayout
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.SemanticRenderException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class IntentKeyboardService : InputMethodService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val buffer = StringBuilder()

    private var semanticRuntime: LocalSemanticRuntime? = null
    private var semanticState: LocalSemanticRuntimeState = LocalSemanticRuntimeState.Mechanical

    private var register = Register.NATURAL
    private var characterPage = CharacterPage.LETTERS
    private var uppercase = false
    private var renderedSource = ""
    private var renderedText = ""
    private var renderedCanCommit = true
    private var sensitiveField = false
    private var activeEditorInfo: EditorInfo? = null
    private var renderGeneration = 0L
    private var autoRenderJob: Job? = null
    private var renderJob: Job? = null
    private var hostCompositionOwned = false
    private var hostCompositionConnection: InputConnection? = null
    private var hostCompositionText = ""
    private var hostCompositionMutationInProgress = false

    private var rawView: TextView? = null
    private var previewView: TextView? = null
    private var engineView: TextView? = null
    private var statusView: TextView? = null
    private var modeButton: Button? = null
    private var pageButton: Button? = null
    private var shiftButton: Button? = null
    private var enterButton: Button? = null
    private var keysContainer: LinearLayout? = null

    override fun onCreate() {
        super.onCreate()

        val runtime = LocalSemanticRuntime(applicationContext, scope) { state ->
            semanticState = state
            refreshEngineView()
            if (state is LocalSemanticRuntimeState.Ready) {
                scheduleAutoRender()
            }
        }
        semanticRuntime = runtime
        runtime.start()
    }

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
            view.setPadding(dp(8), dp(4), dp(8), dp(4))
            addView(view, matchWidth())
        }

        engineView = TextView(context).also { view ->
            view.textSize = 11f
            view.gravity = Gravity.END
            view.setPadding(dp(8), 0, dp(8), dp(6))
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
        val mustFinalizePrevious = hostCompositionOwned && (nextSensitive || !restarting)
        val previousFinalized = !mustFinalizePrevious || finishOwnedHostComposition()

        sensitiveField = nextSensitive

        if (nextSensitive || !restarting) {
            clearInternalBuffer()
        } else {
            refreshViews()
            scheduleAutoRender()
        }

        when {
            nextSensitive -> {
                statusView?.text = "Sensitive field: semantic buffering disabled."
            }
            !previousFinalized -> {
                statusView?.text = "Previous draft could not be finalized; host mirror paused."
            }
        }
    }

    override fun onFinishInput() {
        val finalized = finishOwnedHostComposition()
        clearInternalBuffer()
        if (!finalized) {
            statusView?.text = "Draft finalization failed; host composition ownership retained."
        }
        sensitiveField = false
        activeEditorInfo = null
        super.onFinishInput()
    }

    override fun onUpdateSelection(
        oldSelStart: Int,
        oldSelEnd: Int,
        newSelStart: Int,
        newSelEnd: Int,
        candidatesStart: Int,
        candidatesEnd: Int,
    ) {
        super.onUpdateSelection(
            oldSelStart,
            oldSelEnd,
            newSelStart,
            newSelEnd,
            candidatesStart,
            candidatesEnd,
        )

        if (
            hostCompositionMutationInProgress ||
            !ownsCurrentHostComposition() ||
            sensitiveField ||
            buffer.isEmpty()
        ) {
            return
        }

        if (candidatesStart < 0 || candidatesEnd < 0) {
            resetHostCompositionTracking()
            clearInternalBuffer()
            statusView?.text = "Draft finalized by the app."
            return
        }

        val compositionEnd = maxOf(candidatesStart, candidatesEnd)
        if (newSelStart != compositionEnd || newSelEnd != compositionEnd) {
            if (finishOwnedHostComposition()) {
                clearInternalBuffer()
                statusView?.text = "Draft finalized after cursor move."
            } else {
                statusView?.text = "Could not finalize draft after cursor move."
            }
        }
    }

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onDestroy() {
        autoRenderJob?.cancel()
        renderJob?.cancel()
        semanticRuntime?.close()
        semanticRuntime = null
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
        syncHostComposition(buffer.toString())
        refreshViews()
        scheduleAutoRender()
    }

    private fun backspace() {
        if (sensitiveField || buffer.isEmpty()) {
            deleteHostSelectionOrPreviousCodePoint()
            return
        }

        buffer.deleteCharAt(buffer.lastIndex)
        invalidateRenderedPreview()
        syncHostComposition(buffer.toString())
        refreshViews()
        scheduleAutoRender()
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

    private fun scheduleAutoRender() {
        autoRenderJob?.cancel()
        autoRenderJob = null

        if (sensitiveField) return
        if (register == Register.RAW) {
            clearTransientRenderStatus()
            return
        }

        val raw = buffer.toString()
        if (raw.isBlank()) {
            clearTransientRenderStatus()
            return
        }

        val generation = renderGeneration
        statusView?.text = STATUS_PREVIEW_PENDING
        autoRenderJob = scope.launch {
            delay(AUTO_RENDER_DEBOUNCE_MS)
            if (
                generation != renderGeneration ||
                sensitiveField ||
                raw != buffer.toString() ||
                register == Register.RAW
            ) {
                return@launch
            }

            renderBuffer(fromAutoPreview = true)
        }
    }

    private fun renderBuffer(fromAutoPreview: Boolean = false) {
        if (!fromAutoPreview) {
            autoRenderJob?.cancel()
            autoRenderJob = null
        }

        if (sensitiveField) {
            statusView?.text = "Semantic rendering is disabled for sensitive fields."
            return
        }

        val raw = buffer.toString()
        if (raw.isBlank()) return

        val runtime = semanticRuntime
        if (runtime == null) {
            statusView?.text = "Semantic runtime unavailable."
            return
        }

        renderJob?.cancel()
        val requestedRegister = register
        val generation = ++renderGeneration
        statusView?.text = STATUS_RENDERING

        renderJob = scope.launch {
            try {
                val result = runtime.render(
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

                val hostText = if (result.canCommit && requestedRegister != Register.RAW) {
                    result.text
                } else {
                    raw
                }
                val hostMirrored = syncHostComposition(hostText)

                statusView?.text = when {
                    !result.canCommit -> {
                        val locked = result.violatedLocks.joinToString { it.value }
                        "Commit blocked: protected value changed ($locked)."
                    }
                    !hostMirrored -> "Preview ready; host composing text is unavailable."
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

        if (raw.isBlank()) {
            return commitOutput(raw)
        }

        val hasCurrentPreview = renderedSource == raw && renderedText.isNotBlank()
        if (register != Register.RAW && !hasCurrentPreview) {
            if (autoRenderJob?.isActive != true && renderJob?.isActive != true) {
                scheduleAutoRender()
            }
            statusView?.text = "Preview is not ready yet. Wait, press Render, or switch to Raw."
            return false
        }

        if (hasCurrentPreview && !renderedCanCommit) {
            statusView?.text = "Commit blocked until protected values are preserved."
            return false
        }

        val output = if (register == Register.RAW) raw else renderedText
        return commitOutput(output)
    }

    private fun commitOutput(output: String): Boolean {
        val connection = currentInputConnection
        if (connection == null) {
            statusView?.text = STATUS_COMMIT_FAILED
            return false
        }

        if (ownsCurrentHostComposition(connection)) {
            if (hostCompositionText != output && !syncHostComposition(output)) {
                statusView?.text = STATUS_COMMIT_FAILED
                return false
            }

            if (!finishOwnedHostComposition()) {
                statusView?.text = STATUS_COMMIT_FAILED
                return false
            }
        } else if (!connection.commitText(output, 1)) {
            statusView?.text = STATUS_COMMIT_FAILED
            return false
        }

        clearInternalBuffer()
        statusView?.text = "Committed."
        return true
    }

    private fun syncHostComposition(text: String): Boolean {
        if (sensitiveField) return false

        val connection = currentInputConnection ?: return false
        if (hostCompositionOwned && hostCompositionConnection !== connection) {
            if (!finishOwnedHostComposition()) return false
        }

        hostCompositionMutationInProgress = true
        return try {
            val updated = connection.setComposingText(text, 1)
            if (updated) {
                if (text.isEmpty()) {
                    resetHostCompositionTracking()
                } else {
                    hostCompositionOwned = true
                    hostCompositionConnection = connection
                    hostCompositionText = text
                }
            } else if (hostCompositionConnection === connection) {
                resetHostCompositionTracking()
            }
            updated
        } finally {
            hostCompositionMutationInProgress = false
        }
    }

    private fun ownsCurrentHostComposition(
        connection: InputConnection? = currentInputConnection,
    ): Boolean =
        hostCompositionOwned && hostCompositionConnection != null && hostCompositionConnection === connection

    private fun finishOwnedHostComposition(): Boolean {
        if (!hostCompositionOwned) return true

        val connection = hostCompositionConnection ?: return false
        hostCompositionMutationInProgress = true
        return try {
            val finished = connection.finishComposingText()
            if (finished) {
                resetHostCompositionTracking()
            }
            finished
        } finally {
            hostCompositionMutationInProgress = false
        }
    }

    private fun resetHostCompositionTracking() {
        hostCompositionOwned = false
        hostCompositionConnection = null
        hostCompositionText = ""
    }

    private fun cycleRegister() {
        register = when (register) {
            Register.RAW -> Register.NATURAL
            Register.NATURAL -> Register.CIVILIZED
            Register.CIVILIZED -> Register.RAW
        }
        invalidateRenderedPreview()
        syncHostComposition(buffer.toString())
        refreshViews()
        scheduleAutoRender()
    }

    private fun invalidateRenderedPreview() {
        autoRenderJob?.cancel()
        autoRenderJob = null
        renderJob?.cancel()
        renderJob = null
        renderGeneration += 1
        renderedSource = ""
        renderedText = ""
        renderedCanCommit = true
    }

    private fun clearTransientRenderStatus() {
        val status = statusView?.text?.toString() ?: return
        if (status == STATUS_PREVIEW_PENDING || status == STATUS_RENDERING) {
            statusView?.text = ""
        }
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
        refreshEngineView()

        if (!sensitiveField && statusView?.text?.startsWith("Sensitive field") == true) {
            statusView?.text = ""
        }
    }

    private fun refreshEngineView() {
        engineView?.text = when (val state = semanticState) {
            LocalSemanticRuntimeState.Mechanical -> "engine: Mechanical"
            is LocalSemanticRuntimeState.Loading -> "engine: Loading ${compactName(state.displayName)}…"
            is LocalSemanticRuntimeState.Ready -> "engine: Local · ${compactName(state.displayName)}"
            is LocalSemanticRuntimeState.Failed -> "engine: Mechanical · ${state.message}"
        }
    }

    private fun compactName(name: String): String =
        if (name.length <= 42) name else "${name.take(39)}…"

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

    private companion object {
        const val AUTO_RENDER_DEBOUNCE_MS = 450L
        const val STATUS_PREVIEW_PENDING = "Preview updates after a short pause…"
        const val STATUS_RENDERING = "Rendering…"
        const val STATUS_COMMIT_FAILED = "Commit failed. Draft preserved."
    }
}