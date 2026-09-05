import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const benchesDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const products = new Set(["codebench", "docbench", "streambench"]);
const product = process.argv[2];

if (!products.has(product)) {
  throw new Error(`Expected one bench name, got: ${product || "<empty>"}`);
}

const source = join(benchesDir, "shared", "i18n-runtime.js");
const targetDir = join(benchesDir, product, "public");
const target = join(targetDir, "i18n-runtime.js");

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);
console.log(`Synced shared i18n runtime for ${product}`);