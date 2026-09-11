import Foundation

struct KeyboardRenderPreferenceSnapshot: Equatable {
    let toneName: String
    let sourceLanguage: String?
    let targetLanguage: String?
    let recipientProfileName: String
}

struct KeyboardRenderState {
    struct RequestIdentity: Equatable {
        let source: String
        let registerName: String
        let preferences: KeyboardRenderPreferenceSnapshot
        let generation: UInt64
    }

    enum CommitDecision: Equatable {
        case nothing
        case output(String)
        case previewRequired(reverted: Bool)
        case blockedUnsafePreview
    }

    private static let registerNames = ["RAW", "NATURAL", "CIVILIZED"]

    private(set) var rawIntent = ""
    private(set) var renderedSource = ""
    private(set) var renderedText = ""
    private(set) var renderedCanCommit = true
    private(set) var autoRenderSuppressedSource: String?
    private(set) var registerIndex = 1
    private(set) var generation: UInt64 = 0

    var registerName: String { Self.registerNames[registerIndex] }
    var hasCurrentPreview: Bool { renderedSource == rawIntent && !renderedText.isEmpty }
    var hasDraft: Bool { !rawIntent.isEmpty || !renderedText.isEmpty }
    var revertEnabled: Bool { hasCurrentPreview }

    mutating func append(_ text: String) {
        autoRenderSuppressedSource = nil
        rawIntent.append(text)
        invalidatePreview()
    }

    @discardableResult
    mutating func backspace() -> Bool {
        guard !rawIntent.isEmpty else { return false }
        autoRenderSuppressedSource = nil
        rawIntent.removeLast()
        invalidatePreview()
        return true
    }

    mutating func cycleRegister() {
        autoRenderSuppressedSource = nil
        registerIndex = (registerIndex + 1) % Self.registerNames.count
        invalidatePreview()
    }

    mutating func preferencesChanged() {
        autoRenderSuppressedSource = nil
        invalidatePreview()
    }

    mutating func clearAutoRenderSuppression() {
        autoRenderSuppressedSource = nil
    }

    mutating func clear() {
        rawIntent = ""
        autoRenderSuppressedSource = nil
        invalidatePreview()
    }

    mutating func invalidatePreview() {
        generation &+= 1
        renderedSource = ""
        renderedText = ""
        renderedCanCommit = true
    }

    func autoRenderRequest(
        preferences: KeyboardRenderPreferenceSnapshot
    ) -> RequestIdentity? {
        guard registerName != "RAW" else { return nil }
        guard !rawIntent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        guard rawIntent != autoRenderSuppressedSource else { return nil }
        return RequestIdentity(
            source: rawIntent,
            registerName: registerName,
            preferences: preferences,
            generation: generation
        )
    }

    mutating func beginRender(
        preferences: KeyboardRenderPreferenceSnapshot
    ) -> RequestIdentity? {
        guard !rawIntent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        generation &+= 1
        return RequestIdentity(
            source: rawIntent,
            registerName: registerName,
            preferences: preferences,
            generation: generation
        )
    }

    func isCurrent(
        _ request: RequestIdentity,
        preferences: KeyboardRenderPreferenceSnapshot
    ) -> Bool {
        request.generation == generation &&
            request.source == rawIntent &&
            request.registerName == registerName &&
            request.preferences == preferences &&
            request.source != autoRenderSuppressedSource
    }

    @discardableResult
    mutating func applyRender(
        _ request: RequestIdentity,
        text: String,
        canCommit: Bool,
        preferences: KeyboardRenderPreferenceSnapshot
    ) -> Bool {
        guard isCurrent(request, preferences: preferences) else { return false }
        renderedSource = request.source
        renderedText = text
        renderedCanCommit = canCommit
        return true
    }

    @discardableResult
    mutating func revertPreview() -> Bool {
        guard hasCurrentPreview else { return false }
        let source = rawIntent
        invalidatePreview()
        autoRenderSuppressedSource = source
        return true
    }

    func commitDecision() -> CommitDecision {
        guard !rawIntent.isEmpty else { return .nothing }
        if rawIntent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .output(rawIntent)
        }
        if registerName == "RAW" {
            return .output(rawIntent)
        }
        guard hasCurrentPreview else {
            return .previewRequired(reverted: autoRenderSuppressedSource == rawIntent)
        }
        guard renderedCanCommit else { return .blockedUnsafePreview }
        return .output(renderedText)
    }
}
