package io.github.twojstar.intentkeyboard

enum class CharacterPage {
    LETTERS,
    NUMBERS,
}

data class CharacterLayout(
    val rows: List<String>,
)

/**
 * Small shared layout definition for the prototype adapters.
 *
 * This is intentionally not a full locale-aware keyboard engine yet. It keeps
 * the character coverage required by the semantic-input MVP consistent across
 * Android and future iOS/desktop adapters.
 */
object PrototypeKeyboardLayout {
    private val polishLetters = listOf(
        "qwertyuiop",
        "asdfghjkl",
        "zxcvbnm",
        "ąćęłńóśźż",
    )

    private val numbersAndSymbols = listOf(
        "1234567890",
        ":;!?-_/@",
        "€$+%=()",
    )

    fun layout(page: CharacterPage, uppercase: Boolean = false): CharacterLayout {
        val rows = when (page) {
            CharacterPage.LETTERS -> polishLetters
            CharacterPage.NUMBERS -> numbersAndSymbols
        }

        return CharacterLayout(
            rows = if (page == CharacterPage.LETTERS && uppercase) {
                rows.map(String::uppercase)
            } else {
                rows
            },
        )
    }
}
