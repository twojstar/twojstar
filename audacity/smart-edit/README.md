# Audacity Smart Edit

AI-assisted editing helpers for making cuts, joins and trims sound intentional instead of sounding like two waveforms were introduced with a stapler.

## Goal

Smart Edit should reduce the repetitive work around destructive edits:

- **Smart Trim** — find sensible leading/trailing boundaries without eating attacks, breaths or room tone.
- **Smart Cut** — choose a safer cut point near the requested region and repair the new seam.
- **Smart Join** — match two sides of a join so level, DC, phase and spectral balance do not jump abruptly.
- **Smart Transition** — automatically choose and render a short fade/crossfade or, when necessary, a tiny repair around a difficult splice.

The product is local-first. No cloud processing, login, telemetry or runtime model downloads.

## Audacity 4.0 boundary

Audacity 4.0 supports VST3 effects, but the old Macro Manager and scripting pipe are currently unavailable. A VST3 audio effect can process audio but should not pretend it can move, trim or join clips on the host timeline.

Therefore the first usable stage is **Smart Transition** as an applied VST3 effect in the existing [`../vst3/`](../vst3/) toolchain. The user makes or selects the edit; the effect repairs the transition. The host-orchestration layer remains separate and can consume the same analysis core when Audacity exposes a stable timeline automation/extension surface again.

## Smart Transition VST3 contract

Version 0.1 is a bounded streaming audio effect, not a timeline editor.

- **Buses:** one input and one output with matching layout; mono and stereo only.
- **Samples:** VST3 `kSample32` and `kSample64` are both supported and must produce equivalent plans within numeric tolerance.
- **Context:** at `setupProcessing`, derive a per-side analysis/lookahead window from 100 ms of audio, clamped to `1024..8192` samples. The value is fixed until the host changes processing setup.
- **Block boundaries:** analysis state lives in fixed-capacity ring buffers and survives arbitrary host block splits. A seam crossing two VST3 process blocks must produce the same result as the same samples delivered in one block.
- **Latency:** report exactly the configured lookahead window through `getLatencySamples()`. No hidden additional latency.
- **Tail:** report `kNoTail` / `0`. VST3 tail describes output generated after input stops and must not include lookahead latency. Smart Transition does not synthesize a reverb/delay-style tail.
- **End of input:** delayed source samples are a latency-compensation concern, not fake tail. Before release, Audacity must be verified to compensate the reported latency and provide the processing/post-roll behavior needed to return the complete selected region. If it does not, v0.1 must change its buffering/adapter strategy instead of abusing `getTailSamples()`.
- **Channels:** stereo analysis may use cross-channel correlation, but timing movement is shared by both channels so the effect cannot disturb stereo image by shifting channels independently.
- **Real-time safety:** no allocation, file I/O, locks on contended global state, network access or model loading on the audio thread. Any optional ML classifier is initialized outside processing and must have a deterministic DSP fallback.
- **Offline vs preview:** for `EditPlan` v1, identical input samples, settings and plan must produce the same rendered samples in preview and offline processing. A future higher-quality backend requires a schema revision or an explicit backend field before it may change rendering semantics.
- **Short selections:** when the host provides less than the preferred context, shrink the analysis window symmetrically. If either side lacks enough clean samples to make a confident plan, bypass unchanged.
- **Processing-run boundary:** the observable reset boundary is a new `setProcessing(true)` run after processing was stopped. Starting a run clears ring buffers, candidate state and the accepted-plan flag. `setProcessing(false)` and deactivation discard any unfinished state.
- **One seam per run:** v0.1 may accept at most one non-no-op seam in one processing run. This is intentionally scoped to a processing run, not component activation and not an assumed Audacity selection boundary.

The VST3 adapter therefore needs no private Audacity state. It also does **not** attempt a region-wide search, because fixed-latency streaming cannot revise audio that has already left the lookahead buffer. Instead, v0.1 performs bounded local candidate scoring inside the current analysis window. A candidate must be fully observable before its oldest affected sample is emitted. The user should apply Smart Transition to a tight region containing one intended splice; if no candidate clears the confidence threshold, the effect passes the region through unchanged. Future host orchestration may provide an explicit seam hint and project coordinates to the same analysis core.

