package io.github.twojstar.intentkeyboard.android

import io.github.twojstar.intentkeyboard.android.HostCompositionPolicy.SelectionAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostCompositionPolicyTest {
    @Test
    fun finalizesOwnedCompositionForNewOrSensitiveEditors() {
        assertFalse(
            HostCompositionPolicy.shouldFinalizeBeforeStart(
                hostCompositionOwned = false,
                nextFieldSensitive = false,
                restarting = false,
            ),
        )
        assertFalse(
            HostCompositionPolicy.shouldFinalizeBeforeStart(
                hostCompositionOwned = true,
                nextFieldSensitive = false,
                restarting = true,
            ),
        )
        assertTrue(
            HostCompositionPolicy.shouldFinalizeBeforeStart(
                hostCompositionOwned = true,
                nextFieldSensitive = false,
                restarting = false,
            ),
        )
        assertTrue(
            HostCompositionPolicy.shouldFinalizeBeforeStart(
                hostCompositionOwned = true,
                nextFieldSensitive = true,
                restarting = true,
            ),
        )
    }

    @Test
    fun ignoresSelectionCallbacksWhenCompositionIsNotActionable() {
        val base = SelectionInput()

        assertEquals(
            SelectionAction.IGNORE,
            action(base.copy(mutationInProgress = true)),
        )
        assertEquals(
            SelectionAction.IGNORE,
            action(base.copy(ownsCurrentComposition = false)),
        )
        assertEquals(
            SelectionAction.IGNORE,
            action(base.copy(sensitiveField = true)),
        )
        assertEquals(
            SelectionAction.IGNORE,
            action(base.copy(hasDraft = false)),
        )
    }

    @Test
    fun missingCandidateRegionMeansHostFinalizedComposition() {
        val base = SelectionInput()

        assertEquals(
            SelectionAction.HOST_FINALIZED,
            action(base.copy(candidatesStart = -1, candidatesEnd = -1)),
        )
        assertEquals(
            SelectionAction.HOST_FINALIZED,
            action(base.copy(candidatesStart = 2, candidatesEnd = -1)),
        )
    }

    @Test
    fun caretAtCompositionEndKeepsOwnership() {
        assertEquals(
            SelectionAction.IGNORE,
            action(
                SelectionInput(
                    candidatesStart = 4,
                    candidatesEnd = 9,
                    newSelectionStart = 9,
                    newSelectionEnd = 9,
                ),
            ),
        )
        assertEquals(
            SelectionAction.IGNORE,
            action(
                SelectionInput(
                    candidatesStart = 9,
                    candidatesEnd = 4,
                    newSelectionStart = 9,
                    newSelectionEnd = 9,
                ),
            ),
        )
    }

    @Test
    fun movedCaretOrSelectionFinalizesOwnedComposition() {
        assertEquals(
            SelectionAction.FINALIZE_AFTER_CURSOR_MOVE,
            action(
                SelectionInput(
                    candidatesStart = 4,
                    candidatesEnd = 9,
                    newSelectionStart = 8,
                    newSelectionEnd = 8,
                ),
            ),
        )
        assertEquals(
            SelectionAction.FINALIZE_AFTER_CURSOR_MOVE,
            action(
                SelectionInput(
                    candidatesStart = 4,
                    candidatesEnd = 9,
                    newSelectionStart = 9,
                    newSelectionEnd = 10,
                ),
            ),
        )
    }

    private fun action(input: SelectionInput): SelectionAction =
        HostCompositionPolicy.selectionAction(
            mutationInProgress = input.mutationInProgress,
            ownsCurrentComposition = input.ownsCurrentComposition,
            sensitiveField = input.sensitiveField,
            hasDraft = input.hasDraft,
            candidatesStart = input.candidatesStart,
            candidatesEnd = input.candidatesEnd,
            newSelectionStart = input.newSelectionStart,
            newSelectionEnd = input.newSelectionEnd,
        )

    private data class SelectionInput(
        val mutationInProgress: Boolean = false,
        val ownsCurrentComposition: Boolean = true,
        val sensitiveField: Boolean = false,
        val hasDraft: Boolean = true,
        val candidatesStart: Int = 4,
        val candidatesEnd: Int = 9,
        val newSelectionStart: Int = 9,
        val newSelectionEnd: Int = 9,
    )
}
