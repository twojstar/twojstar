import IntentKeyboardCore
import UIKit

final class KeyboardViewController: UIInputViewController {
    private enum CharacterPage {
        case letters
        case numbers
    }

    private static let autoRenderDebounceNanoseconds: UInt64 = 450_000_000
    private static let statusPreviewPending = "Preview updates after a short pause…"
    private static let statusRendering = "Rendering…"

    private let semanticBridge = IosSemanticBridge()
    private let renderPreferences = KeyboardRenderPreferences()

    private var renderState = KeyboardRenderState()
    private var characterPage = CharacterPage.letters
    private var autoRenderTask: Task<Void, Never>?
    private var renderTask: Task<Void, Never>?
    private var activeDocumentIdentifier: UUID?

    private let rawLabel = UILabel()
    private let previewLabel = UILabel()
    private let statusLabel = UILabel()
    private let registerButton = UIButton(type: .system)
    private let preferencesButton = UIButton(type: .system)
    private let revertButton = UIButton(type: .system)
    private let pageButton = UIButton(type: .system)
    private let enterButton = UIButton(type: .system)
    private let rootStack = UIStackView()
    private let keysStack = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        activeDocumentIdentifier = textDocumentProxy.documentIdentifier
        configureView()
        refreshViews()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        refreshCompactLayout()
    }

    override func viewWillDisappear(_ animated: Bool) {
        clearBuffer()
        activeDocumentIdentifier = nil
        super.viewWillDisappear(animated)
    }

    override func textDidChange(_ textInput: UITextInput?) {
        super.textDidChange(textInput)
        refreshHostContext()
    }

    override func selectionDidChange(_ textInput: UITextInput?) {
        super.selectionDidChange(textInput)
        refreshHostContext()
    }

    private func configureView() {
        view.backgroundColor = .systemBackground

        rawLabel.font = .preferredFont(forTextStyle: .footnote)
        rawLabel.numberOfLines = 1
        rawLabel.adjustsFontSizeToFitWidth = true
        rawLabel.minimumScaleFactor = 0.75
        rawLabel.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

        previewLabel.font = .preferredFont(forTextStyle: .body)
        previewLabel.numberOfLines = 1
        previewLabel.adjustsFontSizeToFitWidth = true
        previewLabel.minimumScaleFactor = 0.75
        previewLabel.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

        statusLabel.font = .preferredFont(forTextStyle: .caption2)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 1
        statusLabel.adjustsFontSizeToFitWidth = true
        statusLabel.minimumScaleFactor = 0.75
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .vertical)

        registerButton.configuration = compactButtonConfiguration(filled: false)
        registerButton.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        registerButton.addAction(UIAction { [weak self] _ in
            self?.cycleRegister()
        }, for: .touchUpInside)

        preferencesButton.configuration = compactButtonConfiguration(filled: false)
        preferencesButton.setTitle("Prefs", for: .normal)
        preferencesButton.showsMenuAsPrimaryAction = true
        preferencesButton.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        refreshPreferencesMenu()

        let renderButton = makeControlButton("Render") { [weak self] in
            self?.renderBuffer()
        }

        revertButton.configuration = compactButtonConfiguration(filled: false)
        revertButton.setTitle("Revert", for: .normal)
        revertButton.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        revertButton.addAction(UIAction { [weak self] _ in
            self?.revertPreview()
        }, for: .touchUpInside)

        let commitButton = makeControlButton("Commit") { [weak self] in
            self?.commitBuffer()
        }

        let toolbar = makeRow([
            registerButton,
            preferencesButton,
            renderButton,
            revertButton,
            commitButton,
        ])

        keysStack.axis = .vertical
        keysStack.spacing = 3
        keysStack.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        rebuildCharacterRows()

        rootStack.addArrangedSubview(rawLabel)
        rootStack.addArrangedSubview(previewLabel)
        rootStack.addArrangedSubview(toolbar)
        rootStack.addArrangedSubview(keysStack)
        rootStack.addArrangedSubview(makeBottomRow())
        rootStack.addArrangedSubview(statusLabel)
        rootStack.axis = .vertical
        rootStack.spacing = 4
        rootStack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(rootStack)
        NSLayoutConstraint.activate([
            rootStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 4),
            rootStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -4),
            rootStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 4),
            rootStack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -4),
        ])
    }

    private func refreshPreferencesMenu() {
        let toneMenu = UIMenu(
            title: "Tone",
            children: KeyboardRenderPreferences.ToneOption.allCases.map { option in
                UIAction(
                    title: option.label,
                    state: option == renderPreferences.tone ? .on : .off
                ) { [weak self] _ in
                    self?.renderPreferences.setTone(option)
                    self?.renderPreferencesChanged()
                }
            }
        )
        let recipientMenu = UIMenu(
            title: "Recipient",
            children: KeyboardRenderPreferences.RecipientOption.allCases.map { option in
                UIAction(
                    title: option.label,
                    state: option == renderPreferences.recipient ? .on : .off
                ) { [weak self] _ in
                    self?.renderPreferences.setRecipient(option)
                    self?.renderPreferencesChanged()
                }
            }
        )
        let sourceMenu = UIMenu(
            title: "Source language",
            children: KeyboardRenderPreferences.LanguageOption.allCases.map { option in
                UIAction(
                    title: option.label,
                    state: option == renderPreferences.sourceLanguage ? .on : .off
                ) { [weak self] _ in
                    self?.renderPreferences.setSourceLanguage(option)
                    self?.renderPreferencesChanged()
                }
            }
        )
        let targetMenu = UIMenu(
            title: "Target language",
            children: KeyboardRenderPreferences.LanguageOption.allCases.map { option in
                UIAction(
                    title: option.label,
                    state: option == renderPreferences.targetLanguage ? .on : .off
                ) { [weak self] _ in
                    self?.renderPreferences.setTargetLanguage(option)
                    self?.renderPreferencesChanged()
                }
            }
        )

        preferencesButton.menu = UIMenu(children: [toneMenu, recipientMenu, sourceMenu, targetMenu])
    }

    private func renderPreferencesChanged() {
        cancelRenderWork()
        renderState.preferencesChanged()
        refreshPreferencesMenu()
        refreshViews()
        scheduleAutoRender()
    }

    private func renderPreferenceSnapshot() -> KeyboardRenderPreferenceSnapshot {
        KeyboardRenderPreferenceSnapshot(
            toneName: renderPreferences.tone.rawValue,
            sourceLanguage: renderPreferences.sourceLanguage.language,
            targetLanguage: renderPreferences.targetLanguage.language,
            recipientProfileName: renderPreferences.recipient.rawValue
        )
    }

    private func rebuildCharacterRows() {
        keysStack.arrangedSubviews.forEach { row in
            keysStack.removeArrangedSubview(row)
            row.removeFromSuperview()
        }

        let rows: [[String]]
        switch characterPage {
        case .letters:
            rows = [
                "qwertyuiop".map(String.init),
                "asdfghjkl".map(String.init),
                "zxcvbnm".map(String.init),
                ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"],
            ]
        case .numbers:
            rows = [
                "1234567890".map(String.init),
                [":", ";", "-", "/", "(", ")", "€", "$", "@"],
                ["+", "=", "_", "%", "&", "*", "#", "?", "!"],
                ["[", "]", "{", "}", "<", ">", "\"", "'", "\\"],
            ]
        }

        rows.forEach { symbols in
            let buttons = symbols.map { symbol in
                makeKeyButton(symbol) { [weak self] in
                    self?.append(symbol)
                }
            }
            keysStack.addArrangedSubview(makeRow(buttons))
        }

        pageButton.setTitle(characterPage == .letters ? "123" : "ABC", for: .normal)
    }

    private func makeBottomRow() -> UIStackView {
        let globe = makeKeyButton("🌐") {}
        globe.accessibilityLabel = "Next keyboard"
        globe.isHidden = !needsInputModeSwitchKey
        globe.addTarget(
            self,
            action: #selector(handleInputModeList(from:with:)),
            for: .allTouchEvents
        )

        pageButton.configuration = compactButtonConfiguration(filled: true)
        pageButton.configuration?.baseBackgroundColor = .secondarySystemBackground
        pageButton.configuration?.baseForegroundColor = .label
        pageButton.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        pageButton.addAction(UIAction { [weak self] _ in
            self?.toggleCharacterPage()
        }, for: .touchUpInside)

        let comma = makeKeyButton(",") { [weak self] in self?.append(",") }
        let space = makeKeyButton("space") { [weak self] in self?.append(" ") }
        let period = makeKeyButton(".") { [weak self] in self?.append(".") }
        let backspace = makeKeyButton("⌫") { [weak self] in self?.backspace() }

        enterButton.configuration = compactButtonConfiguration(filled: true)
        enterButton.configuration?.baseBackgroundColor = .secondarySystemBackground
        enterButton.configuration?.baseForegroundColor = .label
        enterButton.titleLabel?.adjustsFontSizeToFitWidth = true
        enterButton.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        enterButton.addAction(UIAction { [weak self] _ in
            self?.handleEnter()
        }, for: .touchUpInside)

        space.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return makeRow([globe, pageButton, comma, space, period, backspace, enterButton])
    }

    private func makeRow(_ views: [UIView]) -> UIStackView {
        let row = UIStackView(arrangedSubviews: views)
        row.axis = .horizontal
        row.spacing = 3
        row.distribution = .fillEqually
        row.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        return row
    }

    private func makeControlButton(_ title: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = compactButtonConfiguration(filled: false)
        button.setTitle(title, for: .normal)
        button.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func makeKeyButton(_ title: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = compactButtonConfiguration(filled: true)
        button.configuration?.baseBackgroundColor = .secondarySystemBackground
        button.configuration?.baseForegroundColor = .label
        button.setTitle(title, for: .normal)
        button.titleLabel?.adjustsFontSizeToFitWidth = true
        button.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 28).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func compactButtonConfiguration(filled: Bool) -> UIButton.Configuration {
        var configuration = filled ? UIButton.Configuration.filled() : UIButton.Configuration.bordered()
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 2, leading: 4, bottom: 2, trailing: 4)
        return configuration
    }

    private func toggleCharacterPage() {
        characterPage = characterPage == .letters ? .numbers : .letters
        rebuildCharacterRows()
        refreshCompactLayout()
    }

    private func append(_ text: String) {
        cancelRenderWork()
        renderState.append(text)
        refreshViews()
        scheduleAutoRender()
    }

    private func backspace() {
        guard !renderState.rawIntent.isEmpty else {
            textDocumentProxy.deleteBackward()
            return
        }

        cancelRenderWork()
        renderState.backspace()
        refreshViews()
        scheduleAutoRender()
    }

    private func handleEnter() {
        let requestedReturnKey = textDocumentProxy.returnKeyType ?? .default
        guard commitBuffer() else { return }
        textDocumentProxy.insertText("\n")
        if requestedReturnKey == .done {
            dismissKeyboard()
        }
    }

    @discardableResult
    private func commitBuffer() -> Bool {
        switch renderState.commitDecision() {
        case .nothing:
            return true
        case .output(let output):
            return commitOutput(output)
        case .previewRequired(let reverted):
            if !reverted && autoRenderTask == nil && renderTask == nil {
                scheduleAutoRender()
            }
            statusLabel.text = reverted
                ? "Preview reverted. Press Render, edit the draft, or switch to Raw."
                : "Preview is not ready yet. Wait, press Render, or switch to Raw."
            refreshCompactLayout()
            return false
        case .blockedUnsafePreview:
            statusLabel.text = "Commit blocked until protected values are preserved."
            refreshCompactLayout()
            return false
        }
    }

    private func commitOutput(_ output: String) -> Bool {
        let documentIdentifier = textDocumentProxy.documentIdentifier
        textDocumentProxy.insertText(output)

        if
            textDocumentProxy.documentIdentifier == documentIdentifier,
            let context = textDocumentProxy.documentContextBeforeInput,
            !context.isEmpty
        {
            let visibleTailLength = min(16, context.count, output.count)
            let visibleTail = String(output.suffix(visibleTailLength))

            if visibleTailLength > 0 && !context.hasSuffix(visibleTail) {
                statusLabel.text = "Commit rejected by host; draft kept."
                refreshCompactLayout()
                return false
            }
        }

        clearBuffer()
        statusLabel.text = "Committed."
        refreshCompactLayout()
        return true
    }

    private func cycleRegister() {
        cancelRenderWork()
        renderState.cycleRegister()
        refreshViews()
        scheduleAutoRender()
    }

    private func scheduleAutoRender() {
        autoRenderTask?.cancel()
        autoRenderTask = nil

        let preferences = renderPreferenceSnapshot()
        guard let request = renderState.autoRenderRequest(preferences: preferences) else {
            statusLabel.text = ""
            refreshCompactLayout()
            return
        }

        statusLabel.text = Self.statusPreviewPending
        refreshCompactLayout()

        autoRenderTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: Self.autoRenderDebounceNanoseconds)
            } catch {
                return
            }

            guard let self else { return }
            guard !Task.isCancelled else { return }
            guard renderState.isCurrent(
                request,
                preferences: renderPreferenceSnapshot()
            ) else { return }

            autoRenderTask = nil
            renderBuffer(fromAutoPreview: true)
        }
    }

    private func renderBuffer(fromAutoPreview: Bool = false) {
        if !fromAutoPreview {
            renderState.clearAutoRenderSuppression()
            autoRenderTask?.cancel()
            autoRenderTask = nil
        }

        let preferences = renderPreferenceSnapshot()
        guard let request = renderState.beginRender(preferences: preferences) else {
            statusLabel.text = ""
            refreshCompactLayout()
            return
        }

        renderTask?.cancel()
        statusLabel.text = Self.statusRendering
        refreshCompactLayout()

        renderTask = Task { [weak self] in
            guard let self else { return }
            defer {
                if renderState.generation == request.generation {
                    renderTask = nil
                }
            }

            do {
                let result = try await semanticBridge.render(
                    rawIntent: request.source,
                    registerName: request.registerName,
                    toneName: request.preferences.toneName,
                    sourceLanguage: request.preferences.sourceLanguage,
                    targetLanguage: request.preferences.targetLanguage,
                    recipientProfileName: request.preferences.recipientProfileName
                )

                guard !Task.isCancelled else { return }
                guard renderState.applyRender(
                    request,
                    text: result.text,
                    canCommit: result.canCommit,
                    preferences: renderPreferenceSnapshot()
                ) else { return }

                refreshViews()

                if !result.canCommit {
                    statusLabel.text = "Commit blocked: protected value changed."
                } else if let warning = result.warnings.first {
                    statusLabel.text = warning
                } else {
                    statusLabel.text = "Ready to commit."
                }
                refreshCompactLayout()
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                guard renderState.isCurrent(
                    request,
                    preferences: renderPreferenceSnapshot()
                ) else { return }
                statusLabel.text = "Render failed: \(error.localizedDescription)"
                refreshCompactLayout()
            }
        }
    }

    private func revertPreview() {
        guard renderState.hasCurrentPreview else {
            statusLabel.text = "No current preview to revert."
            refreshCompactLayout()
            return
        }

        cancelRenderWork()
        guard renderState.revertPreview() else { return }
        refreshViews()
        statusLabel.text = "Reverted to raw draft. Edit it or press Render to regenerate."
        refreshCompactLayout()
    }

    private func refreshHostContext() {
        let documentIdentifier = textDocumentProxy.documentIdentifier
        let documentChanged = activeDocumentIdentifier != nil && activeDocumentIdentifier != documentIdentifier

        if documentChanged && renderState.hasDraft {
            clearBuffer()
            statusLabel.text = "Draft cleared after switching text context."
        }

        activeDocumentIdentifier = documentIdentifier
        refreshReturnKey()
        refreshCompactLayout()
    }

    private func refreshReturnKey() {
        enterButton.setTitle(returnKeyLabel(textDocumentProxy.returnKeyType ?? .default), for: .normal)
    }

    private func returnKeyLabel(_ type: UIReturnKeyType) -> String {
        switch type {
        case .default: return "↵"
        case .go: return "Go"
        case .google: return "Google"
        case .join: return "Join"
        case .next: return "Next"
        case .route: return "Route"
        case .search: return "Search"
        case .send: return "Send"
        case .yahoo: return "Yahoo"
        case .done: return "Done"
        case .emergencyCall: return "SOS"
        case .continue: return "Continue"
        @unknown default: return "↵"
        }
    }

    private func cancelRenderWork() {
        autoRenderTask?.cancel()
        autoRenderTask = nil
        renderTask?.cancel()
        renderTask = nil
    }

    private func clearBuffer() {
        cancelRenderWork()
        renderState.clear()
        refreshViews()
    }

    private func refreshViews() {
        rawLabel.text = renderState.rawIntent.isEmpty
            ? "intent: …"
            : "intent: \(renderState.rawIntent)"
        previewLabel.text = renderState.renderedText.isEmpty
            ? "preview: …"
            : "preview: \(renderState.renderedText)"
        registerButton.setTitle(renderState.registerName.capitalized, for: .normal)
        revertButton.isEnabled = renderState.revertEnabled
        pageButton.setTitle(characterPage == .letters ? "123" : "ABC", for: .normal)
        refreshReturnKey()
        refreshCompactLayout()
    }

    private func refreshCompactLayout() {
        guard isViewLoaded else { return }
        let compactHeight = view.bounds.height > 0 && view.bounds.height < 260

        rootStack.spacing = compactHeight ? 2 : 4
        keysStack.spacing = compactHeight ? 2 : 3
        if compactHeight {
            rawLabel.isHidden = !renderState.renderedText.isEmpty || renderState.rawIntent.isEmpty
            previewLabel.isHidden = renderState.renderedText.isEmpty
            statusLabel.isHidden = statusLabel.text?.isEmpty != false
        } else {
            rawLabel.isHidden = false
            previewLabel.isHidden = false
            statusLabel.isHidden = false
        }
    }
}
