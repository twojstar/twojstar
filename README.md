# Feedboard

A local-first RSS/Atom widget for the Windows 11 Widgets Board.

> Status: early prototype. The provider, feed parser, OPML plumbing and adaptive-card renderer are scaffolded. The next Windows pass is packaging + install smoke testing on a real Windows 11 machine.

## Goal

Feedboard should feel like the missing free feed widget in Windows 11:

- RSS 2.0, Atom and RSS 1.0/RDF feeds
- headline list with feed favicon and article thumbnail when available
- small / medium / large widget layouts
- first click expands an article in-place; clicking the expanded article opens the source
- OPML import/export
- local storage, no account and no backend
- refresh while the Widgets Board is active

## Architecture

```text
Feedboard.WidgetProvider
├─ Services/FeedClient.cs      fetch + parse RSS/Atom/RDF
├─ Services/FeedStore.cs       local source persistence
├─ Services/Opml.cs            OPML import/export
├─ Widgets/FeedWidget.cs       widget lifecycle + refresh
├─ Widgets/WidgetCardRenderer  Adaptive Card JSON
└─ Interop/                    packaged COM registration helper
```

The Windows 11 board is currently the Windows Widgets host. Third-party widgets are supplied by a packaged Win32 app (or PWA) and the widget UI is an Adaptive Card. This prototype follows Microsoft's C# packaged Win32 provider shape.

## Current prototype commands

The same executable can manage feeds while the settings UI is still being built:

```powershell
Feedboard.WidgetProvider.exe feeds list
Feedboard.WidgetProvider.exe feeds add https://example.com/feed.xml
Feedboard.WidgetProvider.exe feeds import subscriptions.opml
Feedboard.WidgetProvider.exe feeds export subscriptions.opml
```

Feed definitions are stored in `%LOCALAPPDATA%\Feedboard\feeds.json`.

## Build notes

Requirements for the Windows pass:

- Windows 11 with Developer Mode enabled
- Visual Studio 2022+ with **WinUI application development**
- .NET 8
- Windows App SDK 2.4.x

The sandbox used for this initial scaffold does not contain the Windows/.NET toolchain, so source structure and data formats are validated here, while the first compile/install smoke test must run on Windows.

### Packaging

`packaging/Package.appxmanifest.template` contains the widget registration and COM server wiring. `assets/feedboard.png.b64` is a text-safe source asset; `tools/materialize-assets.ps1` turns it into the PNG files referenced by the manifest before packaging.

The package identity/publisher values are placeholders until we choose the final signing/publishing route.

## Next passes

1. Materialize assets, wire the manifest into single-project MSIX and build/install on Windows 11.
2. Add a tiny WinUI settings window for feed CRUD, refresh interval and OPML import/export.
3. Add per-widget feed selection, unread/read state and ordering.
4. Add JSON Feed and better site icon discovery (`link rel=icon`).
5. Add cache/backoff, duplicate suppression and feed-level error status.

## References

- Microsoft Learn: Windows widget providers and Widgets Board
- Microsoft Windows App SDK Widgets sample (C# packaged provider)

The COM registration helper is adapted from Microsoft's MIT-licensed Windows App SDK sample and retains its attribution comments.
