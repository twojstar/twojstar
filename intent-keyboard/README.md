# Intent Keyboard

> Working name and early-stage experiment.

A semantic input layer that treats what the user types as **intent**, not as final copy.

Write fast, broken, abbreviated, multilingual or "caveman" text and render it into a clean message without changing the intended meaning.

```text
raw intent
    ↓
semantic cleanup
    ↓
tone / register / recipient context
    ↓
optional translation
    ↓
platform text input
```

Example:

```text
jutro chyba byc 18 nie wiem jeszcze
```

can eventually become:

```text
Jutro powinienem być około 18:00, ale jeszcze nie mam pewności.
```

## Goals

- Treat the original input as the source of truth.
- Fix spelling, grammar, word order and punctuation semantically rather than word-by-word.
- Render the same intent into different tones, recipient contexts and languages.
- Preserve protected facts with semantic locks, such as dates, prices, names and exact literals.
- Keep the transformation engine platform-independent.
- Prefer local/on-device processing where practical, with provider adapters for optional remote models.
- Make every transformation inspectable and reversible before sending.

## Multiplatform from day one

The shared engine lives in Kotlin Multiplatform `commonMain` code. Platform integrations are deliberately thin:

- **Android**: system IME using `InputMethodService`.
- **iOS/iPadOS**: Keyboard Extension using `UIInputViewController`.
- **Desktop**: JVM/Swing companion proof with an explicit clipboard output boundary; OS-specific insertion remains adapter-specific.

The keyboard UI and operating-system hooks stay platform-specific. Intent parsing, rendering contracts, tone/recipient profiles, translation routing and lock validation belong in the shared core.

See [`docs/concept.md`](docs/concept.md) for the architecture and MVP boundary. The repeatable Android real-device performance/quality gate lives in [`docs/android-local-benchmark.md`](docs/android-local-benchmark.md).

## Current prototype

The first Android slice is now real rather than a mock app:

1. Install the debug APK produced by `Intent keyboard CI`.
2. Open **Intent Keyboard** and install the recommended offline model, or import another `.litertlm` model manually.
3. Optionally choose a semantic tone, recipient preset and source/target language hints in the setup screen. These presentation settings stay independent from the register and persist locally on the device.
4. Optionally configure an OpenAI-compatible remote provider. Remote fallback is disabled by default and must be explicitly enabled.
5. Enable the keyboard in Android settings and choose it from the system input-method picker.
6. Type rough text into the keyboard's private intent buffer.
7. Pick `Raw`, `Natural` or `Civilized`; `Natural` and `Civilized` refresh the semantic preview automatically after a short typing pause. **Render** forces an immediate refresh, **Revert** returns an uncommitted preview to the raw draft, and **Commit** inserts the current safe output into the host app.

The Android preview uses trailing-edge debounce rather than starting inference on every keypress. Stale renders are cancelled or ignored, and `LocalSemanticRuntime` serializes access to the native engine so only one LiteRT-LM inference owns it at a time. RAW mode does not schedule semantic auto-rendering. Semantic tone/language/recipient preferences are read for each render, so changing presentation settings never replaces the raw intent source. The mechanical fallback remains intentionally limited and may not realize tone, recipient context or translation requests without a model-backed renderer.

Revert is deliberately pre-commit only. It restores the unchanged raw draft, suppresses automatic re-rendering of that exact version, and keeps the selected register/settings intact. Editing the draft, changing render settings/register, or pressing Render allows a new preview. Android restores its owned host composing region to raw before discarding the preview; if that restoration fails, the rendered preview is kept instead of letting keyboard and host state diverge. Draft/preview history is process-local and short-lived, and Commit clears it rather than creating a persistent undo log.

`MechanicalRenderer` remains the deterministic local fallback. The shared core also contains a real model-backed path:

- `SemanticPromptCompiler` converts a `RenderRequest` into strict model instructions plus untrusted source input.
- `ModelSemanticRenderer` turns provider output back into the normal semantic pipeline.
- `OpenAiCompatibleCompletionClient` talks to configurable Chat Completions-compatible endpoints over Ktor.
- OkHttp, Darwin and CIO engines keep the transport available across Android, iOS and desktop targets.

