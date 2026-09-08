import IntentKeyboardCore
import UIKit

final class KeyboardViewController: UIInputViewController {
    private let semanticBridge = IosSemanticBridge()
    private let registerNames = ["RAW", "NATURAL", "CIVILIZED"]

    private var rawIntent = ""
    private var renderedSource = ""
    private var renderedText = ""
    private var renderedCanCommit = true
    private var registerIndex = 1
    private var renderTask: Task<Void, Never>?

    private let rawLabel = UILabel()
    private let previewLabel = UILabel()
    private let statusLabel = UILabel()
    private let registerButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        refreshViews()
    }

    override func viewWillDisappear(_ animated: Bool) {
        renderTask?.cancel()
        renderTask = nil
        super.viewWillDisappear(animated)
    }

    private func configureView() {
        view.backgroundColor = .systemBackground

        rawLabel.font = .preferredFont(forTextStyle: .footnote)
        rawLabel.numberOfLines = 2

        previewLabel.font = .preferredFont(forTextStyle: .body)
        previewLabel.numberOfLines = 2

        statusLabel.font = .preferredFont(forTextStyle: .caption2)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 2

        registerButton.configuration = .bordered()
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

        let root = UIStackView(arrangedSubviews: [
            rawLabel,
            previewLabel,
            toolbar,
            makeLetterRow("qwertyuiop"),
            makeLetterRow("asdfghjkl"),
            makeLetterRow("zxcvbnm"),
            makePolishRow(),
            makeBottomRow(),
            statusLabel,
        ])
        root.axis = .vertical
        root.spacing = 6
        root.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
        ])
    }

    private func makeLetterRow(_ letters: String) -> UIStackView {
        let buttons = letters.map { character in
            makeKeyButton(String(character)) { [weak self] in
                self?.append(String(character))
            }
        }
        return makeRow(buttons)
    }

    private func makePolishRow() -> UIStackView {
        let buttons = ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"].map { character in
            makeKeyButton(character) { [weak self] in
                self?.append(character)
            }
        }
        return makeRow(buttons)
    }

    private func makeBottomRow() -> UIStackView {
        let globe = makeKeyButton("🌐") { [weak self] in
            self?.advanceToNextInputMode()
        }
        globe.accessibilityLabel = "Next keyboard"

        let comma = makeKeyButton(",") { [weak self] in self?.append(",") }
        let space = makeKeyButton("space") { [weak self] in self?.append(" ") }
        let period = makeKeyButton(".") { [weak self] in self?.append(".") }
        let backspace = makeKeyButton("⌫") { [weak self] in self?.backspace() }
        let enter = makeKeyButton("↵") { [weak self] in self?.handleEnter() }

        space.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return makeRow([globe, comma, space, period, backspace, enter])
    }

    private func makeRow(_ views: [UIView]) -> UIStackView {
        let row = UIStackView(arrangedSubviews: views)
        row.axis = .horizontal
        row.spacing = 4
        row.distribution = .fillEqually
        return row
    }

    private func makeControlButton(_ title: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = .bordered()
        button.setTitle(title, for: .normal)
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func makeKeyButton(_ title: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.configuration = .filled()
        button.configuration?.baseBackgroundColor = .secondarySystemBackground
        button.configuration?.baseForegroundColor = .label
        button.setTitle(title, for: .normal)
        button.titleLabel?.adjustsFontSizeToFitWidth = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 38).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
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
        guard commitBuffer() else { return }
        textDocumentProxy.insertText("\n")
    }

    @discardableResult
    private func commitBuffer() -> Bool {
        guard !rawIntent.isEmpty else { return true }

        let hasCurrentPreview = renderedSource == rawIntent && !renderedText.isEmpty
        if hasCurrentPreview && !renderedCanCommit {
            statusLabel.text = "Commit blocked until protected values are preserved."
            return false
        }

        textDocumentProxy.insertText(hasCurrentPreview ? renderedText : rawIntent)
        clearBuffer()
        statusLabel.text = "Committed."
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
                statusLabel.text = result.canCommit
                    ? "Ready to commit."
                    : "Commit blocked: protected value changed."
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                statusLabel.text = "Render failed: \(error.localizedDescription)"
            }
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
    }
}
