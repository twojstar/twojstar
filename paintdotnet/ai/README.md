# Paint.NET AI

Small local-AI effect pack for Paint.NET. The first effect is **AI Restore**,
focused on cleaning up low-resolution or degraded images rather than generative effects.

## AI Restore

- Real-ESRGAN `realesr-general-x4v3` via ONNX Runtime
- local processing only; the plugin never uploads images or downloads models at runtime
- preserves the original canvas dimensions and alpha channel
- deterministic 128 px restoration tiles with the model's full 34 px receptive-field context
- bounded tile cache avoids repeating the same expensive inference across Paint.NET render regions
- active ONNX inference is terminated when Paint.NET cancels rendering
- downsamples the model's 4x reconstruction back to the current canvas and blends it with the source
- **Strength** controls how much of the restored result is applied

The package now ships separate adapters for **Paint.NET 5.1.x** and **Paint.NET 5.2+**, while sharing one ONNX Runtime/model payload. True 2x/4x document enlargement remains a separate operation because a normal Paint.NET effect renders into the existing document bounds; it should not be faked by silently resizing outside the host's effect contract.

## Install

Use the release ZIP and run `Install.bat`, then choose your Paint.NET version. The installer combines the matching adapter with the shared runtime/model files and installs the complete plugin folder to:

`Documents\Paint.NET App Files\Effects\Travny.PaintDotNet.AI`

Paint.NET documents this per-user tree for the Microsoft Store build and as a supported alternative for Classic Paint.NET.

Portable Paint.NET users can create `Effects\Travny.PaintDotNet.AI`, copy everything from `Common\Travny.PaintDotNet.AI` into it, then add the matching adapter DLL from `Paint.NET-5.1` or `Paint.NET-5.2+`.

## Model provenance

The packaged ONNX model is a reproducible export of the official Real-ESRGAN `realesr-general-x4v3` weights. CI downloads it from `CoderViking/realesr-general-x4v3-onnx` and requires SHA-256 `1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112` before packaging.

Third-party license texts are shipped in `licenses/`.
