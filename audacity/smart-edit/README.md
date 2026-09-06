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
- **Tail:** `getTailSamples()` is `0`; Smart Transition does not synthesize audio after the compensated input region ends.
- **Channels:** stereo analysis may use cross-channel correlation, but timing movement is shared by both channels so the effect cannot disturb stereo image by shifting channels independently.
- **Real-time safety:** no allocation, file I/O, locks on contended global state, network access or model loading on the audio thread. Any optional ML classifier is initialized outside processing and must have a deterministic DSP fallback.
- **Offline vs preview:** both use the same bounded algorithm and `EditPlan` schema. Offline rendering may use higher-quality spectral repair internally, but it may not change the chosen seam/gain/timing plan for identical inputs and settings unless the plan explicitly records a different repair backend.
- **Short selections:** when the host provides less than the required context, shrink the analysis window symmetrically. If either side lacks enough clean samples to make a confident plan, bypass unchanged.
- **Cancellation/reset:** deactivation or processing reset discards buffered state; no samples from a previous render may leak into the next one.

The VST3 adapter therefore needs no private Audacity state. Its local seam anchor is inferred from the strongest plausible discontinuity inside the selected/processed region, with a bias toward the centre so unrelated transients near selection edges are not mistaken for the edit.

## Transition pipeline

For a short region around a seam:

1. locate the most likely discontinuity near the requested join,
2. estimate local DC offset, RMS/LUFS-like level and noise floor on both sides,
3. search a bounded neighbourhood for compatible zero crossings and waveform correlation,
4. classify the local content conservatively (transient, speech-like, sustained/music-like, noise/ambience),
5. choose fade length and curve from that context,
6. match gain and DC gradually rather than with a step,
7. align phase/timing only inside a tightly bounded window,
8. render equal-power, constant-amplitude or S-curve crossfade as appropriate,
9. optionally use short spectral interpolation when an ordinary crossfade still leaves an obvious seam,
10. leave the region untouched when confidence is low.

The default should be conservative: better an audible edit the user can retry than a long invented transition.

## `EditPlan` v1 contract

The analysis core returns one host-neutral, versioned plan. VST3, tests and future Audacity orchestration must interpret it identically.

```text
EditPlan v1
schema_version:       1
seam_anchor_samples:  signed sample index relative to the first sample of the analysis region
confidence:           float in [0.0, 1.0]
left_gain_db:         finite dB adjustment applied gradually toward the seam; default 0.0
right_gain_db:        finite dB adjustment applied gradually away from the seam; default 0.0
dc_delta:             normalized sample offset to remove gradually across the transition; default 0.0
timing_offset_samples:signed integer; positive means delay/right-shift the right side; default 0
fade_length_samples:  non-negative total transition length; default 0
fade_curve:           None | ConstantAmplitude | EqualPower | SCurve
repair_mode:          None | Spectral
no_op:                boolean
```

Rules:

- Coordinates are always **samples**, never milliseconds, and are relative to the analysis-region start. The caller owns conversion to/from project or timeline coordinates.
- `seam_anchor_samples` identifies the logical cut/join before timing correction. It must be inside the supplied analysis region.
- `timing_offset_samples` is bounded by the configured Strength/maximum-search tolerance and always moves both stereo channels together.
- Gains are dB, clamped by policy before rendering; non-finite values invalidate the plan.
- `confidence` is calibrated to `[0,1]`; `0` means no usable evidence and `1` means the deterministic checks strongly agree.
- `confidence < 0.5` produces `no_op=true` by default. User-facing modes may raise that threshold, never silently lower it below a documented minimum.
- `no_op=true` requires zero gain/timing/fade repair and bit-transparent pass-through apart from numeric format conversion required by the host.
- `fade_curve=None` is valid only for `fade_length_samples=0`.
- `repair_mode=Spectral` is allowed only for a tiny bounded repair window fully contained inside the fade/transition region.
- Unknown schema versions or enum values are rejected, not guessed.
- Serialization, if added later, must include `schema_version`; the in-memory C++ type remains the source of truth.

Example for a 48 kHz selection where the inferred seam is 2400 samples from its start:

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
