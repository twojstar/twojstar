# iOS / iPadOS adapter

This directory contains the first native keyboard-extension adapter for the shared Intent Keyboard core.

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

The iOS prototype mirrors the trustworthy Android flow instead of introducing a second UX model:

1. type into a private intent buffer,
2. choose `Raw`, `Natural` or `Civilized`,
3. press **Render**,
4. inspect the preview,
5. press **Commit** to insert the result through `textDocumentProxy`.

Backspace edits the private buffer first and falls through to the host text field when the buffer is empty. The globe key switches to the next enabled keyboard.

## Privacy boundary

`RequestsOpenAccess` is `false`.

The first iOS slice therefore does not request Full Access, does not use remote providers, and does not write configuration into an app-group container. The Swift adapter delegates semantic rendering and lock validation to the shared Kotlin core.

Remote providers, shared model/configuration storage, live/debounced rendering and recipient-aware behavior remain later slices.
