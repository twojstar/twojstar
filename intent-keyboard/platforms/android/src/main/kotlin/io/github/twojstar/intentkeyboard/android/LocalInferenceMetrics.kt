package io.github.twojstar.intentkeyboard.android

import kotlin.math.ceil

data class LocalInferenceMetricsSnapshot(
    val successfulSamples: Int,
    val failedSamples: Int,
    val lastLatencyMillis: Long?,
    val medianLatencyMillis: Long?,
    val p95LatencyMillis: Long?,
    val lastInputCharacters: Int?,
    val lastOutputCharacters: Int?,
)

/**
 * Process-local performance samples for real-device tuning.
 *
 * Only timings and character counts are retained. Draft or completion text is never stored, logged,
 * or persisted, and all samples disappear when the app process exits.
 */
object LocalInferenceMetrics {
    private const val MAX_SAMPLES = 20
    private val lock = Any()
    private val successfulLatenciesMillis = ArrayDeque<Long>(MAX_SAMPLES)
    private var failedSamples = 0
    private var lastInputCharacters: Int? = null
    private var lastOutputCharacters: Int? = null

    fun recordSuccess(latencyMillis: Long, inputCharacters: Int, outputCharacters: Int) {
        require(latencyMillis >= 0L) { "latencyMillis must not be negative" }
        require(inputCharacters >= 0) { "inputCharacters must not be negative" }
        require(outputCharacters >= 0) { "outputCharacters must not be negative" }

        synchronized(lock) {
            if (successfulLatenciesMillis.size == MAX_SAMPLES) {
                successfulLatenciesMillis.removeFirst()
            }
            successfulLatenciesMillis.addLast(latencyMillis)
            lastInputCharacters = inputCharacters
            lastOutputCharacters = outputCharacters
        }
    }

    fun recordFailure() {
        synchronized(lock) {
            failedSamples += 1
        }
    }

    fun reset() {
        synchronized(lock) {
            successfulLatenciesMillis.clear()
            failedSamples = 0
            lastInputCharacters = null
            lastOutputCharacters = null
        }
    }

    fun snapshot(): LocalInferenceMetricsSnapshot = synchronized(lock) {
        val sorted = successfulLatenciesMillis.sorted()
        val median = when {
            sorted.isEmpty() -> null
            sorted.size % 2 == 1 -> sorted[sorted.size / 2]
            else -> (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2
        }
        val p95 = sorted.takeIf { it.isNotEmpty() }?.let { values ->
            val index = (ceil(values.size * 0.95).toInt() - 1).coerceIn(values.indices)
            values[index]
        }

        LocalInferenceMetricsSnapshot(
            successfulSamples = successfulLatenciesMillis.size,
            failedSamples = failedSamples,
            lastLatencyMillis = successfulLatenciesMillis.lastOrNull(),
            medianLatencyMillis = median,
            p95LatencyMillis = p95,
            lastInputCharacters = lastInputCharacters,
            lastOutputCharacters = lastOutputCharacters,
        )
    }
}
