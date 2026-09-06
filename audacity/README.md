# Audacity plugins

Home for small audio effects and workflow helpers aimed primarily at Audacity.

The first track is [`vst3/`](vst3/): cross-platform VST3 effects that stay local, deterministic and useful in other compatible hosts too.

## Direction

This is a compact **restoration and workflow toolbox**, not a random pile of effects and not a clone of features Audacity already does well.

Good fits:

- repair and cleanup helpers that are useful as reusable effects,
- small analysis/metering tools that reduce repetitive editing work,
- narrowly scoped restoration stages that can be combined into a chain,
- stronger ML-assisted repair when ordinary signal processing cannot recover enough information.

Poor fits:

- virtual instruments: Audacity does not support VST instruments,
- network-dependent DSP, telemetry, login gates or runtime model downloads,
- effects added only because every plugin bundle apparently needs its seventeenth compressor.

## Principles

- **Local-first.** Audio stays on the machine.
- **Windows + Linux first.** One CMake source of truth.
- **Host-friendly.** Avoid Audacity-specific internals unless there is a compelling reason.
- **Boring installation.** Standard VST3 bundles, no resident helper or launcher.
- **Progressive repair.** Use deterministic DSP when it is sufficient; reserve ML for damage that actually needs inference.

## Status

The first experimental effect is **Auto Declip** under [`vst3/`](vst3/). It deliberately handles only short, high-confidence clipping plateaus. Longer or ambiguous damage is left untouched for a future stronger restoration stage instead of being creatively hallucinated into your recording.
