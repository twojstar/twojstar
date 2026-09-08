package io.github.twojstar.intentkeyboard

enum class Register {
    RAW,
    NATURAL,
    CIVILIZED,
}

enum class Tone {
    DEFAULT,
    FRIENDLY,
    NEUTRAL,
    WORK,
    FORMAL,
}

enum class LockMode {
    VERBATIM,
    SEMANTIC,
}

data class SemanticLock(
    val value: String,
    val mode: LockMode = LockMode.VERBATIM,
)

data class RenderRequest(
    val rawIntent: String,
    val register: Register = Register.NATURAL,
    val tone: Tone = Tone.DEFAULT,
    val sourceLanguage: String? = null,
    val targetLanguage: String? = null,
    val locks: List<SemanticLock> = emptyList(),
)

data class RenderResult(
    val text: String,
    val warnings: List<String> = emptyList(),
    val violatedLocks: List<SemanticLock> = emptyList(),
) {
    val canCommit: Boolean
        get() = violatedLocks.isEmpty()
}

class SemanticRenderException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

interface SemanticRenderer {
    suspend fun render(request: RenderRequest): RenderResult
}

class SemanticPipeline(
    private val renderer: SemanticRenderer,
) {
    suspend fun render(request: RenderRequest): RenderResult {
        val result = renderer.render(request)
        val requiredOccurrences = mutableMapOf<SemanticLock, Int>()
        val violatedLocks = buildList {
            request.locks
                .asSequence()
                .filter { it.mode == LockMode.VERBATIM }
                .forEach { lock ->
                    val requiredCount = (requiredOccurrences[lock] ?: 0) + 1
                    requiredOccurrences[lock] = requiredCount

                    if (countExactOccurrences(result.text, lock.value) < requiredCount) {
                        add(lock)
                    }
                }
        }

        return if (violatedLocks.isEmpty()) {
            result
        } else {
            result.copy(
                warnings = result.warnings + violatedLocks.map {
                    "Renderer changed or removed locked value: ${it.value}"
                },
                violatedLocks = result.violatedLocks + violatedLocks,
            )
        }
    }

    private fun countExactOccurrences(text: String, value: String): Int {
        if (value.isEmpty() || text.length < value.length) return 0

        var count = 0
        var searchFrom = 0

        while (searchFrom <= text.length - value.length) {
            val index = text.indexOf(value, startIndex = searchFrom)
            if (index < 0) break

            val end = index + value.length
            val leftBoundary = index == 0 || !text[index - 1].isLetterOrDigit()
            val rightBoundary = end == text.length || !text[end].isLetterOrDigit()

            if (leftBoundary && rightBoundary) count += 1
            searchFrom = end
        }

        return count
    }
}
