package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.RendererOutcome
import io.github.twojstar.intentkeyboard.SemanticRenderer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield

class DesktopIntentSessionTest {
    @Test
    fun renderedPreviewBecomesCopyableAndEditInvalidatesIt() = runBlocking {
        val session = DesktopIntentSession()
        session.updateRawIntent("  jutro   18:30  ")

        val rendered = session.render()
        assertEquals("Jutro 18:30.", rendered.previewText)
        assertTrue(rendered.canCopy)
        assertEquals("Jutro 18:30.", session.copyTextOrNull())

        val edited = session.updateRawIntent("jutro 18:30 rano")
        assertNull(edited.previewText)
        assertFalse(edited.canCopy)
        assertNull(session.copyTextOrNull())
    }

    @Test
    fun revertKeepsRawDraftAndRegisterButDropsPreview() = runBlocking {
        val session = DesktopIntentSession()
        session.updateRawIntent("hej tam")
        session.setRegister(Register.CIVILIZED)
        session.render()

        val reverted = session.revert()
        assertEquals("hej tam", reverted.rawIntent)
        assertEquals(Register.CIVILIZED, reverted.register)
        assertNull(reverted.previewText)
        assertFalse(reverted.canCopy)
    }

    @Test
    fun rawRegisterCanCopyWithoutRendering() {
        val session = DesktopIntentSession()
        session.updateRawIntent("  raw text  ")
        val state = session.setRegister(Register.RAW)

        assertTrue(state.canCopy)
        assertEquals("  raw text  ", session.copyTextOrNull())
    }

    @Test
    fun lockViolationBlocksCopy() = runBlocking {
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: io.github.twojstar.intentkeyboard.RenderRequest) =
                RendererOutcome.Success(RenderResult("Spotkanie o 19:00."))
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("spotkanie o 18:30")

        val state = session.render()
        assertEquals("Spotkanie o 19:00.", state.previewText)
        assertFalse(state.canCopy)
        assertNull(session.copyTextOrNull())
        assertTrue(state.warnings.any { "18:30" in it })
    }

    @Test
    fun lateRenderDoesNotOverwriteNewerDraft() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: io.github.twojstar.intentkeyboard.RenderRequest): RendererOutcome {
                gate.await()
                return RendererOutcome.Success(RenderResult("old result"))
            }
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("old draft")

        val pending = async { session.render() }
        yield()
        session.updateRawIntent("new draft")
        gate.complete(Unit)

        val state = pending.await()
        assertEquals("new draft", state.rawIntent)
        assertNull(state.previewText)
        assertFalse(state.canCopy)
    }
}
