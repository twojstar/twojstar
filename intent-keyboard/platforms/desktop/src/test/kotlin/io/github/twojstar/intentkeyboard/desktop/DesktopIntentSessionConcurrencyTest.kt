package io.github.twojstar.intentkeyboard.desktop

import io.github.twojstar.intentkeyboard.RenderRequest
import io.github.twojstar.intentkeyboard.RenderResult
import io.github.twojstar.intentkeyboard.RendererOutcome
import io.github.twojstar.intentkeyboard.SemanticRenderer
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking

class DesktopIntentSessionConcurrencyTest {
    @Test
    fun olderRenderCannotOverwriteNewerResult() = runBlocking {
        val calls = AtomicInteger()
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val renderer = object : SemanticRenderer {
            override suspend fun render(request: RenderRequest): RendererOutcome {
                if (calls.incrementAndGet() == 1) {
                    firstStarted.complete(Unit)
                    releaseFirst.await()
                    return RendererOutcome.Success(RenderResult("old result"))
                }
                return RendererOutcome.Success(RenderResult("new result"))
            }
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("same draft")

        val older = async { session.render() }
        firstStarted.await()
        val newer = async { session.render() }

        assertEquals("new result", newer.await().previewText)
        releaseFirst.complete(Unit)

        assertEquals("new result", older.await().previewText)
        assertEquals("new result", session.currentState().previewText)
        assertEquals("new result", session.copyTextOrNull())
    }
}
