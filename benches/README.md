# Benches

Shared npm workspace for the three browser tools in the Bench family:

- [`codebench/`](codebench/) — QR and barcode studio;
- [`docbench/`](docbench/) — local-first document and PDF studio;
- [`streambench/`](streambench/) — IPTV, radio, HLS, M3U and XMLTV workshop.

The applications remain separate Cloudflare Workers with independent runtime
boundaries and `wrangler.jsonc` files. The workspace only centralizes dependency
installation, lockfile maintenance and common CI entry points.

```sh
cd benches
npm ci
npm run check
```

Run one project with `npm run check:<name>` or `npm run build:<name>`.
Cloudflare Workers Builds uses `benches` as the root directory and the matching
`build:<name>`, `deploy:<name>` and `preview:<name>` scripts for each Worker.

A dependency or source change inside one Bench should normally trigger only that
Worker. Changes to `benches/package.json` and `benches/package-lock.json` are shared policy and should trigger all
three builds.
