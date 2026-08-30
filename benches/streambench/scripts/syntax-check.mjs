import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function collectJavaScript(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "vendor") continue;
    if (entry.isFile() && entry.name.startsWith("favicon-")) continue;

    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScript(url));
    } else if (/\.(?:mjs|js)$/.test(entry.name)) {
      files.push(url);
    }
  }
  return files;
}

const files = [
  ...await collectJavaScript(new URL("../src/", import.meta.url)),
  ...await collectJavaScript(new URL("../public/", import.meta.url)),
  new URL("portable.mjs", import.meta.url),
  new URL("smoke.mjs", import.meta.url),
  new URL("vendor.mjs", import.meta.url),
].sort((left, right) => left.href.localeCompare(right.href));

for (const file of files) {
  execFileSync(process.execPath, ["--check", fileURLToPath(file)], { stdio: "inherit" });
}

console.log(`Syntax checks passed for ${files.length} files.`);
