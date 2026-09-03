# Feedboard

A local-first RSS/Atom widget for the Windows 11 Widgets Board.

> Status: early prototype. The provider, feed parser, OPML plumbing and adaptive-card renderer are scaffolded. CI produces an attested, locally signed x64 MSIX development artifact, and the package has passed a real Windows 11 install/picker/render/resize smoke test.

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
├─ Interop/                    packaged COM registration helper
└─ Package.appxmanifest        single-project MSIX + widget registration
```

The Windows 11 board is the Windows Widgets host. Third-party widgets are supplied by a packaged Win32 app (or PWA) and the widget UI is an Adaptive Card. Feedboard follows Microsoft's packaged C# provider shape.

## Current prototype commands

The same executable can manage feeds while the settings UI is still being built:

```powershell
Feedboard.WidgetProvider.exe feeds list
Feedboard.WidgetProvider.exe feeds add https://example.com/feed.xml
Feedboard.WidgetProvider.exe feeds import subscriptions.opml
Feedboard.WidgetProvider.exe feeds export subscriptions.opml
```

Feed definitions are stored in `%LOCALAPPDATA%\Feedboard\feeds.json`.

## MSIX package

`Feedboard CI` builds the x64 provider as a single-project MSIX and uploads a `feedboard-msix-x64` artifact for each relevant PR/push. CI assigns a monotonically increasing development package version, includes the x86/x64 Windows App Runtime dependencies needed by the x64 package, and signs the MSIX with a fresh self-signed development certificate. Only the public `Feedboard.cer` is uploaded; the temporary private signing key is deleted on the runner.

For same-repository builds, GitHub also publishes Sigstore-backed artifact attestations for `Feedboard.msix`, `Feedboard.cer`, and the install helper. The helper refuses to trust the development certificate unless those attestations verify against `trvny/trvny`.

To smoke-test it on Windows 11:

1. Install and sign in to GitHub CLI (`gh`) so artifact provenance can be verified.
2. Download and unzip the `feedboard-msix-x64` workflow artifact.
3. From that directory run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-dev-package.ps1
```

4. Approve the administrator prompt. The helper verifies its own provenance, then verifies `Feedboard.msix` and `Feedboard.cer`, confirms that the certificate matches the package signature, imports the public certificate into `LocalMachine\TrustedPeople`, installs the bundled Windows App Runtime dependencies, and installs Feedboard.
5. Open the Widgets Board, choose **Add widgets**, and look for Feedboard.

The current development package has been verified on Windows 11: Feedboard installs, appears in the widget picker, renders live Atom headlines, reacts to small/medium/large size changes with size-specific content limits, collapses expanded content when shrinking, and keeps the provider running without a visible console window.

The certificate is a development-only trust anchor for this CI artifact. Remove it from `LocalMachine\TrustedPeople` when the build is no longer needed. Production/Store packaging will use a stable publisher identity and a publicly trusted signing route instead.

### Local package build

Requirements:

- Windows 11
- Visual Studio 2022+ with **WinUI application development**
- .NET 8
- Windows App SDK 2.4.x
- a package-signing certificate whose subject exactly matches `CN=Feedboard Development`, or a corresponding local manifest publisher override

The CI workflow is the reference packaging path because it creates the temporary development signing certificate, package, and provenance attestations together.

## Next passes

1. Add a tiny WinUI settings window for feed CRUD, refresh interval and OPML import/export.
2. Add per-widget feed selection, unread/read state and ordering.
3. Add JSON Feed and better site icon discovery (`link rel=icon`).
4. Add cache/backoff, duplicate suppression and feed-level error status.
5. Polish widget density, empty/error states and visual hierarchy across all three sizes.

## References

- Microsoft Learn: Windows widget providers, MSIX package signing, single-project MSIX and Windows app CI
- GitHub Docs: artifact attestations and `gh attestation verify`
- Microsoft Windows App SDK Widgets sample (C# packaged provider)

The COM registration helper is adapted from Microsoft's MIT-licensed Windows App SDK sample and retains its attribution comments.
