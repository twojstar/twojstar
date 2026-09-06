# Paint.NET AI

Local AI/restoration pack for Paint.NET. The current **AI Restore** stays the fast, small default; the next profile is **Medium**: noticeably stronger than the tiny model, but still practical enough to ship as a normal plugin pack rather than turning Paint.NET into a Topaz-sized appliance.

## Profiles

### Fast — current AI Restore

- Real-ESRGAN `realesr-general-x4v3` via ONNX Runtime
- local processing only; the plugin never uploads images or downloads models at runtime
- preserves the original canvas dimensions and alpha channel
- deterministic 128 px restoration tiles with the model's full 34 px receptive-field context
- bounded tile cache avoids repeating the same expensive inference across Paint.NET render regions
- active ONNX inference is terminated when Paint.NET cancels rendering
- downsamples the model's 4x reconstruction back to the current canvas and blends it with the source
- **Strength** controls how much of the restored result is applied

### Medium — planned

Medium remains part of this same `paintdotnet/ai` pack and reuses the existing ONNX/runtime/install infrastructure.

Target tools:

- **AI Restore+** — a stronger general restoration/super-resolution model, with the official RealESRGAN `x4plus` family as the first candidate. Keep tiled execution, cancellation and bounded memory.
- **Smart Transparency** — foreground/background matting plus alpha-edge cleanup. MODNet is a good portrait-matting candidate; U²-Net is a broader salient-object candidate. Both upstream projects publish code/models under Apache-2.0, but exact packaged weights still require pinned provenance and hash verification before shipping.
- **Alpha Refine** — deterministic decontamination around semi-transparent edges: remove colour fringing, repair halos, feather conservatively and preserve existing good alpha.
- **Denoise / DeJPEG / small repair** — prefer one licensed multi-purpose restoration backend over a zoo of overlapping models. Models are added only after reproducible ONNX export and quality fixtures exist.

Medium should be an explicit opt-in in the effect UI because it will use more RAM and inference time than Fast. The UI should make the trade-off obvious instead of silently switching models.

## Upscaling

A normal Paint.NET effect renders into the current document bounds, so true 2x/4x document enlargement must not be faked inside an effect.

For Paint.NET 5.x the safe paths are:

1. **Restore at current size** — Fast/Medium effect, no canvas change.
2. **Resize then refine** — user resizes the image with Paint.NET, then runs Restore+ to reconstruct detail and suppress interpolation artifacts.
3. **True one-click upscale later** — only when there is a stable host/document API that can create or resize the destination document without relying on private internals. Paint.NET 5.2's modern FileType system is useful infrastructure, but a FileType plugin is not a general document-resize command.

## Smart Transparency

The first useful version should produce a matte, not delete pixels blindly:

- preserve existing alpha when it is already cleaner than the predicted matte,
- expose `Subject / Portrait / Auto` modes rather than pretending one segmentation model fits everything,
- keep hair/fur/soft edges semi-transparent,
- optional edge decontamination for background colour spill,
- preview through the normal Paint.NET effect pipeline,
- no network dependency.

## SVG utility

SVG belongs in the same Paint.NET plugin hub but as a **FileType/utility component**, not as an AI effect.

The goal is robust SVG raster import for the annoying real-world cases:

- `viewBox`, transforms and nested groups,
- gradients, masks and clip paths,
- opacity and transparent backgrounds,
- embedded raster images,
- sensible sizing/DPI controls,
- predictable font fallback warnings instead of silent layout changes,
- an import preview before rasterization.

`Svg.Skia` + SkiaSharp is a promising MIT-licensed renderer candidate. Paint.NET remains a raster editor, so importing SVG means rendering it to pixels; the pack should not pretend it can preserve arbitrary SVG as editable vector objects. Exporting a raster document back to SVG merely by embedding a PNG is not a useful feature and is out of scope.

Paint.NET 5.2's modern FileType plugin system is especially interesting here because it is decoupled from the old `Document`/`Layer` plugin contract and supports richer pixel formats.

## Packaging direction

The **current** release layout remains the source of truth:

```text
Common/
└── Travny.PaintDotNet.AI/
    ├── Microsoft.ML.OnnxRuntime.dll
    ├── onnxruntime.dll
    └── model/
        └── realesr-general-x4v3.onnx
Paint.NET-5.1/
Paint.NET-5.2+/
licenses/
Install.bat
```

Keep one downloadable `paintdotnet-ai.zip` unless Medium makes that unreasonable. A future Medium implementation may introduce profile-specific model subdirectories, but the same PR must then update `Install.bat`, runtime model resolution, CI packaging and portable-install instructions together. Until that code exists, do not document a different on-disk model path.

Likewise, Fast-only versus Fast+Medium **installation selection is only a future option**. The current installer chooses the Paint.NET adapter and copies the complete shared payload. If Medium materially increases install size, profile selection should be implemented before Medium models are added to the public package. No runtime model downloader.

The package already ships separate adapters for **Paint.NET 5.1.x** and **Paint.NET 5.2+**, while sharing one ONNX Runtime/model payload.

## Install

Use the release ZIP and run `Install.bat`, then choose your Paint.NET version. The installer combines the matching adapter with the shared runtime/model files and installs the complete plugin folder to:

`Documents\Paint.NET App Files\Effects\Travny.PaintDotNet.AI`

Portable Paint.NET users can create `Effects\Travny.PaintDotNet.AI`, copy everything from `Common\Travny.PaintDotNet.AI` into it, then add the matching adapter DLL from `Paint.NET-5.1` or `Paint.NET-5.2+`.

## Model provenance

The current packaged ONNX model is a reproducible export of the official Real-ESRGAN `realesr-general-x4v3` weights. CI downloads it from `CoderViking/realesr-general-x4v3-onnx` and requires SHA-256 `1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112` before packaging.

Every Medium model must follow the same rule: upstream license reviewed, immutable source pinned, exact SHA-256 checked in CI, license text shipped, and no runtime download.

Third-party license texts are shipped in `licenses/`.
