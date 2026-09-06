<div align="center">

# twojstar

**Shared workshop for the small tools, experiments and utilities that are better maintained together.**

[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://www.cloudflare.com/)  
[![Latest](https://img.shields.io/github/v/release/twojstar/twojstar?display_name=tag&include_prereleases&style=for-the-badge&label=rolling%20latest)](https://github.com/twojstar/twojstar/releases/latest) [![license](https://img.shields.io/github/license/twojstar/twojstar?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)  
<a href="https://deepwiki.com/twojstar/twojstar"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>

[![Codebench](https://img.shields.io/badge/Codebench-barcodes-111827?style=flat-square&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![Streambench](https://img.shields.io/badge/Streambench-media-7c3aed?style=flat-square&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![Docbench](https://img.shields.io/badge/Docbench-docs_%26_PDF-b45309?style=flat-square&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)
[![Weather](https://img.shields.io/badge/Weather-Ko%C5%9Bcielec-16a34a?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)

</div>

---

## 🧭 Workshop map

| project | entry points | purpose |
|---|---|---|
| 🔳 **Benches** | [`benches/`](benches/) · [download](https://github.com/twojstar/twojstar/releases/latest/download/benches-portable.zip) · [Codebench](https://codebench.trfny.com) · [Docbench](https://docbench.travny.workers.dev) · [Streambench](https://streambench.trfny.com) | Browser-first QR/barcode, document/PDF and media workshops. |
| 🌦️ **Weather Feed** | [`weather-feed/`](weather-feed/) · [weather.trfny.com](https://weather.trfny.com) | Multi-source weather, air-quality and IMGW alerts for Kościelec/Chrzanów, exposed as web, JSON and Atom. |
| 📰 **Feedboard** | [`feedboard/`](feedboard/) · [download](https://github.com/twojstar/twojstar/releases/latest/download/feedboard.zip) | Windows 11 feed widget/provider with RSS/Atom/JSON Feed support and a small settings app. |
| 📱 **Xiaomi ADB Tools** | [`xiaomi-adb-tools/`](xiaomi-adb-tools/) · [download](https://github.com/twojstar/twojstar/releases/latest/download/xiaomi-adb-tools.zip) | Maintained desktop ADB/Fastboot utility with platform-specific JavaFX builds. |
| 🎨 **Paint.NET plugins** | [`paintdotnet/`](paintdotnet/) · [`ICO`](paintdotnet/ico/) · [`AI Restore`](paintdotnet/ai/) | Shared home for Paint.NET plugins: ICO import/export and local restoration effects. |
| 🎚️ **Audacity plugins** | [`audacity/`](audacity/) · [`VST3`](audacity/vst3/) · [Windows](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-windows.zip) · [Linux](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-linux.zip) | Local-first audio restoration and workflow effects, starting with Auto Declip. |

## 📦 One rolling release

GitHub **Latest** is the repository-wide rolling snapshot. Product workflows can keep detailed build artifacts internally; the central publisher exposes only compact product bundles:

- [`benches-portable.zip`](https://github.com/twojstar/twojstar/releases/latest/download/benches-portable.zip) — Codebench, Docbench and Streambench portable builds,
- [`feedboard.zip`](https://github.com/twojstar/twojstar/releases/latest/download/feedboard.zip) — Feedboard sideload package, certificate, verified installer and dependencies,
- [`xiaomi-adb-tools.zip`](https://github.com/twojstar/twojstar/releases/latest/download/xiaomi-adb-tools.zip) — all five platform-specific Xiaomi ADB Tools JARs,
- [`paintdotnet-ico.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ico.zip) — Paint.NET ICO plugin package,
- [`paintdotnet-ai.zip`](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ai.zip) — Paint.NET AI Restore plugin package,
- [`audacity-auto-declip-windows.zip`](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-windows.zip) — Auto Declip VST3 for Windows x64,
- [`audacity-auto-declip-linux.zip`](https://github.com/twojstar/twojstar/releases/latest/download/audacity-auto-declip-linux.zip) — Auto Declip VST3 for Linux x64,
- [`SHA256SUMS`](https://github.com/twojstar/twojstar/releases/latest/download/SHA256SUMS) — checksums for the seven product bundles.

The publisher assembles a complete draft first and moves the GitHub `Latest` pointer only after all required bundles are uploaded.

➡️ **[Open the current unified Latest](https://github.com/twojstar/twojstar/releases/latest)**

## ⚙️ Maintenance

- **Dependabot** covers GitHub Actions, the Bench npm workspace, the Weather npm project, Xiaomi Gradle and Feedboard/Paint.NET NuGet projects.
- **CodeQL** uses GitHub default setup rather than a duplicate advanced workflow.
- Project-specific CI remains path-filtered so unrelated workshop changes do not rebuild everything.
- Cloudflare Worker builds for Weather and the three Benches read directly from this repository's `main` branch.

## 📜 License

Repository-level code is under the [ISC License](LICENSE). Migrated projects may retain their own license files where required, such as Xiaomi ADB Tools' original MIT notice.

<div align="center">

<sub>one workshop · one rolling latest · fewer tiny repos</sub>

</div>
