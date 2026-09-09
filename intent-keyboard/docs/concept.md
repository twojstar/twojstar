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

## Follow-up implementation queue

Keep these as separate logical slices rather than one broad refactor:

1. **Host composition ownership on Android**
   - Mirror the keyboard-owned draft into the host editor through composing text.
   - Let a safe semantic preview replace the same composing region instead of inserting a second copy.
   - Treat cursor movement, editor switches and lost composing regions as ownership boundaries.
   - Avoid composition entirely in sensitive/password fields.

2. **Composition hardening across real editors**
   - Exercise `onUpdateSelection`, composing-region loss and cursor movement in native text fields, WebView and common messaging/editor apps.
   - Fall back to finalizing or abandoning the keyboard-owned composition rather than rewriting text after ownership becomes ambiguous.

3. **Tone and language settings**
   - Expose `FRIENDLY`, `NEUTRAL`, `WORK` and `FORMAL` without conflating tone with register.
   - Add source/target language selection while keeping language values in untrusted model input.
   - Preserve the raw intent as the source of truth when changing tone or language.

4. **Translation through the existing semantic pipeline**
   - Reuse the same renderer, semantic locks and integrity checks instead of creating a translation-only path.
   - Start with local-model translation where quality is acceptable, then allow explicit remote-provider fallback.

5. **Remote provider settings and credentials**
   - Keep local processing as the default.
   - Add explicit provider enablement, base URL/model selection and secure credential storage.
   - Never embed tokens in source, APK metadata or logs.
   - Show a clear indicator whenever draft text may leave the device.

6. **Recipient-aware profiles**
   - Add reusable recipient/context presets such as friend, work, client or formal office.
   - Keep profiles as rendering context only; they must not mutate or replace the raw intent.

7. **On-device model/runtime polish**
   - Benchmark the managed Qwen model on real devices and tune prompt/output limits for keyboard-sized drafts.
   - Keep CPU as the conservative baseline until accelerator backends are verified for the selected model/runtime pair.
   - Consider optional alternative model packs without adding large binaries to Git history.

8. **iOS parity for semantic live behavior**
   - Bring live/debounced preview and equivalent safe commit semantics to the iOS keyboard extension within platform API limits.
   - Preserve the no-Full-Access/local-first default unless a user explicitly enables capabilities that require more access.

9. **Undo/revert and inspectability**
   - Make it easy to return from a rendered preview to the raw draft and regenerate with different settings.
   - Keep only short-lived in-memory draft/history state unless the user explicitly opts into persistence.

10. **Desktop adapter after mobile behavior is proven**
    - Choose per-platform insertion mechanisms instead of forcing Android/iOS IME assumptions onto desktop.
    - Reuse the same shared semantic contracts and provider/runtime layer.

## Working-name note

`IntentIME` was considered, but an unrelated current product named **Intentime** already exists. The repository folder therefore uses the neutral working name `intent-keyboard` until branding is decided.
