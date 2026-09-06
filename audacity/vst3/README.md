# Audacity VST3

Cross-platform VST3 **audio effects** aimed first at Audacity and usable in other compatible hosts.

This directory is intentionally a foundation, not a fake 0.1 release. The goal is to establish the build boundary and product rules before choosing the first DSP effect.

## What this is for

A small local-first toolbox for audio **restoration, cleanup and repetitive editing work** where a reusable real-time effect is more useful than another destructive one-off operation.

The project should favor narrowly useful tools over a giant all-in-one plugin. Candidate directions include repair/cleanup stages, analysis or metering helpers, and small workflow utilities. The first real effect should be chosen because it fixes an actual editing pain point, not because an empty plugin menu looked lonely.

## What it is not

- not a fork or patch set for Audacity itself,
- not a virtual instrument collection: Audacity supports VST3 effects, not VST instruments,
- not a cloud frontend,
- not an account-gated plugin manager,
- not a place to vendor huge SDK copies or generated Visual Studio projects.

## Technical direction

- **Format:** VST3.
- **Language:** modern C++.
- **Build system:** CMake as the single source of truth.
- **Targets:** Windows x64 and Linux x64 first; keep the structure portable enough for macOS later.
- **SDK:** Steinberg VST3 SDK 3.8+ from a separate local checkout. The SDK is MIT-licensed from 3.8 onward.
- **UI:** host parameters first. Add a custom GUI only when the effect genuinely needs one.
- **Runtime:** offline and deterministic by default; no telemetry, login, background service or runtime dependency download.
- **Performance:** real-time-safe DSP where applicable, bounded memory and conservative CPU use.

Audacity supports VST3 effects across its supported desktop platforms. Steinberg's SDK provides the CMake integration and test-host tooling used by normal VST3 projects.

## Current layout

```text
audacity/
└── vst3/
    ├── CMakeLists.txt   # build boundary; no network fetching
    └── README.md        # scope and future architecture
```

When the first effect is selected, prefer growing this into:

```text
vst3/
├── CMakeLists.txt
├── src/<effect>/
├── tests/
└── licenses/
```

Keep shared DSP separate from VST3 adapter code when that makes testing easier.

## SDK setup

The repository does **not** automatically download or execute a third-party SDK. Clone or unpack a reviewed Steinberg VST3 SDK separately, then point CMake at it:

```bash
cmake -S audacity/vst3 -B audacity/vst3/build \
  -DVST3_SDK_ROOT=/path/to/vst3sdk
```

On Windows the same project can be opened directly as a CMake project in Visual Studio. On Linux use a normal CMake + GCC/Clang toolchain.

At the moment configuration only verifies and wires the SDK. There is deliberately no plugin target until the first effect has a concrete purpose and tests.

## Before the first release

The first actual effect should arrive with:

1. a small DSP contract and unit tests,
2. a VST3 adapter built with `smtg_add_vst3plugin`,
3. Steinberg validator/test-host checks where practical,
4. an Audacity load/scan smoke test,
5. Windows and Linux CI,
6. standard VST3 packaging with no custom launcher.
