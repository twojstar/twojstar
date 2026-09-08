# Intent Keyboard concept

## Product model

Intent Keyboard separates **what the user means** from **how the final text is written**.

The raw input remains the editable source. The rendered message is an output artifact that may be regenerated with another register, language or recipient context.

### Example

Source intent:

```text
nie dam rady dzis wysle jutro rano
```

Possible renders:

- Natural: `Nie dam rady zrobić tego dzisiaj. Wyślę jutro rano.`
- Work: `Nie zdążę już dzisiaj. Podeślę to jutro rano.`
- English: `I won't be able to finish it today. I'll send it tomorrow morning.`

## Pipeline

```text
RawInput
  ↓
InputBuffer
  ↓
IntentNormalizer
  ↓
SemanticLockGuard
  ↓
Renderer
  ├─ register / tone
  ├─ target language
  └─ optional recipient profile
  ↓
IntegrityCheck
  ↓
PlatformTextSink
```

The renderer may be backed by an on-device model, a deterministic transformer, or a remote provider. Provider details must stay behind the shared contract.

## Semantic locks

Some values must survive transformation.

Examples:

- exact time: `18:30`
- amount: `120 zł`
- URL
- product or person name
- quoted literal

Two lock modes are planned:

- `VERBATIM`: preserve the exact bytes/text.
- `SEMANTIC`: preserve the meaning but allow localization, for example `tomorrow at 6 PM` → `jutro o 18:00`.

The shared core validates verbatim locks after every render and reports violations before text is committed.

## Register

Initial register scale:

```text
RAW  ←────────────→  CIVILIZED
```

Suggested presets:

- `RAW`: typo cleanup only.
- `NATURAL`: normal conversational language.
- `CIVILIZED`: fully grammatical, polished wording.

Tone is separate from register:

- friendly
- neutral
- work
- formal

This prevents "formal" from accidentally meaning "rewrite everything into corporate sludge".

## Multiplatform boundary

### Shared core

Kotlin Multiplatform `commonMain` owns:

- request/result models,
- semantic locks,
- tone/register definitions,
- renderer/provider interfaces,
- transformation pipeline,
- integrity validation,
- future recipient-profile contracts.

### Android

Android owns:

- `InputMethodService`,
- composing text and selection handling,
- keyboard UI,
- permissions and lifecycle,
- bridge from the shared result to `InputConnection`.

### iOS/iPadOS

iOS owns:

- `UIInputViewController`,
- `textDocumentProxy`,
- keyboard UI and extension lifecycle,
- full-access-sensitive capabilities and privacy boundaries.

### Desktop

Desktop is intentionally an adapter target, not a promise that every OS exposes the same IME API. Candidate approaches can include native input methods, accessibility/insertion APIs, or a companion overlay depending on platform constraints.

## Privacy

Keyboard input is unusually sensitive. The design should therefore be local-first:

1. deterministic/local processing where possible,
2. on-device model when practical,
3. remote providers only when explicitly enabled,
4. clear indication when text leaves the device,
5. no silent retention of typed content.

## MVP

The first implementation should prove one thing well:

> Rough Polish input can be transformed into natural Polish without changing protected facts.

MVP scope:

1. shared `commonMain` contracts and lock validation,
2. Android IME prototype,
3. `RAW`, `NATURAL`, and `CIVILIZED` register,
4. explicit render action first,
5. live/debounced rendering only after cursor and composition behavior is reliable,
6. iOS adapter consuming the same core next.

Translation, recipient-aware profiles and desktop integration come after the semantic rewrite loop is trustworthy.

## Working-name note

`IntentIME` was considered, but an unrelated current product named **Intentime** already exists. The repository folder therefore uses the neutral working name `intent-keyboard` until branding is decided.
