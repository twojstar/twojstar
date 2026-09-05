<div align="center">

# twojstar

**Shared workshop for the small tools, experiments and utilities that are better maintained together.**

[![Latest](https://img.shields.io/github/v/release/twojstar/twojstar?display_name=tag&include_prereleases&style=for-the-badge&label=rolling%20latest)](https://github.com/twojstar/twojstar/releases/latest)
[![license](https://img.shields.io/github/license/twojstar/twojstar?style=for-the-badge&logo=opensourceinitiative&logoColor=white)](LICENSE)
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://www.cloudflare.com/)

[![Codebench](https://img.shields.io/badge/Codebench-barcodes-111827?style=flat-square&logo=qrcode&logoColor=white)](https://codebench.trfny.com)
[![Streambench](https://img.shields.io/badge/Streambench-media-7c3aed?style=flat-square&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com)
[![Docbench](https://img.shields.io/badge/Docbench-docs_%26_PDF-b45309?style=flat-square&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)
[![Weather](https://img.shields.io/badge/Weather-Ko%C5%9Bcielec-16a34a?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)

</div>

---

## 🧭 Workshop map

| project | entry points | purpose |
|---|---|---|
| 🔳 **Benches** | [`benches/`](benches/) · [Codebench](https://codebench.trfny.com) · [Docbench](https://docbench.travny.workers.dev) · [Streambench](https://streambench.trfny.com) | Browser-first QR/barcode, document/PDF and media workshops. |
| 🌦️ **Weather Feed** | [`weather-feed/`](weather-feed/) · [weather.trfny.com](https://weather.trfny.com) | Multi-source weather, air-quality and IMGW alerts for Kościelec/Chrzanów, exposed as web, JSON and Atom. |
| 📰 **Feedboard** | [`feedboard/`](feedboard/) | Windows 11 feed widget/provider with RSS/Atom/JSON Feed support and a small settings app. |
| 📱 **Xiaomi ADB Tools** | [`xiaomi-adb-tools/`](xiaomi-adb-tools/) | Maintained desktop ADB/Fastboot utility with platform-specific JavaFX builds. |
| 🖼️ **Paint.NET ICO FileType** | [`paintdotnet-ico/`](paintdotnet-ico/) · [download](https://github.com/twojstar/twojstar/releases/latest/download/paintdotnet-ico.zip) | ICO import/export plugin for Paint.NET 5.1 and 5.2+, shipped as verified dual adapters. |

## 📦 One rolling release

GitHub **Latest** is the repository-wide rolling snapshot. Product workflows build and attest their own artifacts; the central publisher assembles only complete successful outputs into one release and then moves the `Latest` pointer.

Current downloadable groups include:

- portable **Codebench / Docbench / Streambench** builds,
- **Feedboard** MSIX/package assets,
- five platform-specific **Xiaomi ADB Tools** JARs,
- **Paint.NET ICO** legacy + modern DLLs and `paintdotnet-ico.zip`,
- repository-wide `SHA256SUMS` and provenance attestations.

➡️ **[Download the current unified Latest](https://github.com/twojstar/twojstar/releases/latest)**

## ⚙️ Maintenance

- **Dependabot** covers GitHub Actions, Bench/weather npm workspaces, Xiaomi Gradle and Feedboard NuGet projects.
- **CodeQL** uses GitHub default setup rather than a duplicate advanced workflow.
- Project-specific CI remains path-filtered so unrelated workshop changes do not rebuild everything.
- Cloudflare Worker builds for Weather and the three Benches read directly from this repository's `main` branch.

## 📜 License

Repository-level code is under the [ISC License](LICENSE). Migrated projects may retain their own license files where required, such as Xiaomi ADB Tools' original MIT notice.

<div align="center">

<sub>one workshop · one rolling latest · fewer tiny repos</sub>

</div>
