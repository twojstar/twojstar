package io.github.twojstar.intentkeyboard.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class LocalInferenceMetricsTest {
    @Before
    fun setUp() {
        LocalInferenceMetrics.reset()
    }

    @After
    fun tearDown() {
        LocalInferenceMetrics.reset()
    }

    @Test
    fun recordsSuccessesFailuresAndQuantiles() {
        LocalInferenceMetrics.recordSuccess(100, 10, 20)
        LocalInferenceMetrics.recordSuccess(300, 11, 21)
        LocalInferenceMetrics.recordSuccess(200, 12, 22)
        LocalInferenceMetrics.recordFailure()
        LocalInferenceMetrics.recordFailure()

        val snapshot = LocalInferenceMetrics.snapshot()

        assertEquals(3, snapshot.successfulSamples)
        assertEquals(2, snapshot.failedSamples)
        assertEquals(200L, snapshot.lastLatencyMillis)
        assertEquals(200L, snapshot.medianLatencyMillis)
        assertEquals(300L, snapshot.p95LatencyMillis)
        assertEquals(12, snapshot.lastInputCharacters)
        assertEquals(22, snapshot.lastOutputCharacters)
    }

    @Test
    fun keepsOnlyTheLatestTwentySuccessfulSamples() {
        (1..25).forEach { value ->
            LocalInferenceMetrics.recordSuccess(
                latencyMillis = value.toLong(),
                inputCharacters = value,
                outputCharacters = value + 100,
            )
        }

        val snapshot = LocalInferenceMetrics.snapshot()

        assertEquals(20, snapshot.successfulSamples)
        assertEquals(25L, snapshot.lastLatencyMillis)
        assertEquals(15L, snapshot.medianLatencyMillis)
        assertEquals(24L, snapshot.p95LatencyMillis)
        assertEquals(25, snapshot.lastInputCharacters)
        assertEquals(125, snapshot.lastOutputCharacters)
    }

    @Test
    fun resetClearsAllRecordedState() {
        LocalInferenceMetrics.recordSuccess(42, 4, 8)
        LocalInferenceMetrics.recordFailure()

        LocalInferenceMetrics.reset()
        val snapshot = LocalInferenceMetrics.snapshot()

        assertEquals(0, snapshot.successfulSamples)
        assertEquals(0, snapshot.failedSamples)
        assertNull(snapshot.lastLatencyMillis)
        assertNull(snapshot.medianLatencyMillis)
        assertNull(snapshot.p95LatencyMillis)
        assertNull(snapshot.lastInputCharacters)
        assertNull(snapshot.lastOutputCharacters)
    }

    @Test
    fun rejectsNegativeSuccessMetrics() {
        assertThrows(IllegalArgumentException::class.java) {
            LocalInferenceMetrics.recordSuccess(-1, 0, 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocalInferenceMetrics.recordSuccess(0, -1, 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            LocalInferenceMetrics.recordSuccess(0, 0, -1)
        }
    }
}
