package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.RecipientProfile
import io.github.twojstar.intentkeyboard.Register
import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.RendererOutcome
import io.github.twojstar.intentkeyboard.SemanticRenderer
import io.github.twojstar.intentkeyboard.Tone
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
    fun renderSettingsReachSharedRequestAndInvalidatePreview() = runBlocking {
        var captured: RenderRequest? = null
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: RenderRequest): RendererOutcome {
                captured = request
                return RendererOutcome.Success(RenderResult("ready"))
            }
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("hej")
        session.setTone(Tone.WORK)
        session.setRecipientProfile(RecipientProfile.CLIENT)
        session.setSourceLanguage("  Polish ")
        session.setTargetLanguage(" English ")

        val rendered = session.render()
        assertEquals("ready", rendered.previewText)
        assertEquals(Tone.WORK, captured?.tone)
        assertEquals(RecipientProfile.CLIENT, captured?.recipientProfile)
        assertEquals("Polish", captured?.sourceLanguage)
        assertEquals("English", captured?.targetLanguage)

        val changed = session.setTone(Tone.FORMAL)
        assertNull(changed.previewText)
        assertFalse(changed.canCopy)
        assertEquals(Tone.FORMAL, changed.preferences.tone)
    }

    @Test
    fun blankLanguagesNormalizeBackToAutomatic() {
        val session = DesktopIntentSession()
        session.setSourceLanguage(" Polish ")
        session.setTargetLanguage("English")

        val state = session.setSourceLanguage("   ")
        val cleared = session.setTargetLanguage(null)

        assertNull(state.preferences.sourceLanguage)
        assertNull(cleared.preferences.targetLanguage)
    }

    @Test
    fun revertKeepsRawDraftRegisterAndSettingsButDropsPreview() = runBlocking {
        val session = DesktopIntentSession()
        session.updateRawIntent("hej tam")
        session.setRegister(Register.CIVILIZED)
        session.setTone(Tone.FRIENDLY)
        session.setRecipientProfile(RecipientProfile.FRIEND)
        session.render()

        val reverted = session.revert()
        assertEquals("hej tam", reverted.rawIntent)
        assertEquals(Register.CIVILIZED, reverted.register)
        assertEquals(Tone.FRIENDLY, reverted.preferences.tone)
        assertEquals(RecipientProfile.FRIEND, reverted.preferences.recipientProfile)
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
    fun blankSemanticDraftDoesNotClearClipboardButRawPreservesWhitespace() = runBlocking {
        val session = DesktopIntentSession()
        session.updateRawIntent("   \n  ")

        val rendered = session.render()
        assertEquals("", rendered.previewText)
        assertFalse(rendered.canCopy)
        assertNull(session.copyTextOrNull())

        val raw = session.setRegister(Register.RAW)
        assertTrue(raw.canCopy)
        assertEquals("   \n  ", session.copyTextOrNull())
    }

    @Test
    fun lockViolationBlocksCopy() = runBlocking {
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: RenderRequest) =
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
    fun lateRenderDoesNotOverwriteNewerDraftOrSettings() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: RenderRequest): RendererOutcome {
                gate.await()
                return RendererOutcome.Success(RenderResult("old result"))
            }
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("old draft")

        val pending = async { session.render() }
        yield()
        session.setTone(Tone.FORMAL)
        gate.complete(Unit)

        val state = pending.await()
        assertEquals("old draft", state.rawIntent)
        assertEquals(Tone.FORMAL, state.preferences.tone)
        assertNull(state.previewText)
        assertFalse(state.canCopy)
    }
}