Android can now use a local LiteRT-LM 0.16.1 model end to end:

- The setup screen offers a managed install of a compact Qwen3 0.6B INT4 no-think model from the LiteRT Community catalog under Apache-2.0, while manual `.litertlm` import remains available as an advanced path.
- Managed model metadata lives in `ManagedModelCatalog`; the download is pinned to an immutable upstream revision, expected byte count and SHA-256 rather than a moving `main` URL.
- Managed downloads use HTTPS-only redirects, expose progress and cancellation, verify the complete file, then run a tiny local LiteRT-LM inference smoke test before activation.
- A cancelled, corrupted or incompatible download never replaces the current local model.
- The setup screen imports user-selected `.litertlm` documents into app-private storage; source URIs are not retained.
- `LocalModelStore` is the single source of truth for the selected local model and preserves the last known good selection until a replacement initializes successfully.
- `LocalSemanticRuntime` watches that selection, loads the model on the CPU off the main thread and swaps renderers without closing an engine underneath an in-flight render.
- `LiteRtLmCompletionClient` implements the same provider-neutral semantic completion contract as remote adapters and currently caps each local conversation at 512 output tokens, while leaving the engine context/KV-cache at LiteRT-LM defaults until real-device measurements justify tuning it.
- Each render uses a fresh conversation, so previous keyboard drafts are not inherited as chat history.
- The keyboard shows whether it is using the mechanical fallback, loading a model, or rendering with the selected local model.

The setup screen also exposes process-local runtime diagnostics for actual keyboard renders: successful/failed local samples, median and p95 latency, last latency and last input/output character counts. The collector keeps at most 20 successful timings in memory, stores no draft/completion text, writes nothing to disk and can be reset manually. Installer smoke tests, mechanical renders and remote renders do not count as successful local samples.

Remote rendering keeps the same semantic pipeline rather than creating a translation-only path. A ready local model is always attempted first. If no local model is ready, or local rendering fails, an explicitly enabled remote provider may be used. Successful remote renders carry an on-keyboard warning that draft text left the device; failed remote attempts warn that the draft may have left the device before the runtime degrades mechanically.

Remote configuration stores only enablement, HTTPS base URL and model name as ordinary app-private preferences. An optional bearer token is encrypted with an AES-GCM key held by Android Keystore; the plaintext token is never written to preferences, source, APK metadata or logs, and the setup UI never reads the stored token back into the field. `android:allowBackup="false"` remains set for the application.

No model is bundled in the repository or APK. The runtime prunes obsolete private model copies only after releasing any engine that could still reference them. Local processing remains the default.

Regardless of provider, the model does not get the final word: exact time/money locks are validated again after rendering, and an unsafe preview cannot be committed. Sensitive/password fields bypass semantic buffering entirely.

Translation already travels through this same register/tone/recipient/language/lock pipeline. Real-device quality validation for the managed local Qwen model remains a separate gate before claiming local translation quality broadly.

The desktop proof now exercises the same core from a JVM/Swing companion app. `DesktopIntentSession` keeps raw/register/preview state short-lived, rejects stale late renders, and allows output only when the current shared-pipeline result is safe. The first `DesktopTextSink` copies output to the system clipboard after an explicit **Copy** action; it does not inject text into another app, install a native input method, register global keyboard hooks or monitor clipboard contents. CI tests the session and publishes a portable desktop ZIP. See [`platforms/desktop/README.md`](platforms/desktop/README.md).

## Project layout

```text
intent-keyboard/
├── core/                 # shared semantic contracts, locks, prompts and providers
├── platforms/
│   ├── android/          # installable Android IME prototype
│   ├── ios/              # iOS/iPadOS keyboard extension + setup host
│   └── desktop/          # JVM/Swing companion + explicit clipboard sink
├── docs/
└── gradle/
```

## License

Covered by the repository-level [ISC License](../LICENSE). Downloaded third-party model artifacts retain their own upstream licenses; the managed model source and license are linked from the Android setup screen.
