# Paint.NET plugins

Shared home for Paint.NET extensions maintained in this repository.

## Current plugins

- [`ico/`](ico/) — ICO import/export FileType plugin for Paint.NET 5.1 and 5.2+.
- [`ai/`](ai/) — local AI restoration pack. The shipped **Fast** profile is Real-ESRGAN AI Restore; the next **Medium** profile targets stronger restoration, smart transparency/matting and an SVG import utility without turning the pack into a heavyweight Topaz-style application.

Stable release assets remain separate so users can install only what they need:

- [`paintdotnet-ico.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ico.zip)
- [`paintdotnet-ai.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ai.zip)

## Direction

Keep future Paint.NET work here instead of creating new top-level projects.

The AI pack should grow by capability/profile rather than by making a new directory for every model:

- **Fast** — small model, low friction, current-size restoration.
- **Medium** — stronger Restore+, denoise/repair and matte/transparency tools with explicit performance trade-offs.
- **Heavy** — intentionally out of scope for now; do not grow a local plugin into a multi-gigabyte model manager by accident.

SVG support belongs to this Paint.NET hub as a FileType/utility component. Paint.NET is still a raster editor, so the useful goal is reliable SVG raster import and transparent handling of SVG edge cases, not pretending arbitrary vector documents remain editable vectors.

True one-click 2x/4x document enlargement waits for a stable host API that can resize/create a destination document. Until then, use native resize followed by AI refinement rather than violating the effect contract.

Each plugin keeps its own build/release workflow when its toolchain differs, while shared repository concerns such as Dependabot cover the whole `paintdotnet/` tree.
