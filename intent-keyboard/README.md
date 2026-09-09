# Intent Keyboard

> Working name and early-stage experiment.

A semantic input layer that treats what the user types as **intent**, not as final copy.

Write fast, broken, abbreviated, multilingual or "caveman" text and render it into a clean message without changing the intended meaning.

```text
raw intent
    ↓
semantic cleanup
    ↓
tone / register
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
- Render the same intent into different tones and languages.
- Preserve protected facts with semantic locks, such as dates, prices, names and exact literals.
- Keep the transformation engine platform-independent.
- Prefer local/on-device processing where practical, with provider adapters for optional remote models.
- Make every transformation inspectable and reversible before sending.

## Multiplatform from day one

The shared engine lives in Kotlin Multiplatform `commonMain` code. Platform integrations are deliberately thin:

- **Android**: system IME using `InputMethodService`.
- **iOS/iPadOS**: Keyboard Extension using `UIInputViewController`.
- **Desktop**: native/system text-input adapter or companion insertion layer, explored after the mobile paths are proven.

The keyboard UI and operating-system hooks stay platform-specific. Intent parsing, rendering contracts, tone profiles, translation routing and lock validation belong in the shared core.

See [`docs/concept.md`](docs/concept.md) for the architecture and MVP boundary.

## Current prototype

The first Android slice is now real rather than a mock app:

1. Install the debug APK produced by `Intent keyboard CI`.
2. Open **Intent Keyboard** and install the recommended offline model, or import another `.litertlm` model manually.
3. Optionally choose a semantic tone plus source/target language hints in the setup screen. Tone stays independent from the register, and the settings persist locally on the device.
4. Optionally configure an OpenAI-compatible remote provider. Remote fallback is disabled by default and must be explicitly enabled.
5. Enable the keyboard in Android settings and choose it from the system input-method picker.
6. Type rough text into the keyboard's private intent buffer.
7. Pick `Raw`, `Natural` or `Civilized`; `Natural` and `Civilized` refresh the semantic preview automatically after a short typing pause. **Render** forces an immediate refresh, and **Commit** inserts the current safe preview into the host app.

The Android preview uses trailing-edge debounce rather than starting inference on every keypress. Stale renders are cancelled or ignored, and `LocalSemanticRuntime` serializes access to the native engine so only one LiteRT-LM inference owns it at a time. RAW mode does not schedule semantic auto-rendering. Semantic tone/language preferences are read for each render, so changing presentation settings never replaces the raw intent source. The mechanical fallback remains intentionally limited and may not realize tone or translation requests without a model-backed renderer.

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
- `LiteRtLmCompletionClient` implements the same provider-neutral semantic completion contract as remote adapters.
- Each render uses a fresh conversation, so previous keyboard drafts are not inherited as chat history.
- The keyboard shows whether it is using the mechanical fallback, loading a model, or rendering with the selected local model.

Remote rendering keeps the same semantic pipeline rather than creating a translation-only path. A ready local model is always attempted first. If no local model is ready, or local rendering fails, an explicitly enabled remote provider may be used. Every remote-backed result carries an on-keyboard warning that draft text left the device. If the remote request also fails, the runtime falls back mechanically and keeps the draft available.

Remote configuration stores only enablement, HTTPS base URL and model name as ordinary app-private preferences. An optional bearer token is encrypted with an AES-GCM key held by Android Keystore; the plaintext token is never written to preferences, source, APK metadata or logs, and the setup UI never reads the stored token back into the field. `android:allowBackup="false"` remains set for the application.

No model is bundled in the repository or APK. The runtime prunes obsolete private model copies only after releasing any engine that could still reference them. Local processing remains the default.

Regardless of provider, the model does not get the final word: exact time/money locks are validated again after rendering, and an unsafe preview cannot be committed. Sensitive/password fields bypass semantic buffering entirely.

Translation already travels through this same register/tone/language/lock pipeline. Real-device quality validation for the managed local Qwen model remains a separate gate before claiming local translation quality broadly.

## Project layout

```text
intent-keyboard/
├── core/                 # shared semantic contracts, locks, prompts and providers
├── platforms/
│   ├── android/          # installable Android IME prototype
│   └── ios/              # iOS/iPadOS keyboard extension + setup host
├── docs/
└── gradle/
```

## License

Covered by the repository-level [ISC License](../LICENSE). Downloaded third-party model artifacts retain their own upstream licenses; the managed model source and license are linked from the Android setup screen.
