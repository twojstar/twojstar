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

The renderer may be backed by an on-device model, a deterministic transformer, or a remote provider. Provider details stay behind the shared contract.

## Semantic locks

Some values must survive transformation.

Examples:

- exact time: `18:30`
- amount: `120 zł`
- explicit `http://` / `https://` URL
- product or person name
- quoted literal

Two lock modes exist in the shared contract:

- `VERBATIM`: preserve the exact text.
- `SEMANTIC`: preserve the meaning but allow localization, for example `tomorrow at 6 PM` → `jutro o 18:00`.

The shared core validates VERBATIM locks after every render and reports violations before text is committed. The conservative automatic detector currently covers exact times, supported currency forms, explicit HTTP(S) URLs and non-empty double-quoted/backtick literals. URL boundary normalization removes only source wrappers that are unambiguous from surrounding text; otherwise legal URI punctuation stays protected. Names and bare domains are not guessed automatically.

A general semantic-equivalence validator is **not implemented yet**. Until one exists, rewritten output carrying a `SEMANTIC` lock fails closed: the preview is marked unsafe and cannot be committed. Exact unchanged source output remains safe because it requires no semantic inference. This is deliberately stricter than guessing equivalence from text heuristics.

## Register

Initial register scale:

```text
RAW  ←────────────→  CIVILIZED
```

Presets:

- `RAW`: preserve source text directly.
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
- tone/register/recipient definitions,
- renderer/provider interfaces,
- transformation pipeline,
- integrity validation,
- provider-neutral prompt and completion contracts.

### Android

Android owns:

- `InputMethodService`,
- composing text and selection handling,
- keyboard UI,
- permissions and lifecycle,
- local LiteRT-LM runtime and model storage,
- opt-in remote-provider configuration/credentials,
- bridge from the shared result to `InputConnection`.

### iOS/iPadOS

iOS owns:

- `UIInputViewController`,
- `textDocumentProxy`,
- keyboard UI and extension lifecycle,
- extension-local render preferences,
- Full-Access-sensitive capabilities and privacy boundaries.

The current iOS keyboard keeps `RequestsOpenAccess=false` and therefore remains local/no-network by default. Its semantic bridge currently uses the deterministic mechanical renderer rather than a model-backed iOS runtime.

### Desktop

The current desktop adapter is a JVM/Swing companion proof. It reuses shared rendering contracts and keeps an explicit clipboard-only output boundary instead of pretending that Windows, macOS and Linux share one IME API. Native insertion mechanisms remain platform-specific future adapters.

## Privacy

Keyboard input is unusually sensitive. The design is local-first:

1. deterministic/local processing where possible,
2. on-device model when practical,
3. remote providers only when explicitly enabled,
4. clear indication when text leaves or may have left the device,
5. no silent retention of typed content.

Android remote fallback follows a tested policy: confirmed remote success says the draft left the device; failed remote attempts say the request was attempted and the draft **may** have left the device. No-local/no-remote mechanical fallback does not display a false upload warning.

## Original MVP boundary

The first implementation target was:

> Rough Polish input can be transformed into natural Polish without changing protected facts.

The software foundation for that loop now exists across the shared core and platform proofs. Quality/performance claims for the managed local model still depend on real-device evidence rather than CI alone.

## Implementation status

These were originally separate follow-up slices. Their current state is now tracked explicitly instead of keeping completed work in a TODO list.

1. **Host composition ownership on Android — implemented, physical validation pending**
   - Keyboard-owned drafts mirror through composing text.
   - Safe previews replace the same owned region.
   - Cursor movement, editor switches and lost composing regions are ownership boundaries.
   - Sensitive/password fields bypass semantic buffering/composition.
   - The decision policy is covered by Android JVM tests.

2. **Composition hardening across real editors — physical validation pending**
   - CI covers the pure ownership policy, but native fields, WebView and real messaging/editor apps must still be exercised on-device.
   - Use [`android-editor-matrix.md`](android-editor-matrix.md) as the repeatable gate.

3. **Tone and language settings — implemented in software**
   - Android persists tone/source/target settings locally.
   - iOS persists extension-local settings without enabling Full Access.
   - Desktop exposes process-local settings in the companion UI.
   - Language values remain untrusted model input rather than system instructions.

4. **Translation through the existing semantic pipeline — implemented in routing; quality validation pending**
   - Translation reuses the same renderer, locks and integrity checks rather than a translation-only path.
   - Android may use the local model first and explicit remote fallback second.
   - Broad local translation quality is not claimed until the managed Qwen model passes representative real-device cases.

5. **Remote provider settings and credentials — implemented on Android**
   - Remote fallback is opt-in and local remains preferred.
   - HTTPS base URL/model selection use the shared OpenAI-compatible client.
   - Optional bearer tokens are encrypted with Android Keystore-backed AES-GCM storage.
   - Fallback/disclosure branches are covered by Android JVM policy tests.
   - iOS intentionally keeps networking disabled while `RequestsOpenAccess=false`; desktop remote-provider UX is not part of the current companion proof.

6. **Recipient-aware profiles — implemented in software**
   - Shared presets include friend, work, client and formal office contexts.
   - Android, iOS and desktop pass the selected profile as render context without replacing the raw intent.

7. **On-device model/runtime polish — software plumbing implemented; real-device tuning pending**
   - Managed model install, immutable artifact verification, smoke testing, rollback and runtime metrics exist.
   - CPU remains the conservative baseline.
   - Latency/quality/output-limit tuning and GPU/NPU decisions require the real-device protocol in [`android-local-benchmark.md`](android-local-benchmark.md).

8. **iOS live semantic behavior — implemented within the current mechanical runtime boundary**
   - Debounced preview, stale-result guards, safe commit and Revert are implemented.
   - Tone/language/recipient settings are persistent inside the extension.
   - A model-backed iOS runtime is not currently selected; the adapter reports mechanical limitations instead of pretending semantic settings were applied.

9. **Undo/revert and inspectability — implemented pre-commit**
   - Android, iOS and desktop can discard the current uncommitted preview and regenerate from the raw source.
   - Draft/preview history remains short-lived rather than becoming a persistent sent-text log.

10. **Desktop adapter — companion proof implemented**
    - Swing UI, safe shared-pipeline rendering, render settings, stale-result rejection and explicit clipboard output are covered by CI.
    - Native OS-wide insertion/input-method adapters remain intentionally separate platform projects if pursued later.

## Remaining validation gates

The current high-value unresolved gates are evidence-gathering tasks rather than missing generic plumbing:

- **Android real-editor composition matrix:** native fields, WebView, messaging/editor apps, cursor/range changes, host-side composition loss and context switches.
- **Managed Qwen real-device performance:** median/p95 latency, failures and thermal behavior on representative devices.
- **Managed Qwen rewrite/translation quality:** meaning preservation, selected tone/profile/language behavior and hallucination checks on representative inputs.
- **Accelerator compatibility:** GPU/NPU only after the pinned model/runtime pair is verified against the CPU safety baseline.

A future general `SEMANTIC` equivalence validator is a separate design/implementation project. Until then, transformed semantic locks remain fail-closed.

## Working-name note

`IntentIME` was considered, but an unrelated current product named **Intentime** already exists. The repository folder therefore uses the neutral working name `intent-keyboard` until branding is decided.
