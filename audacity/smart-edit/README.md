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

## ML role

ML is an assistant, not the audio generator by default.

A small local model may classify context and score candidate splice points or fade policies. Deterministic DSP remains responsible for the actual gain, alignment and crossfade whenever possible. A later neural repair backend may handle only tiny damaged gaps or difficult discontinuities where interpolation is insufficient.

The analysis core should emit a host-neutral `EditPlan` concept containing candidate boundary, confidence, gain correction, timing offset, fade duration/curve and optional repair mode. That keeps VST3, future Audacity orchestration and tests on one source of truth.

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
