# Audacity VST3

Cross-platform VST3 **audio effects** aimed first at Audacity and usable in other compatible hosts.

## Auto Declip 0.1

The first effect is intentionally conservative. It repairs short full-scale clipping plateaus without pretending that severely missing audio can be recovered by a magic button.

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

This first stage is ordinary DSP on purpose. A future neural restoration stage can target longer/ambiguous clipping where interpolation does not have enough information. The deterministic repair remains useful as the cheap, low-risk first pass.

## Packages

Ready-to-copy packages are published in the repository-wide GitHub **Latest** release:

- [Windows x64](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-windows.zip)
- [Linux x64](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-linux.zip)

Each archive contains the `TravnyAutoDeclip.vst3` bundle plus a tiny `INSTALL.txt`. Install by extracting the archive, copying the `.vst3` bundle into a standard VST3 plug-in directory for your OS, then rescanning effects in Audacity. The repository does not install a background helper and the plug-in performs no runtime downloads.

## Layout

```text
vst3/
├── CMakeLists.txt
├── src/autodeclip/
│   ├── AutoDeclipDsp.*       # host-independent repair core
│   ├── AutoDeclipProcessor.* # VST3 audio adapter
│   ├── AutoDeclipController.h
│   ├── AutoDeclipCids.h
│   └── AutoDeclipEntry.cpp
└── tests/
    └── AutoDeclipDspTests.cpp
```

The DSP core is intentionally independent of the VST3 SDK so it can be unit-tested on Windows and Linux without the host adapter.

## Build the DSP tests only

No third-party SDK is needed:

```bash
cmake -S audacity/vst3 -B audacity/vst3/build -DBUILD_TESTING=ON
cmake --build audacity/vst3/build --config Release
ctest --test-dir audacity/vst3/build -C Release --output-on-failure
```

## Build the VST3 effect

Use a separately reviewed Steinberg VST3 SDK 3.8+ checkout. The repository does **not** download or execute an SDK at configure time.

```bash
cmake -S audacity/vst3 -B audacity/vst3/build-sdk \
  -DVST3_SDK_ROOT=/path/to/vst3sdk \
  -DBUILD_TESTING=ON \
  -DSMTG_CREATE_PLUGIN_LINK=OFF
cmake --build audacity/vst3/build-sdk --config Release --target TravnyAutoDeclip
```

CI pins Steinberg VST3 SDK **3.8.0** by commit and checks its submodules recursively on both Windows and Linux. VSTGUI and SDK examples are disabled because Auto Declip needs neither.

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
