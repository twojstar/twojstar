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

can become:

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

The shared engine lives in Kotlin Multiplatform-style `commonMain` code. Platform integrations are deliberately thin:

- **Android**: system IME using `InputMethodService`.
- **iOS/iPadOS**: Keyboard Extension using `UIInputViewController`.
- **Desktop**: native/system text-input adapter or companion insertion layer, explored after the mobile paths are proven.

The keyboard UI and operating-system hooks stay platform-specific. Intent parsing, rendering contracts, tone profiles, translation routing and lock validation belong in the shared core.

See [`docs/concept.md`](docs/concept.md) for the architecture and MVP boundary.

## Status

🧪 Concept / foundation. No distributable keyboard yet.

The first useful milestone is intentionally small: one shared semantic pipeline plus one Android prototype that can turn rough Polish input into natural Polish while preserving locked facts. iOS should consume the same core rather than reimplementing the transformation logic.

## License

Covered by the repository-level [ISC License](../LICENSE).
