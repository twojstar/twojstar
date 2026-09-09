# Desktop companion proof

The first desktop adapter is intentionally a small JVM/Swing companion rather than a fake cross-platform IME.

It proves the shared semantic workflow on Windows, macOS and Linux without taking control of other applications:

1. type or paste a raw intent,
2. choose `Raw`, `Natural` or `Civilized`,
3. press **Render** and inspect the current preview/warnings,
4. press **Revert** to discard that uncommitted preview while keeping the raw draft,
5. press **Copy** only when the current output is safe, then paste it into the target application yourself.

`DesktopIntentSession` owns draft/register/preview state and calls the existing shared `SemanticPipeline`, `MechanicalRenderer` and `ConservativeLockDetector`. A late render cannot replace a newer draft because every render is guarded by the session revision and render sequence.

`SystemClipboardTextSink` is the only platform output boundary in this slice. It runs only after an explicit Copy action. There is no accessibility injection, global keyboard hook, native input method, background clipboard monitoring or persistent draft history.

The current desktop renderer is the same deterministic mechanical prototype used by the shared core. Model-backed desktop providers and OS-specific insertion adapters remain later slices rather than hidden dependencies of this proof.

## Run

From `intent-keyboard/` with Java 17 available:

```sh
gradle :platforms:desktop:run
```

Build the portable application distribution with:

```sh
gradle :platforms:desktop:test :platforms:desktop:distZip
```

CI publishes the resulting ZIP as the `intent-keyboard-desktop` artifact.
