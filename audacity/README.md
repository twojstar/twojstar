# Audacity plugins

Home for small audio effects and workflow helpers aimed primarily at Audacity.

The first track is [`vst3/`](vst3/): cross-platform VST3 effects that stay local, deterministic and useful in other compatible hosts too. The next workflow track is [`smart-edit/`](smart-edit/): assisted trimming, cutting, joining and transition repair built around the same host-independent DSP rather than private Audacity internals.

## Direction

This is a compact **restoration and workflow toolbox**, not a random pile of effects and not a clone of features Audacity already does well.

Good fits:

- repair and cleanup helpers that are useful as reusable effects,
- small analysis/metering tools that reduce repetitive editing work,
- narrowly scoped restoration stages that can be combined into a chain,
- assisted edit planning and seam repair where a cut or join would otherwise click, thump or jump in level,
- stronger ML-assisted repair when ordinary signal processing cannot recover enough information.

Poor fits:

- virtual instruments: Audacity does not support VST instruments,
- network-dependent DSP, telemetry, login gates or runtime model downloads,
- version-coupled Audacity modules used only to work around a temporary missing public API,
- effects added only because every plugin bundle apparently needs its seventeenth compressor.

## Principles

- **Local-first.** Audio stays on the machine.
- **Windows + Linux first.** One CMake source of truth.
- **Host-friendly.** Avoid Audacity-specific internals unless there is a compelling reason.
- **Boring installation.** Standard VST3 bundles, no resident helper or launcher.
- **Progressive repair.** Use deterministic DSP when it is sufficient; reserve ML for damage or classification that actually benefits from inference.
- **One analysis core.** VST3 and future host orchestration consume the same edit/repair decisions instead of reimplementing them.

## Status

- **Auto Declip** under [`vst3/`](vst3/) repairs short, high-confidence clipping plateaus and is published for Windows and Linux.
- **Smart Edit** under [`smart-edit/`](smart-edit/) is the next foundation. Its first deliverable is Smart Transition: context-aware gain matching, alignment and crossfading around a cut/join. Full automatic timeline trim/cut/join waits for a stable Audacity 4 automation or extension surface rather than depending on private internals.
