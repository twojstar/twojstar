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
        val expected = "new result"
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
                return RendererOutcome.Success(RenderResult(expected))
            }
        }
        val session = DesktopIntentSession(renderer)
        session.updateRawIntent("same draft")

        val older = async { session.render() }
        firstStarted.await()
        val newer = async { session.render() }

        assertEquals(expected, newer.await().previewText)
        releaseFirst.complete(Unit)

        assertEquals(expected, older.await().previewText)
        assertEquals(expected, session.currentState().previewText)
        assertEquals(expected, session.copyTextOrNull())
    }
}
