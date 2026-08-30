import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function checkSyntax(path) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}

for (const [directory, suffix] of [["src", ".js"], ["public", ".js"], ["scripts", ".mjs"]]) {
  for (const name of readdirSync(join(root, directory)).filter((entry) => entry.endsWith(suffix))) {
    checkSyntax(join(root, directory, name));
  }
}

execFileSync(process.execPath, [join(root, "scripts", "privacy-check.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const windows = process.platform === "win32";
execFileSync(windows ? "npx.cmd" : "npx", ["wrangler", "deploy", "--dry-run"], {
  cwd: root,
  stdio: "inherit",
  shell: windows,
});

const source = readFileSync(join(root, "src", "index.ts"), "utf8");
const wrangler = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const notFound = readFileSync(join(root, "public", "404.html"), "utf8");
const llms = readFileSync(join(root, "public", "llms.txt"), "utf8");

if (!source.includes('const SITE_URL = "https://codebench.trfny.com/";')) {
  throw new Error("Codebench canonical origin is not the custom domain");
}
if (!source.includes('href="/llms.txt"')) throw new Error("llms.txt discovery link is missing");
if (wrangler.assets?.not_found_handling !== "404-page") throw new Error("404 asset handling is missing");
if (!notFound.includes('name="robots" content="noindex,follow"')) throw new Error("404 page can be indexed");
if (!llms.includes("https://codebench.trfny.com/")) throw new Error("llms.txt canonical application URL is missing");

console.log("Codebench checks passed.");
