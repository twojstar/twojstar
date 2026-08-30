# [Code Bench — QR & Barcode Studio](https://codebench.trfny.com)

[![codebench](public/apple-touch-icon.png)](https://codebench.trfny.com)

Client-side QR and barcode studio. The UI remains a single HTML document,
while a small Cloudflare Worker wraps static assets with security headers,
local font injection, and a focused hardening module. Scanned and generated
values never leave the browser.

Runtime libraries and fonts are copied from pinned npm packages into `public/`
during the build. Production performs no Google Fonts or other third-party CDN
requests.

## Deploy via Cloudflare Workers Builds

This lives in the `trvny/trvny` monorepo under `benches/codebench/`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** →
   **Import a repository**.
2. Connect GitHub and select **trvny/trvny**.
3. Configure:
   - **Worker name:** `codebench`
   - **Root directory:** `benches`
   - **Build command:** `npm run build:codebench`
   - **Deploy command:** `npm run deploy:codebench`
   - **Preview deploy command:** `npm run preview:codebench`
4. Set build watch includes to `benches/codebench/*`, `benches/package.json` and `benches/package-lock.json`; exclude `*.md`.
5. Deploy.

The camera scanner needs HTTPS or localhost.

## Local

```sh
cd benches
npm ci
npm run dev --workspace=codebench
```

`npm run build` also generates `public/portable.html`: a single-file build with
its runtime libraries, fonts and ZXing WASM embedded. It can be saved and opened
without the Worker.

`npm run typecheck` generates Worker types from `wrangler.jsonc` and runs strict
TypeScript checks. `npm run deploy` builds vendored assets and deploys them.

## Layout

- `public/index.html` — UI and original application logic;
- `public/hardening.js` — validation, safe exports, bounded image work,
  and print fixes;
- `public/fonts.css` — self-hosted Space Grotesk and Space Mono declarations;
- `src/index.ts` — static-asset Worker, HTML injection, and security headers;
- `scripts/vendor.mjs` — copies pinned libraries and WOFF2 files from
  `node_modules`;
- `scripts/portable.mjs` — generates the standalone HTML build.

Generated `worker-configuration.d.ts`, `public/vendor/`, `public/fonts/`,
`public/portable.html`, and `node_modules/` remain ignored by Git.
