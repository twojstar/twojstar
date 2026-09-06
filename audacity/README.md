# Audacity plugins

Home for small audio effects and workflow helpers aimed primarily at Audacity.

The first track is [`vst3/`](vst3/): cross-platform VST3 effects that stay local, deterministic and useful outside Audacity too when another host supports the same format.

## Direction

This should become a compact **restoration and workflow toolbox**, not a random pile of effects and not a clone of features Audacity already does well.

Good fits:

- repair and cleanup helpers that are useful as reusable real-time effects,
- small analysis/metering tools that reduce repetitive editing work,
- narrowly scoped restoration stages that can be combined into a chain,
- utilities that remain useful without an account, cloud service or permanent background process.

Poor fits:

- virtual instruments: Audacity does not support VST instruments,
- effects added only because every plugin bundle apparently needs its seventeenth compressor,
- network-dependent DSP, telemetry, login gates or runtime model downloads,
- large frameworks unless a real effect justifies the dependency.

## Principles

- **Local-first.** Audio stays on the machine.
- **Effect-only.** Target Audacity's supported audio-effect use case rather than VST instruments.
- **Windows + Linux first.** Keep one CMake source of truth and avoid generated IDE project files.
- **Host-friendly.** Parameters and DSP must not depend on Audacity-specific internals unless there is a compelling reason.
- **Boring installation.** Standard VST3 bundles, no resident helper or launcher.
- **Small surface.** Add the first actual DSP target only when its purpose is clear enough to test and document properly.

## Status

Foundation only. There is deliberately no pretend effect yet.
