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
)

interface SemanticRenderer {
    suspend fun render(request: RenderRequest): RenderResult
}

class SemanticPipeline(
    private val renderer: SemanticRenderer,
) {
    suspend fun render(request: RenderRequest): RenderResult {
        val result = renderer.render(request)
        val missingVerbatimLocks = request.locks
            .asSequence()
            .filter { it.mode == LockMode.VERBATIM }
            .filterNot { result.text.contains(it.value) }
            .map { "Renderer changed or removed locked value: ${it.value}" }
            .toList()

        return if (missingVerbatimLocks.isEmpty()) {
            result
        } else {
            result.copy(warnings = result.warnings + missingVerbatimLocks)
        }
    }
}
