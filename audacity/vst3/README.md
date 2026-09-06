# Audacity VST3

Cross-platform VST3 **audio effects** aimed first at Audacity and usable in other compatible hosts.

## Auto Declip 0.1

The first released effect is intentionally conservative. It repairs short full-scale clipping plateaus without pretending that severely missing audio can be recovered by a magic button.

Current detector/repair rules:

- clipping threshold: `|sample| >= 0.995`,
- repair only consecutive runs of **2–32 samples**,
- isolated full-scale samples are preserved as possible legitimate transients,
- longer clipping is preserved for a future stronger restoration stage,
- clean audio is passed through unchanged after the fixed lookahead,
- repaired runs are reconstructed between clean edges with a bounded peak-shaped interpolation,
- output is capped just below full scale,
- fixed **64-sample latency**, reported to the VST3 host,
- mono and stereo, 32-bit and 64-bit floating-point processing,
- fixed memory only in the audio path; no allocations, files, network or model loading.

## Smart Transition 0.1 prototype

Smart Transition is the first implementation from the [`../smart-edit/`](../smart-edit/) track. It targets the little click/thump/level jump left after a cut or join.

The prototype is deliberately deterministic DSP first:

- 100 ms bounded lookahead, clamped to 1024–8192 samples,
- mono/stereo shared seam detection without signed cross-channel cancellation,
- block-partition-independent candidate ordering and score quantization,
- short local DC and level matching,
- a bounded S-curve/Hermite bridge around the accepted seam,
- one high-confidence seam per VST3 processing run,
- exact same-format determinism tests across arbitrary input chunking,
- no allocation, network, model loading or background helper in the audio path.

The effect currently uses conservative fixed defaults while the host contract is being validated. The planned `Mode`, `Max transition`, `Strength` and `Repair` host parameters are still required before calling 0.1 release-ready.

### Why it is not in Latest yet

CI builds and packages `TravnySmartTransition.vst3` for Windows and Linux as an **experimental workflow artifact**, but the repository-wide rolling **Latest** release intentionally does not publish it yet.

There is one known blocking integration question: generic VST3 `ProcessData` does not provide a portable end-of-selection marker. The host-independent DSP core can finalize a late seam and shrink context for a short selection when its caller invokes `drainFrame()`, but the current VST3 adapter cannot safely infer when to do that. As a result, a short selection or a seam inside the final analysis window may still pass through unchanged in the experimental adapter. `setProcessing(false)` is too late to return audio, and latency is deliberately not misreported as an effect tail to manufacture extra process calls.

Before promotion, real Audacity testing must prove how preview and Apply bracket selected-region processing, whether the host supplies enough compensated processing for the reported latency, that cancellation resets state, and that different host block sizes produce the same plan/output contract. If Audacity does not provide a usable boundary, the adapter design changes before release. Until that host gate passes, the workflow ZIP is a development artifact rather than a supported release.

## Released packages

Ready-to-copy Auto Declip packages are published in the repository-wide GitHub **Latest** release:

- [Windows x64](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-windows.zip)
- [Linux x64](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-linux.zip)

Each archive contains the `TravnyAutoDeclip.vst3` bundle plus a tiny `INSTALL.txt`. Install by extracting the archive, copying the `.vst3` bundle into a standard VST3 plug-in directory for your OS, then rescanning effects in Audacity. The repository does not install a background helper and the plug-ins perform no runtime downloads.

## Layout

```text
vst3/
├── CMakeLists.txt
├── src/autodeclip/
│   ├── AutoDeclipDsp.*
│   ├── AutoDeclipProcessor.*
│   └── ... VST3 adapter files
├── src/smarttransition/
│   ├── SmartTransitionDsp.*
│   ├── SmartTransitionProcessor.*
│   └── ... VST3 adapter files
└── tests/
    ├── AutoDeclipDspTests.cpp
    └── SmartTransitionDspTests.cpp
```

Both DSP cores are independent of the VST3 SDK so they can be unit-tested on Windows and Linux without the host adapter.

## Build the DSP tests only

No third-party SDK is needed:

```bash
cmake -S audacity/vst3 -B audacity/vst3/build -DBUILD_TESTING=ON
cmake --build audacity/vst3/build --config Release
ctest --test-dir audacity/vst3/build -C Release --output-on-failure
```

## Build the VST3 effects

Use a separately reviewed Steinberg VST3 SDK 3.8+ checkout. The repository does **not** download or execute an SDK at configure time.

```bash
cmake -S audacity/vst3 -B audacity/vst3/build-sdk \
  -DVST3_SDK_ROOT=/path/to/vst3sdk \
  -DBUILD_TESTING=ON \
  -DSMTG_CREATE_PLUGIN_LINK=OFF
cmake --build audacity/vst3/build-sdk --config Release \
  --target TravnyAutoDeclip TravnySmartTransition
```

CI pins Steinberg VST3 SDK **3.8.0** by commit and checks its submodules recursively on both Windows and Linux. VSTGUI and SDK examples are disabled because neither effect needs them.

## Product rules

- **Format:** VST3 audio effect.
- **Language:** C++20.
- **Build:** CMake is the source of truth.
- **Targets:** Windows x64 and Linux x64 first; macOS can follow without redesigning DSP.
- **Runtime:** local/offline, deterministic, no telemetry/login/background service/runtime download.
- **UI:** host parameters first; custom GUI only when an effect genuinely needs one.
- **Performance:** bounded memory and real-time-safe processing where applicable.

## Before calling Auto Declip stable

The initial implementation still needs real recordings and generated clipping fixtures beyond the unit tests. Before a stable release, validate:

1. Steinberg validator/test-host behavior,
2. Audacity scan/load and latency compensation,
3. mono/stereo and 32/64-bit paths,
4. block-boundary clipping runs,
5. false-positive rate on hard-limited but intentionally undamaged masters,
6. quality against Audacity Clip Fix and other deterministic baselines.

Neural declipping is a later stage, not a branding sticker glued over an interpolation function.
