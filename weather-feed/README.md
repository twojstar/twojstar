# [weather-feed](https://weather.travny.workers.dev)

[![Weather](https://github.com/trvny/trvny/actions/workflows/weather-ci.yml/badge.svg)](https://github.com/trvny/trvny/actions/workflows/weather-ci.yml)

Multi-source weather aggregator for **Kościelec (Chrzanów)**,
50.14 N / 19.42 E, served as an Atom feed of changes rather than a firehose
of identical readings.

## What it does

- Three point sources are normalized and reduced to median + spread.
- IMGW meteo warnings are filtered to powiat chrzanowski (TERYT `1203`);
  hydro warnings are filtered to małopolskie.
- A partial IMGW outage preserves the last known warnings for the failed
  category, so a timeout cannot manufacture false “warning lifted” entries.
- Preserved warnings expire at their IMGW end time. Records without a usable
  end time remain until that IMGW category responds again.
- Current entries use condition changes, |Δ temperature| ≥ 3 °C, or
  precipitation start/stop. Forecast entries use max-temperature revisions
  or a 50% rain-probability crossing.
- OpenWeather three-hour slots are bucketed into `Europe/Warsaw` days.
- The nearest IMGW station is reference context only and is not blended.

## Schedule

| cron | cycle |
| --- | --- |
| `0 */2 * * *` | current conditions, air quality, and IMGW warnings |
| `0 5 * * *` | daily forecast revision check |

## Endpoints

- `GET /feed.atom` — all change entries
- `GET /warnings.atom` — IMGW warning entries with their own Atom ID
  and self URL
- `GET /state.json` — latest ensemble, active warnings, air quality,
  and station reference
- `GET /healthz` — returns 503 when the current cycle is stale or unhealthy
- `GET /`

The request path is read-only. KV writes happen only during scheduled cycles.

## Setup

```sh
npm install
wrangler kv namespace create WEATHER_KV
wrangler secret put OPENWEATHER_KEY
wrangler secret put VISUALCROSSING_KEY
npm run check
wrangler deploy
```

Open-Meteo and IMGW need no key. Without keyed providers the Worker continues
in degraded single-source mode.

## Tests

`npm test` covers partial and total IMGW outages, warning expiry,
Warsaw timestamp handling, and Atom feed identity. CI runs `npm run check`,
combining TypeScript validation and tests.

## Known caveats

- IMGW meteo field fallbacks should still be verified against the next live
  stopień-2 event and tightened if its shape differs.
- Upstream validation remains hand-written and zero-dependency. Zod-style
  schemas would make future API-shape changes easier to diagnose.
- Free-tier quotas remain the binding constraint before increasing frequency.
