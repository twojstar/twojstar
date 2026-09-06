# Paint.NET ICO FileType

Dependency-free `.ico` file type plugin for Paint.NET 5.1 and 5.2+.

## Download

[**Download the latest release (`paintdotnet-ico.zip`)**](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ico.zip)

The ZIP contains separate folders for Paint.NET 5.2+ and Paint.NET 5.1.x plus `Install.bat`. It is published in the shared `twojstar/twojstar` rolling Latest release, so the download URL stays stable without a plugin-specific release tag.

## What it does

- adds **Windows Icon (`.ico`)** to Open and Save As,
- opens every decodable image from a multi-frame ICO as a named Paint.NET layer,
- skips malformed or undecodable frames when loading,
- supports PNG-backed and legacy BMP/DIB-backed icons,
- writes real multi-image ICO containers,
- exports 16, 20, 24, 32, 40, 48, 64, 128 and 256 px frames,
- preserves transparency and optionally preserves aspect ratio with transparent padding.

The shared ICO codec is plain C#. It does not depend on Pillow, ImageSharp, or another image package.

## Paint.NET adapters

`PaintDotNetIco.Modern.csproj` targets Paint.NET 5.2's new `PaintDotNet.FileTypes` API on .NET 10. This is the primary adapter and has been tested against Paint.NET 5.2 Alpha build 9719.

`PaintDotNetIco.csproj` targets the classic Paint.NET 5.1 FileType API on .NET 9. It is kept as a compatibility adapter and is verified against Paint.NET 5.1.12.

## Build

For Paint.NET 5.2+:

```powershell
dotnet build .\PaintDotNetIco.Modern.csproj -c Release
```

For Paint.NET 5.1.x, build against a 5.1 installation or portable directory:

```powershell
dotnet build .\PaintDotNetIco.csproj -c Release -p:PaintDotNetDir='D:\Apps\paint.net-5.1'
```

The modern build requires .NET 10 SDK; the legacy build requires .NET 9 SDK.

## Install

The ZIP includes `Install.bat`, which installs the matching adapter per-user to `Documents\Paint.NET App Files\FileTypes` for Classic and Microsoft Store builds. For a manual classic installation, you can also copy the DLL to:

```text
C:\Program Files\Paint.NET\FileTypes
```

Store builds may use `Documents\Paint.NET App Files\FileTypes`; portable builds use `<Paint.NET directory>\FileTypes`. Restart Paint.NET after replacing a plugin DLL.

Multi-image ICO files open without an extra dialog. The document is sized to the largest decodable frame and each decodable icon image is placed on its own named layer. This avoids interfering with Paint.NET's Save As preview, which may reopen the temporary ICO while the save dialog is active.