### Audacity host compatibility gate

The first VST3 implementation is not considered release-ready until an Audacity host test proves all of the following:

1. every preview pass and final Apply/render starts a fresh processing run, so preview cannot consume the final render's one-seam allowance;
2. separate applications/selections do not reuse ring or accepted-plan state from a previous run;
3. reported latency is compensated without truncating the first or last samples of the selected region;
4. arbitrary VST3 block splits produce the same accepted `EditPlan` and output within numeric tolerance;
5. cancellation followed by another preview/apply starts from clean state.

If Audacity does not expose preview/apply as distinct processing runs, the adapter must support multiple seam epochs or another host-observable boundary before shipping. The contract does not infer selection boundaries from `setActive()` or component lifetime.

## Transition pipeline

For a short region around a seam:

1. locate a plausible discontinuity inside the currently buffered candidate neighbourhood,
2. estimate local DC offset, RMS/LUFS-like level and noise floor on both sides,
3. search that bounded neighbourhood for compatible zero crossings and waveform correlation,
4. classify the local content conservatively (transient, speech-like, sustained/music-like, noise/ambience),
5. choose fade length and curve from that context,
6. match gain and DC gradually rather than with a step,
7. align phase/timing only inside a tightly bounded window,
8. render equal-power, constant-amplitude or S-curve crossfade as appropriate,
9. optionally use short spectral interpolation when an ordinary crossfade still leaves an obvious seam,
10. leave the region untouched when confidence is low.

The default should be conservative: better an audible edit the user can retry than a long invented transition.

## `EditPlan` v1 contract

The analysis core returns one host-neutral, versioned plan for one locally accepted seam. VST3, tests and future Audacity orchestration must interpret it identically.

```text
EditPlan v1
schema_version:              1
seam_anchor_samples:         signed sample index relative to the first sample of the analysis window
confidence:                  float in [0.0, 1.0]
left_gain_db:                finite dB adjustment applied gradually toward the seam; default 0.0
right_gain_db:               finite dB adjustment applied gradually away from the seam; default 0.0
dc_delta:                    mean(right) - mean(left) normalized sample DC; default 0.0
timing_offset_samples:       signed integer; positive means delay/right-shift the right side; default 0
fade_length_samples:         non-negative total transition length; default 0
fade_curve:                  None | ConstantAmplitude | EqualPower | SCurve
repair_mode:                 None | Spectral
repair_start_offset_samples: signed sample offset from seam anchor; default 0
repair_length_samples:       non-negative length; default 0
no_op:                       boolean
```

Rules:

