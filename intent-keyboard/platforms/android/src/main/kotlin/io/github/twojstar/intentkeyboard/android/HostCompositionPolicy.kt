package io.github.twojstar.intentkeyboard.android

/** Pure decisions around whether the Android IME still owns a host composing region. */
internal object HostCompositionPolicy {
    enum class SelectionAction {
        IGNORE,
        HOST_FINALIZED,
        FINALIZE_AFTER_CURSOR_MOVE,
    }

    fun shouldFinalizeBeforeStart(
        hostCompositionOwned: Boolean,
        nextFieldSensitive: Boolean,
        restarting: Boolean,
    ): Boolean = hostCompositionOwned && (nextFieldSensitive || !restarting)

    fun selectionAction(
        mutationInProgress: Boolean,
        ownsCurrentComposition: Boolean,
        sensitiveField: Boolean,
        hasDraft: Boolean,
        candidatesStart: Int,
        candidatesEnd: Int,
        newSelectionStart: Int,
        newSelectionEnd: Int,
    ): SelectionAction {
        if (
            mutationInProgress ||
            !ownsCurrentComposition ||
            sensitiveField ||
            !hasDraft
        ) {
            return SelectionAction.IGNORE
        }

        if (candidatesStart < 0 || candidatesEnd < 0) {
            return SelectionAction.HOST_FINALIZED
        }

        val compositionEnd = maxOf(candidatesStart, candidatesEnd)
        return if (
            newSelectionStart == compositionEnd &&
            newSelectionEnd == compositionEnd
        ) {
            SelectionAction.IGNORE
        } else {
            SelectionAction.FINALIZE_AFTER_CURSOR_MOVE
        }
    }
}
