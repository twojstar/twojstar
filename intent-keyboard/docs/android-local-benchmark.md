# Android local model benchmark

This is the repeatable real-device gate for the managed LiteRT-LM model. It is a test protocol, not a claim that the current model already meets a performance or quality target.

## What is measured

The Android runtime keeps a small process-local diagnostics window for real keyboard renders only:

- up to 20 successful local-render latencies,
- local-render failure count since the last reset,
- median and p95 latency,
- last input and output character counts.

Draft text and completion text are never stored by the diagnostics collector, written to disk, or logged. Samples disappear when the app process exits and can also be reset from the setup screen.

Installer smoke tests, mechanical renders and remote-provider renders are not counted as successful local inference samples. A failed local render increments the failure count even when remote or mechanical fallback later succeeds.

## Current tuning baseline

Keep the first measurements deliberately conservative:

- backend: CPU,
- managed model: pinned Qwen3 0.6B INT4 no-think artifact from `ManagedModelCatalog`,
- output ceiling: 512 tokens per local conversation,
- engine context/KV-cache: LiteRT-LM default; `maxNumTokens` is not overridden yet,
- remote fallback: disabled for benchmark runs.

Do not enable GPU/NPU or reduce `maxNumTokens` merely to improve a single result. Those changes need their own compatibility and quality comparison for this exact model/runtime pair.

## Test preparation

1. Install a fresh debug APK from the final PR head.
2. Install the recommended managed model and confirm the keyboard reports the local model as ready.
3. Disable remote fallback so failures cannot be hidden by network rendering.
4. Keep the device off battery-saver mode and let it return to a normal thermal state before testing.
5. Close unusually heavy foreground workloads that would make repeated runs incomparable.
6. Record device model, Android version, app commit, LiteRT-LM version and selected model in the test notes.

## Benchmark pass

1. Run two representative local renders as warm-up.
2. Open **Intent Keyboard → Local runtime diagnostics** and reset the samples.
3. Run 10–20 keyboard renders covering the cases below.
4. Return to setup and tap **Refresh local performance**.
5. Record successful/failed sample counts, median latency and p95 latency.
6. If the device became noticeably hot, let it cool and repeat the pass instead of mixing thermal-throttled and cold results.

Suggested coverage:

| Case | Example raw intent | Settings to exercise |
| --- | --- | --- |
| Short cleanup | `jutro dam znac rano` | Natural, Polish |
| Polished rewrite | `nie zdaze dzis wysle jutro` | Civilized, Polish |
| Tone | `sprawdz to jeszcze raz` | Work or Friendly |
| Recipient | `nie mam jeszcze wyceny wysle rano` | Client |
| Translation | `jutro podeśle poprawiona wersje` | Polish → English |
| Protected fact | `spotkanie 18:30 koszt 120 zł` | Civilized with automatic locks |
| Longer draft | 2–4 short sentences | Natural/Civilized |

Use synthetic or disposable benchmark text rather than private messages. Diagnostics do not retain text, but keeping the benchmark corpus non-sensitive makes the whole test easier to reproduce and share.

## Quality notes

Performance numbers alone are not a pass. For each case also note whether the result:

- preserves the original meaning,
- preserves protected values,
- follows the selected tone/recipient/language settings,
- avoids invented facts,
- remains short enough for normal keyboard use.

Translation quality remains a separate real-device gate. Do not claim broad local translation quality until the managed Qwen model has been exercised on representative Polish/English inputs.

## Tuning decisions after the baseline

Use the baseline to decide one change at a time:

1. Tune the output ceiling only if normal keyboard renders are truncated or consistently waste generation budget.
2. Consider an explicit `maxNumTokens` only after observing memory/latency behavior with LiteRT-LM defaults.
3. Test GPU or NPU as separate branches only after confirming the backend supports the pinned model and produces equivalent safe outputs.
4. Add another managed model pack only when its artifact can be pinned by immutable source revision, expected byte count, SHA-256 and license, and it passes the same smoke/benchmark gates.

Keep benchmark results out of source-code constants until there is enough device evidence to justify a product threshold.
