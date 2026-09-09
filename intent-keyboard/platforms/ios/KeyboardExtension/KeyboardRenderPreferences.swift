import Foundation

struct KeyboardRenderPreferences {
    enum ToneOption: String, CaseIterable {
        case `default` = "DEFAULT"
        case friendly = "FRIENDLY"
        case neutral = "NEUTRAL"
        case work = "WORK"
        case formal = "FORMAL"

        var label: String { rawValue.capitalized }
    }

    enum RecipientOption: String, CaseIterable {
        case none = "NONE"
        case friend = "FRIEND"
        case work = "WORK"
        case client = "CLIENT"
        case formalOffice = "FORMAL_OFFICE"

        var label: String {
            switch self {
            case .formalOffice: return "Formal office"
            default: return rawValue.capitalized
            }
        }
    }

    enum LanguageOption: String, CaseIterable {
        case automatic = ""
        case polish = "Polish"
        case english = "English"
        case german = "German"
        case french = "French"
        case spanish = "Spanish"
        case chinese = "Chinese"
        case ukrainian = "Ukrainian"

        var label: String { self == .automatic ? "Auto" : rawValue }
        var language: String? { self == .automatic ? nil : rawValue }
    }

    private enum Key {
        static let tone = "render.tone"
        static let recipient = "render.recipient"
        static let sourceLanguage = "render.sourceLanguage"
        static let targetLanguage = "render.targetLanguage"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var tone: ToneOption {
        option(for: Key.tone, fallback: .default)
    }

    var recipient: RecipientOption {
        option(for: Key.recipient, fallback: .none)
    }

    var sourceLanguage: LanguageOption {
        languageOption(for: Key.sourceLanguage)
    }

    var targetLanguage: LanguageOption {
        languageOption(for: Key.targetLanguage)
    }

    func setTone(_ value: ToneOption) {
        defaults.set(value.rawValue, forKey: Key.tone)
    }

    func setRecipient(_ value: RecipientOption) {
        defaults.set(value.rawValue, forKey: Key.recipient)
    }

    func setSourceLanguage(_ value: LanguageOption) {
        setLanguage(value, forKey: Key.sourceLanguage)
    }

    func setTargetLanguage(_ value: LanguageOption) {
        setLanguage(value, forKey: Key.targetLanguage)
    }

    private func option<T: RawRepresentable>(for key: String, fallback: T) -> T
    where T.RawValue == String {
        guard
            let stored = defaults.string(forKey: key),
            let value = T(rawValue: stored)
        else {
            return fallback
        }
        return value
    }

    private func languageOption(for key: String) -> LanguageOption {
        option(for: key, fallback: .automatic)
    }

    private func setLanguage(_ value: LanguageOption, forKey key: String) {
        if value == .automatic {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(value.rawValue, forKey: key)
        }
    }
}
