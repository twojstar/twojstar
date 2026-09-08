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

Desktop is a target for the shared core immediately, but system-wide text insertion is deliberately left adapter-specific.

Possible frontends:

- native input method,
- accessibility-based insertion,
- companion overlay / command palette,
- editor/plugin bridges.

The first desktop proof should validate the semantic engine and UX, not force one lowest-common-denominator keyboard abstraction across Windows, macOS and Linux.

## Non-goal

Do not duplicate semantic rewriting, translation routing, tone profiles or lock validation in platform code. Platform adapters should be boring plumbing. Boring plumbing is good plumbing.
