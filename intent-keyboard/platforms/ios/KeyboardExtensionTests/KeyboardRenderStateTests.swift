import XCTest

final class KeyboardRenderStateTests: XCTestCase {
    private let preferences = KeyboardRenderPreferenceSnapshot(
        toneName: "DEFAULT",
        sourceLanguage: nil,
        targetLanguage: nil,
        recipientProfileName: "NONE"
    )

    func testAutoRenderRequiresNonRawNonBlankUnsuppressedDraft() {
        var state = KeyboardRenderState()
        XCTAssertNil(state.autoRenderRequest(preferences: preferences))

        state.append("hej")
        XCTAssertNotNil(state.autoRenderRequest(preferences: preferences))

        state.cycleRegister() // CIVILIZED
        state.cycleRegister() // RAW
        XCTAssertNil(state.autoRenderRequest(preferences: preferences))
    }

    func testEditInvalidatesOutstandingRequest() {
        var state = KeyboardRenderState()
        state.append("hej")
        let request = state.autoRenderRequest(preferences: preferences)!

        state.append("!")

        XCTAssertFalse(state.isCurrent(request, preferences: preferences))
    }

    func testNewRenderSupersedesOlderRenderForSameDraft() {
        var state = KeyboardRenderState()
        state.append("hej")
        let first = state.beginRender(preferences: preferences)!
        let second = state.beginRender(preferences: preferences)!

        XCTAssertFalse(state.isCurrent(first, preferences: preferences))
        XCTAssertTrue(state.isCurrent(second, preferences: preferences))
    }

    func testSafeCurrentRenderBecomesCommitOutput() {
        var state = KeyboardRenderState()
        state.append("hej")
        let request = state.beginRender(preferences: preferences)!

        XCTAssertTrue(state.applyRender(
            request,
            text: "Hej.",
            canCommit: true,
            preferences: preferences
        ))
        XCTAssertEqual(state.commitDecision(), .output("Hej."))
        XCTAssertTrue(state.revertEnabled)
    }

    func testUnsafePreviewBlocksCommit() {
        var state = KeyboardRenderState()
        state.append("spotkanie o 18:30")
        let request = state.beginRender(preferences: preferences)!
        state.applyRender(
            request,
            text: "Spotkanie o 19:00.",
            canCommit: false,
            preferences: preferences
        )

        XCTAssertEqual(state.commitDecision(), .blockedUnsafePreview)
    }

    func testRawAndWhitespaceCommitWithoutPreview() {
        var rawState = KeyboardRenderState()
        rawState.append("hej")
        rawState.cycleRegister() // CIVILIZED
        rawState.cycleRegister() // RAW
        XCTAssertEqual(rawState.commitDecision(), .output("hej"))

        var whitespaceState = KeyboardRenderState()
        whitespaceState.append("  \n")
        XCTAssertEqual(whitespaceState.commitDecision(), .output("  \n"))
    }

    func testRevertPreservesDraftSuppressesAutoRenderAndRequiresFreshPreview() {
        var state = KeyboardRenderState()
        state.append("hej")
        let request = state.beginRender(preferences: preferences)!
        state.applyRender(request, text: "Hej.", canCommit: true, preferences: preferences)

        XCTAssertTrue(state.revertPreview())
        XCTAssertEqual(state.rawIntent, "hej")
        XCTAssertEqual(state.registerName, "NATURAL")
        XCTAssertFalse(state.hasCurrentPreview)
        XCTAssertNil(state.autoRenderRequest(preferences: preferences))
        XCTAssertEqual(state.commitDecision(), .previewRequired(reverted: true))

        state.append("!")
        XCTAssertNotNil(state.autoRenderRequest(preferences: preferences))
        XCTAssertEqual(state.commitDecision(), .previewRequired(reverted: false))
    }

    func testRegisterAndPreferenceChangesInvalidatePreviewAndTokens() {
        var state = KeyboardRenderState()
        state.append("hej")
        let registerToken = state.beginRender(preferences: preferences)!
        state.applyRender(registerToken, text: "Hej.", canCommit: true, preferences: preferences)
        state.cycleRegister()
        XCTAssertFalse(state.hasCurrentPreview)
        XCTAssertFalse(state.isCurrent(registerToken, preferences: preferences))

        let preferenceToken = state.beginRender(preferences: preferences)!
        state.preferencesChanged()
        XCTAssertFalse(state.isCurrent(preferenceToken, preferences: preferences))
    }

    func testPreferenceSnapshotChangeRejectsLateRender() {
        var state = KeyboardRenderState()
        state.append("hej")
        let request = state.beginRender(preferences: preferences)!
        let changed = KeyboardRenderPreferenceSnapshot(
            toneName: "FORMAL",
            sourceLanguage: nil,
            targetLanguage: nil,
            recipientProfileName: "NONE"
        )

        XCTAssertFalse(state.isCurrent(request, preferences: changed))
        XCTAssertFalse(state.applyRender(
            request,
            text: "Hej.",
            canCommit: true,
            preferences: changed
        ))
    }
}
