# twojstar

Shared workshop for projects that benefit from one maintained home, common CI,
and one rolling release instead of another tiny repository.

## Projects

- **Benches** — browser-first tools under [`benches/`](benches/):
  [Codebench](https://codebench.trfny.com),
  [Docbench](https://docbench.travny.workers.dev), and
  [Streambench](https://streambench.trfny.com).
- **Weather** — [`weather-feed/`](weather-feed/) publishes multi-source weather
  and IMGW alerts for Kościelec/Chrzanów.
- **Feedboard** — [`feedboard/`](feedboard/) is a Windows feed widget/provider
  with a small settings application.
- **Xiaomi ADB Tools** — [`xiaomi-adb-tools/`](xiaomi-adb-tools/) carries the
  maintained desktop ADB/Fastboot utility.

## Downloads

GitHub **Latest** is the unified rolling snapshot for downloadable builds from
this repository. It is refreshed only from successful CI artifacts and includes
checksums plus source provenance, so one release serves the current Bench,
Feedboard, and Xiaomi ADB Tools outputs.

[Download the latest release](https://github.com/twojstar/twojstar/releases/latest).

## License

Repository-level code is under the [ISC License](LICENSE). Migrated projects
may retain their original license files where required.
