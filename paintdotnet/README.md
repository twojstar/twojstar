# Paint.NET plugins

Shared home for Paint.NET extensions maintained in this repository.

## Current plugins

- [`ico/`](ico/) — ICO import/export FileType plugin for Paint.NET 5.1 and 5.2+.
- [`ai/`](ai/) — local AI restoration effects; currently Real-ESRGAN **AI Restore**.

Stable release assets remain separate so users can install only what they need:

- [`paintdotnet-ico.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ico.zip)
- [`paintdotnet-ai.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ai.zip)

## Ideas

Keep future Paint.NET experiments here instead of creating new top-level projects. Good candidates include true 2x/4x AI upscale, denoise/deblock restoration, image repair utilities and small non-generative workflow helpers.

Each plugin keeps its own build/release workflow when its toolchain differs, while shared repository concerns such as Dependabot cover the whole `paintdotnet/` tree.
