import { copyFile, mkdir } from "node:fs/promises";
import { dependencyFile } from "../../scripts/dependency-file.mjs";

await mkdir(new URL("../public/vendor/", import.meta.url), { recursive: true });
await copyFile(
  dependencyFile(import.meta.url, "hls.js/dist/hls.min.js"),
  new URL("../public/vendor/hls.min.js", import.meta.url),
);

console.log("Vendored hls.js");
