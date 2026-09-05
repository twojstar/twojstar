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
const llmsFull = readFileSync(join(root, "public", "llms-full.txt"), "utf8");
const indexMarkdown = readFileSync(join(root, "public", "index.md"), "utf8");
const index = readFileSync(join(root, "public", "index.html"), "utf8");
const portable = readFileSync(join(root, "public", "portable.html"), "utf8");
const webmcp = readFileSync(join(root, "public", "webmcp.js"), "utf8");

if (!source.includes('const SITE_URL = "https://codebench.trfny.com/";')) {
  throw new Error("Codebench canonical origin is not the custom domain");
}
if (!source.includes('rel="alternate" type="text/markdown" href="/index.md"')) throw new Error("Markdown alternate is missing");
if (!source.includes('rel="describedby" href="/llms.txt"')) throw new Error("llms.txt describedby link is missing");
if (!source.includes('rel="alternate"; type="text/markdown"') || !source.includes('rel="describedby"')) throw new Error("HTTP Link discovery header is missing");
if (wrangler.assets?.not_found_handling !== "404-page") throw new Error("404 asset handling is missing");
if (!notFound.includes('name="robots" content="noindex,follow"')) throw new Error("404 page can be indexed");
if (!llms.includes("https://codebench.trfny.com/index.md")) throw new Error("llms.txt Markdown application URL is missing");
if (!llms.includes("https://codebench.trfny.com/llms-full.txt")) throw new Error("llms.txt full guide URL is missing");
if (!indexMarkdown.startsWith("# Code Bench")) throw new Error("index.md is missing its H1");
if (!llmsFull.startsWith("# Code Bench full documentation")) throw new Error("llms-full.txt is missing its H1");
if (!index.includes('<script src="webmcp.js"></script>')) throw new Error("WebMCP page script is missing");
if (!index.includes("generation!==qrRenderGeneration") || !index.includes("lastQrContent=data")) throw new Error("QR payload cache is not gated by successful current-generation rendering");
if (!webmcp.includes("QR render failed")) throw new Error("WebMCP QR guarded-render error handling is missing");
if (!index.includes("ensureQrRendered:async") || !index.includes("await qrRenderPromise")) throw new Error("QR async render readiness bridge is missing");
if ((webmcp.match(/await waitForQrRendered\(\)/g) || []).length < 2) throw new Error("WebMCP QR setter/export do not await bounded render readiness");
if (!webmcp.includes("QR rendering timed out.")) throw new Error("WebMCP QR render wait is not bounded");
if (!webmcp.includes("await restoreQr(previous)")) throw new Error("WebMCP QR rollback is not awaited");
if (!webmcp.includes("truncatedFields")) throw new Error("WebMCP QR field payloads are not bounded");
const barcodeInputSyncs = webmcp.match(/byId\("bData"\)\.dispatchEvent\(new Event\("input"/g) || [];
if (barcodeInputSyncs.length < 2) throw new Error("WebMCP barcode writes do not preserve exact data across format synchronization");
if (!webmcp.includes("ui.hasQr()")) throw new Error("WebMCP QR export readiness guard is missing");
if (!index.includes("function invalidateQrRenderState()") || !index.includes("invalidateQrRenderState,")) throw new Error("QR render cache invalidation bridge is missing");
const privacyGuard = readFileSync(join(root, "public", "privacy-guard.js"), "utf8");
if (!privacyGuard.includes("invalidateQrRenderState")) throw new Error("Privacy teardown does not invalidate QR payload cache");
if (!index.includes("dataset.codebenchToolWrite")) throw new Error("Barcode tool format changes do not suppress intermediate rendering");
if (!webmcp.includes("formatSelect.dataset.codebenchToolWrite")) throw new Error("WebMCP barcode format sync does not mark tool-driven changes");
if (!index.includes("function pickTemplate(t,shouldRender=true)")) throw new Error("QR template switching cannot suppress intermediate renders");
if (!webmcp.includes("ui.pickTemplate(template, false)")) throw new Error("WebMCP QR setter still performs an intermediate template render");
if (!webmcp.includes("missingBarcodeControls")) throw new Error("WebMCP barcode control guard is missing");
if (!webmcp.includes("missingQrControls")) throw new Error("WebMCP QR control guard is missing");
for (const [helper, wrapperName, callee] of [
  ["logo-compat.js", "logoQrOptions", "originalQrOptions"],
  ["module-shapes.js", "decorativeModuleQrOptions", "originalQrOptions"],
  ["qr-palette.js", "paletteQrOptions", "previousOptions"],
]) {
  const helperSource = readFileSync(join(root, "public", helper), "utf8");
  const signature = `window.qrOptions = function ${wrapperName}(...args)`;
  const wrapperStart = helperSource.indexOf(signature);
  const wrapperBody = wrapperStart >= 0 ? helperSource.slice(wrapperStart, wrapperStart + 220) : "";
  if (!wrapperBody.includes(`${callee}(...args)`)) {
    throw new Error(`QR option wrapper does not forward payload arguments: ${helper}`);
  }
}
for (const toolName of ["read_code_state", "set_qr_code", "set_barcode", "export_code"]) {
  if (!portable.includes(`name: "${toolName}"`)) throw new Error(`Portable build is missing WebMCP tool: ${toolName}`);
}

console.log("Codebench checks passed.");
