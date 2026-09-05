# Doc Bench — Document & PDF Studio

Local-first document toolbox in the Bench family. Files are processed in the
browser and are not uploaded.

Documents cover TXT, Markdown, JSON, YAML/YML and XML editing, UTF-8 BOM and
line-ending handling, validation and explicit formatting. Markdown gets a safe
rendered preview, JSON/YAML/XML get collapsible tree views, and supported
browsers can save changes directly back to a chosen local file. Download remains
available as the portable fallback.

PDF tools cover local preview, merge, page deletion/reordering, single-page
extraction, split-to-ZIP, bookmark, document-metadata and embedded-file editing,
lossless optimization, optional lossy image recompression and Fast Web View. Bookmark
trees, metadata and attachments are rebuilt or preserved as needed and verified
before every PDF download. Metadata edits keep trailer Info and XMP consistent; PDF/A XMP keeps
foreign extension blocks intact.

## Local

```sh
cd benches
npm ci
npm run dev --workspace=docbench
```

`npm run build` vendors browser dependencies and creates
`public/portable.html`.

## Deploy via Cloudflare Workers Builds

Use `benches` as the root directory, `npm run build:docbench` as the build
command, `npm run deploy:docbench` as the deploy command and
`npm run preview:docbench` for non-production branches. Build watch includes
should cover `benches/docbench/*`, `benches/package.json` and `benches/package-lock.json`; exclude `*.md`.
