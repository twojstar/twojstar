# Paint.NET AI

Small local-AI effect pack for Paint.NET. The first effect is **AI Restore**,
focused on cleaning up low-resolution or degraded images rather than generative effects.

## AI Restore

- Real-ESRGAN `realesr-general-x4v3` via ONNX Runtime
- local processing only; the plugin never uploads images or downloads models at runtime
- preserves the original canvas dimensions and alpha channel
- renders with source context around Paint.NET tiles to avoid visible seams
- downsamples the model's 4x reconstruction back to the current canvas and blends it with the source
- **Strength** controls how much of the restored result is applied

The first version targets Paint.NET 5.1 and CPU inference. True 2x/4x document enlargement and hardware acceleration can be added as separate operations later; a normal Paint.NET effect renders into the existing document bounds.

## Install

Use the release ZIP and run `Install.bat`. It installs the complete plugin folder to:

`Documents\Paint.NET App Files\Effects\Travny.PaintDotNet.AI`

Portable Paint.NET users can copy `Effects\Travny.PaintDotNet.AI` into the portable `Effects` directory.

## Model provenance

The packaged ONNX model is a reproducible export of the official Real-ESRGAN `realesr-general-x4v3` weights. CI downloads it from `CoderViking/realesr-general-x4v3-onnx` and requires SHA-256 `1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112` before packaging.

Third-party license texts are shipped in `licenses/`.
