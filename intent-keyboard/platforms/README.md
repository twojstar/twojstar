# Platform adapters

The semantic engine is shared; text-system integration is not.

## Android

Current first executable adapter.

- `InputMethodService` owns keyboard lifecycle.
- `InputConnection` inserts committed text and handles editor actions.
- A private intent buffer keeps rough source text separate from the host field until commit.
- Shared `SemanticPipeline` receives the raw intent and returns the rendered text.
- The adapter never sends text to a provider on its own; provider policy stays behind the semantic runtime.

Interaction remains explicit (`Render` → inspect → `Commit`) before experimenting with debounced live replacement. Cursor/selection correctness matters more than visual cleverness.

## iOS / iPadOS

Current second mobile adapter.

- `UIInputViewController` hosts the keyboard extension.
- `textDocumentProxy` inserts committed text and handles host-side deletion.
- `IntentKeyboardCore.xcframework` exports the same Kotlin Multiplatform core used by Android.
- A tiny Swift-facing bridge keeps register parsing, automatic locks and integrity validation in shared Kotlin code.
- `RequestsOpenAccess` is `false`, so the first extension does not request network or shared-container write access.
- [`ios/project.yml`](ios/project.yml) is the maintained XcodeGen source; generated Xcode project files stay out of Git.

The iOS adapter consumes the same semantic pipeline and render result contract rather than duplicating transformation rules in Swift.

## Desktop

The first desktop proof is a JVM/Swing companion app over the existing `jvm("desktop")` core target.

- `DesktopIntentSession` owns only short-lived draft/register/preview state and delegates rendering/locks to the shared core.
- revision and render-sequence guards prevent late results from replacing newer drafts,
- `Revert` drops an uncommitted preview without deleting the raw draft,
- `SystemClipboardTextSink` publishes safe output only after an explicit **Copy** action,
- CI tests the session and builds a portable application ZIP.

The proof deliberately does **not** install a native input method, inject through accessibility APIs, register global keyboard hooks or monitor the clipboard. Those mechanisms differ materially between Windows, macOS and Linux and should be evaluated as separate adapters after the companion UX is proven.

See [`desktop/README.md`](desktop/README.md) for run/build instructions and the exact output boundary.

## Non-goal

Do not duplicate semantic rewriting, translation routing, tone profiles or lock validation in platform code. Platform adapters should be boring plumbing. Boring plumbing is good plumbing.
