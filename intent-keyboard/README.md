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
2. Open **Intent Keyboard** and enable it in Android keyboard settings.
3. Choose it from the system input-method picker.
4. Type rough text into the keyboard's private intent buffer.
5. Pick `Raw`, `Natural` or `Civilized`, press **Render**, inspect the preview, then **Commit** it into the host app.

The current `MechanicalRenderer` only normalizes whitespace, sentence casing and punctuation. It deliberately warns instead of pretending to perform semantic rewriting or translation. A model-backed renderer comes next.

Obvious times and money values are automatically protected with verbatim locks. Sensitive/password fields bypass semantic buffering entirely.

## Project layout

```text
intent-keyboard/
├── core/                 # shared semantic contracts, locks and renderers
├── platforms/
│   └── android/          # installable Android IME prototype
├── docs/
└── gradle/
```

## License

Covered by the repository-level [ISC License](../LICENSE).
