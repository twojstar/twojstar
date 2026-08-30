# [![Streambench](https://streambench.trfny.com/favicon-96x96.png)](https://streambench.trfny.com)

Browser-based workshop for testing IPTV, radio and other media streams.

## Current scope

- direct HTTP/HTTPS stream playback,
- constrained relay for bundled and signed provider streams,
- HLS playback through a locally vendored `hls.js`,
- live ICY and Radio Paradise track metadata,
- local M3U/M3U8 file and text import,
- local XMLTV file and text import with now/next programme display,
- local favorites, recent items, hidden entries and remembered preferences,
- non-destructive playlist entry editing,
- M3U export and clipboard copy with exact-URL deduplication,
- playlist filtering and entry selection,
- channel labels for provider, protocol, playback type and quality,
- browser-side stream diagnostics without a general diagnostic proxy,
- external video pages opened outside the media player,
- shared provider manifest and generic catalog routes,
- Free-TV Lite country playlists,
- iptv-org country and category catalogs,
- Radio Browser stations by country and popular tag,
- Cloudflare Worker static asset delivery with security headers.

User-provided playlists and XMLTV guides are parsed locally in the browser.
Public provider data and selected playlists are fetched through fixed,
allowlisted Worker endpoints. The media relay accepts bundled URLs and exact
HTTP sources signed by those provider endpoints. Arbitrary user-supplied URLs
are not signed or accepted by the provider relay.

The local library is stored in versioned `localStorage`. It contains favorites,
up to 20 recent entries, hidden entries, local edits and provider/player
preferences. No playlist, edit, guide or library state is uploaded.

Playlist edits are overlays and do not modify the original file. Export writes a
new M3U8 file or copies it to the clipboard. It preserves common M3U attributes,
`#EXTALB`, per-entry directives such as `#EXTVLCOPT`, MPD URLs and bare stream
URLs. Optional deduplication removes only identical URLs, so alternate streams
with the same channel name remain available. Hidden entries are omitted.

Free-TV Lite keeps HTTPS direct-media entries, excludes marked GeoIP streams
and removes duplicates. Poland is selected by default.

Radio Browser uses its resolved station URLs, keeps currently working HTTPS
stations and exposes up to 200 results sorted by votes. The Worker talks only to
the fixed Radio Browser API host with a descriptive User-Agent.

XMLTV programmes are matched to playlist channels through `tvg-id`. The guide
supports XMLTV timezone offsets and displays the current and next programme for
the selected channel. No guide URL is fetched by the Worker.

Known YouTube, Twitch and Vimeo pages are marked as external links instead of
being passed to the native media player. Unknown URLs remain neutral stream
candidates rather than being rejected based only on their file extension.

The diagnostics panel reports URL classification, mixed-content risk, media
element state and HLS manifest data observed by `hls.js`. Query values are
masked in the panel. Arbitrary user-supplied stream URLs are not sent through
the Worker.

This version has no general-purpose remote playlist import.

## Provider API

The browser loads provider metadata from `GET /api/providers` and uses:

- `GET /api/catalog?provider=<id>`,
- `GET /api/playlist?provider=<id>&type=<scope>&id=<value>`.

Existing `/api/providers/<id>/catalog` and `/api/providers/<id>/playlist`
routes remain available for compatibility. Provider IDs are resolved through a
fixed Worker registry; these endpoints are not a general remote fetcher.

## Development

```sh
cd benches
npm ci
npm run dev --workspace=streambench
```

The bundled IPTV and radio sources are maintained in `public/playlists/`.
`npm run build` also generates `public/portable.html` and vendors `hls.js`.
CSS, JavaScript, hls.js and the bundled playlists live inside that one file.
Public catalogs, metadata and constrained relay features still use the hosted
Streambench Worker.

## Validation

```sh
npm run check
```

## Deploy via Cloudflare Workers Builds

This project lives in the `trvny/trvny` monorepo under `benches/streambench/`.

1. In Cloudflare Workers & Pages create a Worker by importing `trvny/trvny`.
2. Set the Worker name to `streambench` and root directory to `benches`.
3. Use `npm run build:streambench` as the build command.
4. Use `npm run deploy:streambench` as the deploy command.
5. Use `npm run preview:streambench` as the non-production deploy command.
6. Add `benches/streambench/*`, `benches/package.json` and `benches/package-lock.json` to build watch includes.
7. Add `*.md` to the build watch excludes.
8. Add `STREAMBENCH_RELAY_SECRET` as a secret with at least 32 random
   characters.

A local authenticated deployment uses:

```sh
cd benches
npm exec --workspace=streambench -- wrangler secret put STREAMBENCH_RELAY_SECRET
npm run deploy --workspace=streambench
```

## Production smoke test

After deployment run:

```sh
npm run smoke -- https://streambench.example.workers.dev
```

The manual `Smoke streambench` GitHub workflow runs the same checks after
receiving the deployed HTTPS URL. It verifies health, the provider manifest,
generic and legacy catalog routes, and Polish Free-TV Lite and Radio Browser
playlists.
