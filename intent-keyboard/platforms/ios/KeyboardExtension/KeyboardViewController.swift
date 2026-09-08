import IntentKeyboardCore
import UIKit

final class KeyboardViewController: UIInputViewController {
    private enum CharacterPage {
        case letters
        case numbers
    }

    private let semanticBridge = IosSemanticBridge()
    private let registerNames = ["RAW", "NATURAL", "CIVILIZED"]

    private var rawIntent = ""
    private var renderedSource = ""
    private var renderedText = ""
    private var renderedCanCommit = true
    private var registerIndex = 1
    private var characterPage = CharacterPage.letters
    private var renderTask: Task<Void, Never>?
    private var activeDocumentIdentifier: UUID?

    private let rawLabel = UILabel()
    private let previewLabel = UILabel()
    private let statusLabel = UILabel()
    private let registerButton = UIButton(type: .system)
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

        let renderButton = makeControlButton("Render") { [weak self] in
            self?.renderBuffer()
        }
        let commitButton = makeControlButton("Commit") { [weak self] in
            self?.commitBuffer()
        }

        let toolbar = makeRow([registerButton, renderButton, commitButton])

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
        rawIntent.append(text)
        invalidateRenderedPreview()
        refreshViews()
    }

    private func backspace() {
        if rawIntent.isEmpty {
            textDocumentProxy.deleteBackward()
            return
        }

        rawIntent.removeLast()
        invalidateRenderedPreview()
        refreshViews()
    }

    private func handleEnter() {
        let requestedReturnKey = textDocumentProxy.returnKeyType
        guard commitBuffer() else { return }
        textDocumentProxy.insertText("\n")
        if requestedReturnKey == .done {
            dismissKeyboard()
        }
    }

    @discardableResult
    private func commitBuffer() -> Bool {
        guard !rawIntent.isEmpty else { return true }

        let hasCurrentPreview = renderedSource == rawIntent && !renderedText.isEmpty
        if hasCurrentPreview && !renderedCanCommit {
            statusLabel.text = "Commit blocked until protected values are preserved."
            return false
        }

        let output = hasCurrentPreview ? renderedText : rawIntent
        let documentIdentifier = textDocumentProxy.documentIdentifier
        textDocumentProxy.insertText(output)

        let insertionConfirmed =
            textDocumentProxy.documentIdentifier == documentIdentifier &&
            textDocumentProxy.documentContextBeforeInput?.hasSuffix(output) == true

        guard insertionConfirmed else {
            statusLabel.text = "Commit not confirmed by host; draft kept."
            refreshCompactLayout()
            return false
        }

        clearBuffer()
        statusLabel.text = "Committed."
        refreshCompactLayout()
        return true
    }

    private func cycleRegister() {
        registerIndex = (registerIndex + 1) % registerNames.count
        invalidateRenderedPreview()
        refreshViews()
    }

    private func renderBuffer() {
        guard !rawIntent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        renderTask?.cancel()
        let source = rawIntent
        let registerName = registerNames[registerIndex]
        statusLabel.text = "Rendering…"
        refreshCompactLayout()

        renderTask = Task { [weak self] in
            guard let self else { return }

            do {
                let result = try await semanticBridge.render(
                    rawIntent: source,
                    registerName: registerName
                )

                guard !Task.isCancelled else { return }
                guard source == rawIntent else { return }
                guard registerName == registerNames[registerIndex] else { return }

                renderedSource = source
                renderedText = result.text
                renderedCanCommit = result.canCommit
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
                statusLabel.text = "Render failed: \(error.localizedDescription)"
                refreshCompactLayout()
            }
        }
    }

    private func refreshHostContext() {
        let documentIdentifier = textDocumentProxy.documentIdentifier
        let documentChanged = activeDocumentIdentifier != nil && activeDocumentIdentifier != documentIdentifier
        let hasDraft = !rawIntent.isEmpty || !renderedText.isEmpty

        if documentChanged && hasDraft {
            clearBuffer()
            statusLabel.text = "Draft cleared after switching text context."
        }

        activeDocumentIdentifier = documentIdentifier
        refreshReturnKey()
        refreshCompactLayout()
    }

    private func refreshReturnKey() {
        enterButton.setTitle(returnKeyLabel(textDocumentProxy.returnKeyType), for: .normal)
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

    private func invalidateRenderedPreview() {
        renderTask?.cancel()
        renderTask = nil
        renderedSource = ""
        renderedText = ""
        renderedCanCommit = true
    }

    private func clearBuffer() {
        rawIntent = ""
        invalidateRenderedPreview()
        refreshViews()
    }

    private func refreshViews() {
        rawLabel.text = rawIntent.isEmpty ? "intent: …" : "intent: \(rawIntent)"
        previewLabel.text = renderedText.isEmpty ? "preview: …" : "preview: \(renderedText)"
        registerButton.setTitle(registerNames[registerIndex].capitalized, for: .normal)
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
            rawLabel.isHidden = !renderedText.isEmpty || rawIntent.isEmpty
            previewLabel.isHidden = renderedText.isEmpty
            statusLabel.isHidden = statusLabel.text?.isEmpty != false
        } else {
            rawLabel.isHidden = false
            previewLabel.isHidden = false
            statusLabel.isHidden = false
        }
    }
}
