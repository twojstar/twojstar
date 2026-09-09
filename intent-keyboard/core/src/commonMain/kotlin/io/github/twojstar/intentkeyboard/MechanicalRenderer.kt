package io.github.twojstar.intentkeyboard

/**
 * Deterministic local renderer used by the first prototype.
 *
 * It intentionally does not pretend to understand semantics. It only normalizes
 * whitespace and basic sentence casing/punctuation so the platform adapters can
 * exercise the real pipeline before an on-device or remote model is wired in.
 */
class MechanicalRenderer : SemanticRenderer {
    override suspend fun render(request: RenderRequest): RendererOutcome {
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
            if (request.tone != Tone.DEFAULT) {
                add("Mechanical preview does not apply semantic tone changes.")
            }
            if (request.recipientProfile != RecipientProfile.NONE) {
                add("Mechanical preview does not apply recipient context.")
            }
            if (
                request.targetLanguage != null &&
                request.targetLanguage != request.sourceLanguage
            ) {
                add("Mechanical preview does not translate between languages.")
            }
        }

        return RendererOutcome.Success(RenderResult(text = text, warnings = warnings))
    }

    private fun String.sentenceCase(): String = replaceFirstChar { char ->
        if (char.isLowerCase()) char.titlecase() else char.toString()
    }

    private fun String.withTerminalPunctuation(): String =
        if (last() in ".!?…") this else "$this."
}

/** Conservative automatic locks for obvious values a renderer must not alter. */
object ConservativeLockDetector {
    private const val CURRENCY_PATTERN = "(?:zł|PLN|EUR|USD|€|\\$)"
    private const val NUMBER_PATTERN = "\\d+(?:[.,]\\d+)?"

    private val timePattern = Regex("""\b(?:[01]?\d|2[0-3]):[0-5]\d\b""")
    private val suffixMoneyPattern = Regex(
        """(?<!\w)[+-]?$NUMBER_PATTERN\s?$CURRENCY_PATTERN(?!\w)""",
        RegexOption.IGNORE_CASE,
    )
    private val prefixMoneyPattern = Regex(
        """(?<!\w)[+-]?$CURRENCY_PATTERN\s?$NUMBER_PATTERN(?!\w)""",
        RegexOption.IGNORE_CASE,
    )
    private val urlPattern = Regex(
        """https?://[^\s<>"'`]+""",
        RegexOption.IGNORE_CASE,
    )
    private val quotedLiteralPatterns = listOf(
        Regex("\"[^\"\\r\\n]+\""),
        Regex("“[^”\\r\\n]+”"),
        Regex("„[^”\\r\\n]+”"),
        Regex("`[^`\\r\\n]+`"),
    )
    private val urlTrailingPunctuation = setOf('.', ',', ';', ':')

    fun detect(text: String): List<SemanticLock> = buildList {
        sequenceOf(timePattern, suffixMoneyPattern, prefixMoneyPattern)
            .flatMap { pattern -> pattern.findAll(text).map { SemanticLock(it.value) } }
            .forEach(::add)

        urlPattern.findAll(text)
            .mapNotNull { match ->
                val value = match.value.trimEnd { it in urlTrailingPunctuation }
                val schemeEnd = value.indexOf("://") + 3
                value.takeIf { schemeEnd >= 3 && it.length > schemeEnd }?.let(::SemanticLock)
            }
            .forEach(::add)

        quotedLiteralPatterns.asSequence()
            .flatMap { pattern -> pattern.findAll(text).map { SemanticLock(it.value) } }
            .forEach(::add)
    }
}
