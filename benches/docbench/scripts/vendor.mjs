import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dependencyFile } from "../../scripts/dependency-file.mjs";

const dep = (relativePath) => dependencyFile(import.meta.url, relativePath);

await mkdir("public/vendor", { recursive: true });
await cp(
  dep("js-yaml/dist/browser/js-yaml.umd.min.js"),
  "public/vendor/js-yaml.min.js",
);
await cp(
  dep("marked/lib/marked.umd.js"),
  "public/vendor/marked.umd.js",
);
await cp(
  dep("@cantoo/pdf-lib/dist/pdf-lib.min.js"),
  "public/vendor/pdf-lib.min.js",
);
await cp(dep("fflate/umd/index.js"), "public/vendor/fflate.min.js");

await mkdir("public/vendor/jsonc-parser/impl", { recursive: true });
await cp(
  dep("jsonc-parser/lib/esm/impl/scanner.js"),
  "public/vendor/jsonc-parser/impl/scanner.js",
);
const jsonParser = await readFile(
  dep("jsonc-parser/lib/esm/impl/parser.js"),
  "utf8",
);
await writeFile(
  "public/vendor/jsonc-parser/impl/parser.js",
  jsonParser.replaceAll("from './scanner'", "from './scanner.js'"),
);

await mkdir("public/vendor/js-tiktoken/ranks", { recursive: true });
await cp(
  dep("js-tiktoken/dist/lite.js"),
  "public/vendor/js-tiktoken/lite.js",
);
const tiktokenChunkSource = await readFile(
  dep("js-tiktoken/dist/chunk-VL2OQCWN.js"),
  "utf8",
);
if (!tiktokenChunkSource.includes("base64-js")) {
  throw new Error("js-tiktoken lite dependency layout changed.");
}
await writeFile(
  "public/vendor/js-tiktoken/chunk-VL2OQCWN.js",
  tiktokenChunkSource
    .replaceAll('"base64-js"', '"./base64-js.mjs"')
    .replaceAll("'base64-js'", "'./base64-js.mjs'"),
);
await cp(
  dep("js-tiktoken/dist/ranks/o200k_base.js"),
  "public/vendor/js-tiktoken/ranks/o200k_base.js",
);
const base64Source = await readFile(dep("base64-js/index.js"), "utf8");
const base64Module = `${base64Source
  .replace("'use strict'\n\n", "")
  .replace("exports.byteLength = byteLength\n", "")
  .replace("exports.toByteArray = toByteArray\n", "")
  .replace("exports.fromByteArray = fromByteArray\n", "")}
const base64 = { byteLength, toByteArray, fromByteArray };
export { byteLength, toByteArray, fromByteArray };
export default base64;
`;
if (base64Module.includes("exports.")) {
  throw new Error("base64-js CommonJS layout changed.");
}
await writeFile("public/vendor/js-tiktoken/base64-js.mjs", base64Module);

await mkdir("public/fonts", { recursive: true });
for (const [source, target] of [
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", "space-grotesk-latin.woff2"],
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-ext-wght-normal.woff2", "space-grotesk-latin-ext.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", "space-mono-latin-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-400-normal.woff2", "space-mono-latin-ext-400.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", "space-mono-latin-700.woff2"],
  ["@fontsource/space-mono/files/space-mono-latin-ext-700-normal.woff2", "space-mono-latin-ext-700.woff2"],
]) {
  await cp(dep(source), `public/fonts/${target}`);
}

await mkdir("public/vendor/pdfjs", { recursive: true });
await cp(dep("pdfjs-dist/build/pdf.mjs"), "public/vendor/pdfjs/pdf.mjs");
await cp(
  dep("pdfjs-dist/build/pdf.worker.mjs"),
  "public/vendor/pdfjs/pdf.worker.mjs",
);

await mkdir("public/vendor/qpdf-run", { recursive: true });
for (const file of ["index.js", "browserRunner.js", "bytes.js", "worker.js"]) {
  await cp(dep(`qpdf-run/src/${file}`), `public/vendor/qpdf-run/${file}`);
}
await mkdir("public/vendor/qpdf/lib", { recursive: true });
await cp(
  dep("qpdf-run/vendor/qpdf/lib/qpdf.js"),
  "public/vendor/qpdf/lib/qpdf.js",
);
await cp(
  dep("qpdf-run/vendor/qpdf/lib/qpdf.wasm"),
  "public/vendor/qpdf/lib/qpdf.wasm",
);
