# Platform adapters

The semantic engine is shared; text-system integration is not.

## Android

The Android adapter is an installable system IME.

- `InputMethodService` owns keyboard lifecycle.
- `InputConnection` mirrors the keyboard-owned draft through composing text, inserts committed text and handles editor actions.
- A private intent buffer keeps the raw source separate from the rendered preview.
- `Natural` and `Civilized` use debounced live preview; stale results are cancelled/ignored.
- Shared `SemanticPipeline` receives the raw intent and returns the rendered text.
- `HostCompositionPolicy` centralizes tested cursor/selection/ownership decisions.
- Local LiteRT-LM is preferred; an explicitly enabled remote provider may be used through a tested fallback/disclosure policy.
- Sensitive/password fields bypass semantic buffering and composing ownership.

CI covers the pure composition and fallback policies plus APK assembly. Real `InputConnection` behavior still needs the physical matrix in [`../docs/android-editor-matrix.md`](../docs/android-editor-matrix.md); model performance/quality uses [`../docs/android-local-benchmark.md`](../docs/android-local-benchmark.md).

## iOS / iPadOS

The iOS adapter is a native Keyboard Extension with a small setup host.

- `UIInputViewController` hosts the keyboard extension.
- `textDocumentProxy` inserts committed text and handles host-side deletion.
- `IntentKeyboardCore.xcframework` exports the same Kotlin Multiplatform core used by Android.
- `IosSemanticBridge` keeps register parsing, render settings, automatic locks and integrity validation in shared Kotlin code.
- debounced preview, stale-result guards, safe Commit and pre-commit Revert are implemented,
- tone, recipient and source/target language preferences persist in extension-local `UserDefaults`,
- `RequestsOpenAccess` is `false`, so the current extension does not request network or shared-container write access,
- [`ios/project.yml`](ios/project.yml) is the maintained XcodeGen source; generated Xcode project files stay out of Git.

The current iOS bridge still uses the deterministic mechanical renderer. Semantic settings therefore surface fallback warnings rather than pretending that model-backed tone/translation happened.

## Desktop

The desktop proof is a JVM/Swing companion app over the existing `jvm("desktop")` core target.

- `DesktopIntentSession` owns short-lived draft/register/tone/recipient/language/preview state and delegates rendering/locks to the shared core,
- revision, render-sequence and settings-snapshot guards prevent late results from replacing newer state,
- `Revert` drops an uncommitted preview without deleting the raw draft or render settings,
- `SystemClipboardTextSink` publishes safe output only after an explicit **Copy** action,
- CI tests the session and builds a portable application ZIP.

The proof deliberately does **not** install a native input method, inject through accessibility APIs, register global keyboard hooks or monitor the clipboard. Those mechanisms differ materially between Windows, macOS and Linux and remain separate adapters if pursued later.

See [`desktop/README.md`](desktop/README.md) for run/build instructions and the exact output boundary.

## Non-goal

Do not duplicate semantic rewriting, translation routing, tone/recipient profiles or lock validation in platform code. Platform adapters should be boring plumbing. Boring plumbing is good plumbing.