- Coordinates are always **samples**, never milliseconds. `seam_anchor_samples` is relative to the current bounded analysis-window start, not to an unknowable VST3 selection/timeline start. A future host adapter owns conversion to/from project coordinates.
- `seam_anchor_samples` identifies the logical cut/join before timing correction. It must be inside the supplied analysis window and must be selected before the oldest sample affected by the plan leaves lookahead.
- VST3 v0.1 accepts at most one non-no-op plan per **processing run**. A run begins when `setProcessing(true)` starts processing after stopped state and ends at `setProcessing(false)` or deactivation.
- `timing_offset_samples` is bounded by the configured Strength/maximum-search tolerance and always moves both stereo channels together.
- Gains are dB, clamped by policy before rendering; non-finite values invalidate the plan.
- `dc_delta = mean(right) - mean(left)` over the analysis windows. Positive means the right side has the more-positive DC level. The renderer uses the left side as the local reference and applies `-dc_delta` to the right side at the seam, tapering that correction continuously to `0` by the right edge of the transition.
- `confidence` is calibrated to `[0,1]`; `0` means no usable evidence and `1` means the deterministic checks strongly agree.
- `confidence < 0.5` produces `no_op=true` by default. User-facing modes may raise that threshold, never silently lower it below a documented minimum.
- `no_op=true` requires `left_gain_db=0`, `right_gain_db=0`, `dc_delta=0`, `timing_offset_samples=0`, `fade_length_samples=0`, `fade_curve=None`, `repair_mode=None`, `repair_start_offset_samples=0` and `repair_length_samples=0`. Rendering is pass-through apart from numeric format conversion required by the host.
- `no_op=false` requires at least one executable action: a non-zero gain, DC correction, timing offset, non-zero fade, or repair operation. An all-neutral non-no-op plan is invalid.
- `fade_length_samples=0` requires `fade_curve=None` and all gain/DC/timing/repair actions to be neutral. Conversely, any gain, DC, timing or repair action requires `fade_length_samples > 0` and a non-`None` fade curve so the change has a bounded transition interval.
- The transition interval is centred on `seam_anchor_samples`: `floor(fade_length_samples / 2)` samples on the left and the remainder on the right. The whole interval must fit inside the buffered analysis window after timing adjustment.
- `repair_mode=None` requires both repair fields to be `0`.
- `repair_mode=Spectral` requires `1 <= repair_length_samples <= min(512, fade_length_samples)`. Let `repair_start = seam_anchor_samples + repair_start_offset_samples`; the half-open interval `[repair_start, repair_start + repair_length_samples)` must be fully contained inside the transition interval. This is deliberately tiny; v1 is seam repair, not generative gap filling.
- Preview and offline rendering use the same spectral implementation for `repair_mode=Spectral` in schema v1. A second backend is not representable and therefore not allowed without a schema extension.
- Unknown schema versions or enum values are rejected, not guessed.
- Serialization, if added later, must include `schema_version`; the in-memory C++ type remains the source of truth.

Example for a 48 kHz analysis window where the accepted seam is 2400 samples from its start:

```text
schema_version=1
seam_anchor_samples=2400
confidence=0.91
left_gain_db=-0.7
right_gain_db=0.0
dc_delta=0.0021
timing_offset_samples=-3
fade_length_samples=384
fade_curve=EqualPower
repair_mode=None
repair_start_offset_samples=0
repair_length_samples=0
no_op=false
```

## ML role

ML is an assistant, not the audio generator by default.

A small local model may classify context and score candidate splice points or fade policies. Deterministic DSP remains responsible for the actual gain, alignment and crossfade whenever possible. A later neural repair backend may handle only tiny damaged gaps or difficult discontinuities where interpolation is insufficient.

The model may contribute evidence to an `EditPlan`, but it does not get to bypass the schema bounds, confidence/no-op rule or rendering limits.

## Smart Trim roadmap

A future host-aware layer can combine:

- adaptive silence/noise-floor detection,
- voice/activity or onset hints,
- zero-crossing-aware boundaries,
- configurable preservation of breaths, reverb tails and room tone,
- short automatic edge fades,
- confidence + preview instead of unconditional deletion.

## Smart Cut / Join roadmap

When host timeline control is available again:

- analyse a small window before applying a cut,
- nudge the requested boundary to a safer sample location within a strict tolerance,
- perform cut/split/join through the host,
- run the same Smart Transition plan over the resulting seam,
- keep the entire operation undoable as one logical edit when the host API permits it.

Until then, the VST3 stage must not depend on private Audacity internals or version-coupled modules.

## Integration with the existing toolbox

- VST3 implementation belongs under `audacity/vst3/src/smarttransition/`.
- Reusable analysis/DSP stays host-independent and unit-testable like Auto Declip.
- Future timeline orchestration belongs here, not duplicated inside the VST3 adapter.
- Windows + Linux first, CMake source of truth, C++20.

## First milestone

**Smart Transition 0.1** should accept a short selected region and expose only a few controls:

- `Mode`: Auto / Speech / Music / Hard splice,
- `Max transition`: upper bound in milliseconds,
- `Strength`: how aggressively gain/timing matching may move,
- `Repair`: Off / Auto for tiny spectral repair.

The useful test is simple: after deleting a chunk in the middle or joining two clips, the result should stop making the little `PRRzPspKSSZ` click/thump without smearing the surrounding audio.
