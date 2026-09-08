package io.github.twojstar.intentkeyboard

/**
 * Deterministic local renderer used by the first prototype.
 *
 * It intentionally does not pretend to understand semantics. It only normalizes
 * whitespace and basic sentence casing/punctuation so the platform adapters can
 * exercise the real pipeline before an on-device or remote model is wired in.
 */
class MechanicalRenderer : SemanticRenderer {
    override suspend fun render(request: RenderRequest): RenderResult {
        val text = when (request.register) {
            Register.RAW -> request.rawIntent
            Register.NATURAL,
            Register.CIVILIZED,
            -> request.rawIntent
                .trim()
                .replace(Regex("\\s+"), " ")
                .let { normalized ->
                    if (normalized.isEmpty()) normalized
                    else normalized.sentenceCase().withTerminalPunctuation()
                }
        }

        val warnings = buildList {
            if (request.register == Register.CIVILIZED) {
                add("Mechanical preview only: semantic rewriting is not wired yet.")
            }
            if (
                request.targetLanguage != null &&
                request.targetLanguage != request.sourceLanguage
            ) {
                add("Mechanical preview does not translate between languages.")
            }
        }

        return RenderResult(text = text, warnings = warnings)
    }

    private fun String.sentenceCase(): String = replaceFirstChar { char ->
        if (char.isLowerCase()) char.titlecase() else char.toString()
    }

    private fun String.withTerminalPunctuation(): String =
        if (last() in ".!?…") this else "$this."
}

/** Conservative automatic locks for obvious values a renderer must not alter. */
object ConservativeLockDetector {
    private val timePattern = Regex("""\b(?:[01]?\d|2[0-3]):[0-5]\d\b""")
    private val currency = "(?:zł|PLN|EUR|USD|€|\\$)"
    private val number = "\\d+(?:[.,]\\d+)?"
    private val suffixMoneyPattern = Regex(
        """(?<!\w)[+-]?$number\s?$currency(?!\w)""",
        RegexOption.IGNORE_CASE,
    )
    private val prefixMoneyPattern = Regex(
        """(?<!\w)[+-]?$currency\s?$number(?!\w)""",
        RegexOption.IGNORE_CASE,
    )

    fun detect(text: String): List<SemanticLock> =
        sequenceOf(timePattern, suffixMoneyPattern, prefixMoneyPattern)
            .flatMap { pattern -> pattern.findAll(text).map { SemanticLock(it.value) } }
            .toList()
}
