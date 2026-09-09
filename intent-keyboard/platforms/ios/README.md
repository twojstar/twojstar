# iOS / iPadOS adapter

This directory contains the native keyboard-extension adapter for the shared Intent Keyboard core.

The checked-in source of truth is [`project.yml`](project.yml). The generated `IntentKeyboard.xcodeproj` is intentionally not committed.

## Build

From `intent-keyboard/`:

```sh
gradle :core:assembleIntentKeyboardCoreDebugXCFramework --stacktrace
brew install xcodegen
xcodegen generate --spec platforms/ios/project.yml --project platforms/ios
open platforms/ios/IntentKeyboard.xcodeproj
```

The project contains:

- `IntentKeyboardHost`: a minimal setup app explaining how to enable the keyboard.
- `IntentKeyboardExtension`: a `UIInputViewController` keyboard extension using the shared Kotlin semantic pipeline.
- `IntentKeyboardCore.xcframework`: a static Kotlin Multiplatform framework assembled from `iosArm64` and `iosSimulatorArm64`.

## Current interaction

The iOS prototype mirrors the safe live-preview behavior of the Android adapter while keeping platform text plumbing deliberately conservative:

1. type into the keyboard extension's private intent buffer,
2. choose `Raw`, `Natural` or `Civilized`,
3. optionally open **Prefs** and choose tone, recipient context and source/target language,
4. `Natural` and `Civilized` schedule a semantic preview after a 450 ms trailing-edge debounce; `Raw` never auto-renders,
5. **Render** cancels any pending debounce and forces an immediate preview,
6. inspect the preview and any lock/fallback warning,
7. **Revert** discards the current uncommitted preview while preserving the raw draft and selected register/settings,
8. **Commit** inserts the current safe preview through `textDocumentProxy`.

Tone, recipient and language preferences persist in the keyboard extension's own `UserDefaults`. Changing any render preference cancels pending work, invalidates the current preview and schedules a fresh render for the unchanged raw draft. Every asynchronous render captures a preference snapshot and late results are ignored unless source text, register, settings and render generation still match.

The Swift adapter passes those preferences through `IosSemanticBridge` into the same shared `RenderRequest` used by the semantic core. The current iOS bridge still uses `MechanicalRenderer`, so tone, recipient-context or translation requests currently produce the normal mechanical fallback warnings instead of pretending that semantic changes happened. A model-backed iOS renderer remains a separate runtime follow-up.

Changing the draft or register also cancels the previous render and invalidates its preview. In `Natural` or `Civilized`, Commit is blocked until a current preview exists; it never silently falls back to committing stale or unrendered raw text. `Raw` remains an explicit direct-commit mode, and whitespace-only input can still be committed without waiting for a semantic render.

After Revert, automatic rendering is suppressed for that exact unchanged draft so the preview does not immediately reappear after the debounce. Editing the draft, changing register/settings, or pressing Render clears that suppression and allows regeneration. Revert only applies before Commit: the extension keeps no persistent sent-text history or post-commit undo mechanism.

Backspace edits the private buffer first and falls through to the host text field when the buffer is empty. Switching to another text-document context clears an unsent draft. The globe key switches to the next enabled keyboard.

This slice does **not** mirror the private draft or preview into host marked/composing text. Unlike Android's composing-region ownership path, the iOS extension touches host content only at Commit time. Marked-text ownership can be evaluated separately against real editors instead of being coupled to live-preview scheduling.

## Privacy boundary

`RequestsOpenAccess` is `false`.

The iOS keyboard therefore has no network access and cannot write to a shared app-group container. It does not use remote providers. The Swift adapter delegates rendering and lock validation to the shared Kotlin core, keeps the current draft in extension memory only and stores only non-secret render preferences in the extension's own local `UserDefaults`.

Because `UserDefaults` is a Required Reason API, `KeyboardExtension/PrivacyInfo.xcprivacy` declares `NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`: app-local settings accessible only to this extension. No tracking or collected-data categories are declared.

A model-backed iOS runtime and any feature that genuinely needs networking or a writable shared container remain separate follow-ups rather than hidden dependencies of the current keyboard path.
