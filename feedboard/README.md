# Feedboard

A local-first RSS/Atom/JSON Feed reader for the Windows 11 Widgets Board.

> Status: working development prototype. The packaged provider, WinUI settings app, feed parser, local state, OPML plumbing and adaptive-card renderer are implemented. For same-repository builds, CI produces an attested, locally signed x64 MSIX development artifact, and the package has passed a real Windows 11 install/picker/render/resize smoke test.

## Goal

Feedboard should feel like the missing free feed widget in Windows 11:

- RSS 2.0, Atom, RSS 1.0/RDF and JSON Feed 1.x
- headline list with discovered feed/site icons and article thumbnails when available
- small / medium / large layouts with size-specific density
- first click expands an article in-place; clicking the expanded article opens the source
- per-widget feed selection
- unread/read state with unread-first ordering
- WinUI settings for adding, renaming, removing, enabling and disabling feeds, refresh interval and OPML import/export
- conditional HTTP cache, transient-error backoff and duplicate suppression
- compact feed retry/error status while cached headlines remain usable
- local storage, no account and no backend
- refresh while the Widgets Board is active

## Architecture

```text
Feedboard.Core
├─ Models/                     shared feed/article/settings models
└─ Services/                   feed storage, app settings, discovery and OPML

Feedboard.Settings
├─ MainWindow.xaml             WinUI feed/settings UI
└─ MainWindow.xaml.cs          add/rename/remove/enable feeds, refresh interval and OPML actions

Feedboard.WidgetProvider
├─ Services/FeedClient*        fetch + parse + cache/backoff + icon discovery
├─ Widgets/FeedWidget.cs       widget lifecycle, refresh, selection and read state
├─ Widgets/WidgetCardRenderer  Adaptive Card JSON
├─ Interop/                    packaged COM registration helper
└─ Package.appxmanifest        single-project MSIX + widget registration
```

The Windows 11 board is the Windows Widgets host. Third-party widgets are supplied by a packaged Win32 app (or PWA) and the widget UI is an Adaptive Card. Feedboard follows Microsoft's packaged C# provider shape.

## Managing feeds

The packaged WinUI settings app is the normal way to add, rename, edit the URL of, remove, enable or disable feeds, choose the refresh interval, and import/export OPML. Adding accepts either a direct feed URL or a normal website URL and discovers advertised feeds when available.

The provider executable also keeps command-line feed management for development and recovery:

```powershell
Feedboard.WidgetProvider.exe feeds list
Feedboard.WidgetProvider.exe feeds add https://example.com/feed.xml
Feedboard.WidgetProvider.exe feeds import subscriptions.opml
Feedboard.WidgetProvider.exe feeds export subscriptions.opml
```

Feed definitions are stored in `%LOCALAPPDATA%\Feedboard\feeds.json`.

## MSIX package

`Feedboard CI` is the single maintained Feedboard workflow. It publishes the self-contained WinUI settings app, packages it with the x64 provider as a single-project MSIX, and uploads a `feedboard-msix-x64` artifact for each relevant PR/push. CI assigns a monotonically increasing development package version, includes the x86/x64 Windows App Runtime dependencies needed by the x64 package, and signs the MSIX with a fresh self-signed development certificate. Only the public `Feedboard.cer` is uploaded; the temporary private signing key is deleted on the runner.

For same-repository builds, GitHub also publishes Sigstore-backed artifact attestations for `Feedboard.msix`, `Feedboard.cer`, and the install helper. The helper refuses to trust the development certificate unless those attestations verify against `trvny/trvny`.

Successful `main` builds also refresh the [Feedboard rolling release](https://github.com/trvny/trvny/releases/tag/feedboard-latest). Its `Feedboard-dev-x64.zip` contains the same attested development package, dependencies and install helper behind a stable download page instead of a short-lived Actions artifact URL.

The install helper is therefore intended for same-repository builds. Fork PR artifacts are still useful for CI validation, but they are not attested by this workflow and will fail the install helper's provenance verification.

To smoke-test a same-repository build on Windows 11:

1. Install and sign in to GitHub CLI (`gh`) so artifact provenance can be verified.
2. Download and unzip either the `feedboard-msix-x64` workflow artifact or `Feedboard-dev-x64.zip` from the rolling release.
3. From the directory containing the package run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-dev-package.ps1
```

4. Approve the administrator prompt. The helper verifies its own provenance, then verifies `Feedboard.msix` and `Feedboard.cer`, confirms that the certificate matches the package signature, imports the public certificate into `LocalMachine\TrustedPeople`, installs the bundled Windows App Runtime dependencies, and installs Feedboard.
5. Open the Widgets Board, choose **Add widgets**, and look for Feedboard.

The development package has been verified on Windows 11: Feedboard installs, appears in the widget picker, renders live headlines, reacts to small/medium/large size changes, preserves per-widget selection/read state, expands articles in place, and keeps the provider running without a visible console window.

The certificate is a development-only trust anchor for this CI artifact. Remove it from `LocalMachine\TrustedPeople` when the build is no longer needed. Production/Store packaging will use a stable publisher identity and a publicly trusted signing route instead.

### Local package build

Requirements:

- Windows 11
- Visual Studio 2022+ with **WinUI application development**
- .NET 8
- Windows App SDK 2.4.x
- a package-signing certificate whose subject exactly matches `CN=Feedboard Development`, or a corresponding local manifest publisher override

The CI workflow is the reference packaging path because it creates the temporary development signing certificate, package, and provenance attestations together.

## Phase 1 complete

The original five implementation passes are now complete:

1. WinUI settings window with adding/removing/enabling feeds, refresh interval and OPML import/export.
2. Per-widget feed selection, unread/read state and unread-first ordering.
3. JSON Feed support and HTML `link rel=icon` site-icon discovery.
4. Conditional caching/backoff, duplicate suppression and feed-level retry status.
5. Size-aware density, distinct empty/retry states, visual hierarchy and accessibility labels.

## Next passes

Phase 2 can now focus on higher-level product polish rather than missing foundations:

1. **Done:** feed discovery and validation from normal website URLs, with useful add-feed errors instead of requiring a direct feed URL.
2. Settings UX polish: custom feed names, stable-identity feed URL editing and live feed health tests are available; next add deeper cache/refresh diagnostics.
3. Better article controls where the widget surface allows them, including explicit read/unread actions and richer expanded metadata.
4. Local backup/restore and diagnostics for cache/feed state without introducing an account or backend.
5. Production packaging/release readiness, including stable identity/signing and Store-oriented metadata when the app is ready for distribution.

## References

- Microsoft Learn: Windows widget providers, MSIX package signing, single-project MSIX and Windows app CI
- GitHub Docs: artifact attestations and `gh attestation verify`
- Microsoft Windows App SDK Widgets sample (C# packaged provider)

The COM registration helper is adapted from Microsoft's MIT-licensed Windows App SDK sample and retains its attribution comments.
