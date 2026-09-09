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

The iOS prototype now mirrors the safe live-preview behavior of the Android adapter while keeping platform text plumbing deliberately conservative:

1. type into the keyboard extension's private intent buffer,
2. choose `Raw`, `Natural` or `Civilized`,
3. `Natural` and `Civilized` schedule a semantic preview after a 450 ms trailing-edge debounce; `Raw` never auto-renders,
4. **Render** cancels any pending debounce and forces an immediate preview,
5. inspect the preview and any lock/fallback warning,
6. **Commit** inserts the current safe preview through `textDocumentProxy`.

Changing the draft or register cancels the previous render and invalidates its preview. Late results are ignored unless their source text, register and render generation still match the current draft. In `Natural` or `Civilized`, Commit is blocked until a current preview exists; it never silently falls back to committing stale or unrendered raw text. `Raw` remains an explicit direct-commit mode, and whitespace-only input can still be committed without waiting for a semantic render.

Backspace edits the private buffer first and falls through to the host text field when the buffer is empty. Switching to another text-document context clears an unsent draft. The globe key switches to the next enabled keyboard.

This slice does **not** mirror the private draft or preview into host marked/composing text. Unlike Android's composing-region ownership path, the iOS extension touches host content only at Commit time. Marked-text ownership can be evaluated separately against real editors instead of being coupled to live-preview scheduling.

## Privacy boundary

`RequestsOpenAccess` is `false`.

The iOS keyboard therefore does not have network access or write access to a shared app-group container. It does not use remote providers. The Swift adapter delegates rendering and lock validation to the shared Kotlin core and keeps the current draft in extension memory only.

The current iOS bridge still uses the deterministic local mechanical renderer. A model-backed iOS runtime, shared tone/language/recipient settings and any capability requiring Full Access remain separate follow-ups rather than hidden dependencies of the live-preview path.
