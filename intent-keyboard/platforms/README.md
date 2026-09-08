# Platform adapters

The semantic engine is shared; text-system integration is not.

## Android

Planned first executable adapter.

- `InputMethodService` owns keyboard lifecycle.
- `InputConnection` reads/replaces composing text.
- Shared `SemanticPipeline` receives the raw intent and returns the rendered text.
- The adapter must never send text to a provider on its own; provider policy belongs above the platform bridge.

Initial interaction should be explicit (`Render`) before experimenting with debounced live replacement. Cursor/selection correctness matters more than visual cleverness.

## iOS / iPadOS

Second mobile adapter.

- `UIInputViewController` hosts the keyboard extension.
- `textDocumentProxy` inserts/deletes the rendered result.
- Shared core is exported from Kotlin Multiplatform for Swift consumption.
- Features that require Full Access must be isolated and clearly disclosed.

The iOS adapter should consume the same `RenderRequest` / `RenderResult` contract used on Android.

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
