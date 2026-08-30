import { mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { dependencyFile, workspaceDirectory } from "../../scripts/dependency-file.mjs";

// Copy runtime libraries and fonts out of node_modules so production performs
// no third-party CDN requests and remains usable offline after assets are cached.
const root = workspaceDirectory(import.meta.url);

const files = [
  ["qr-code-styling/lib/qr-code-styling.js", "public/vendor/qr-code-styling.js"],
  ["bwip-js/dist/bwip-js-min.js", "public/vendor/bwip-js-min.js"],
  ["zxing-wasm/dist/iife/reader/index.js", "public/vendor/zxing-wasm-reader.js"],
  ["zxing-wasm/dist/reader/zxing_reader.wasm", "public/vendor/zxing_reader.wasm"],
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", "public/fonts/space-grotesk-latin.woff2"],
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2", "public/fonts/space-grotesk-latin-ext.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", "public/fonts/space-mono-latin-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-400-normal.woff2", "public/fonts/space-mono-latin-ext-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", "public/fonts/space-mono-latin-700.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-700-normal.woff2", "public/fonts/space-mono-latin-ext-700.woff2"],
];

for (const [from, to] of files) {
  const output = `${root}/${to}`;
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(dependencyFile(import.meta.url, from), output);
  console.log("vendored", to);
}
