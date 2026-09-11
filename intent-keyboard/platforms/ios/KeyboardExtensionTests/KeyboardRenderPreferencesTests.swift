import Foundation
import XCTest

final class KeyboardRenderPreferencesTests: XCTestCase {
    func testDefaultsAreSafe() {
        withPreferences { _, preferences in
            XCTAssertEqual(preferences.tone, .default)
            XCTAssertEqual(preferences.recipient, .none)
            XCTAssertEqual(preferences.sourceLanguage, .automatic)
            XCTAssertEqual(preferences.targetLanguage, .automatic)
        }
    }

    func testSelectionsPersistAcrossInstances() {
        withPreferences { defaults, preferences in
            preferences.setTone(.formal)
            preferences.setRecipient(.client)
            preferences.setSourceLanguage(.polish)
            preferences.setTargetLanguage(.english)

            let reloaded = KeyboardRenderPreferences(defaults: defaults)
            XCTAssertEqual(reloaded.tone, .formal)
            XCTAssertEqual(reloaded.recipient, .client)
            XCTAssertEqual(reloaded.sourceLanguage, .polish)
            XCTAssertEqual(reloaded.targetLanguage, .english)
        }
    }

    func testAutomaticLanguageRemovesStoredOverride() {
        withPreferences { defaults, preferences in
            preferences.setSourceLanguage(.german)
            preferences.setTargetLanguage(.french)
            XCTAssertNotNil(defaults.object(forKey: "render.sourceLanguage"))
            XCTAssertNotNil(defaults.object(forKey: "render.targetLanguage"))

            preferences.setSourceLanguage(.automatic)
            preferences.setTargetLanguage(.automatic)

            XCTAssertNil(defaults.object(forKey: "render.sourceLanguage"))
            XCTAssertNil(defaults.object(forKey: "render.targetLanguage"))
            XCTAssertEqual(preferences.sourceLanguage, .automatic)
            XCTAssertEqual(preferences.targetLanguage, .automatic)
        }
    }

    func testUnknownStoredValuesFallBackSafely() {
        withPreferences { defaults, preferences in
            defaults.set("LOUD", forKey: "render.tone")
            defaults.set("STRANGER", forKey: "render.recipient")
            defaults.set("Klingon", forKey: "render.sourceLanguage")
            defaults.set("Elvish", forKey: "render.targetLanguage")

            XCTAssertEqual(preferences.tone, .default)
            XCTAssertEqual(preferences.recipient, .none)
            XCTAssertEqual(preferences.sourceLanguage, .automatic)
            XCTAssertEqual(preferences.targetLanguage, .automatic)
        }
    }

    func testLanguageProjectionMatchesStoredOption() {
        XCTAssertNil(KeyboardRenderPreferences.LanguageOption.automatic.language)
        XCTAssertEqual(KeyboardRenderPreferences.LanguageOption.polish.language, "Polish")
        XCTAssertEqual(KeyboardRenderPreferences.LanguageOption.chinese.language, "Chinese")
    }

    private func withPreferences(
        _ body: (UserDefaults, KeyboardRenderPreferences) throws -> Void
    ) rethrows {
        let suiteName = "KeyboardRenderPreferencesTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Could not create isolated UserDefaults suite.")
            return
        }

        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        try body(defaults, KeyboardRenderPreferences(defaults: defaults))
    }
}
