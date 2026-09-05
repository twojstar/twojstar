import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const publicFiles = (await readdir(publicDir))
  .filter((name) => name.endsWith(".js"))
  .sort();

const sources = new Map();
for (const name of publicFiles) {
  sources.set(`public/${name}`, await readFile(join(publicDir, name), "utf8"));
}
sources.set("public/index.html", await readFile(join(publicDir, "index.html"), "utf8"));

const forbidden = [
  ["local storage", /\blocalStorage\b/],
  ["session storage", /\bsessionStorage\b/],
  ["IndexedDB", /\bindexedDB\b/],
  ["cookies", /\bdocument\.cookie\b/],
  ["beacons", /\bnavigator\.sendBeacon\b/],
  ["WebSockets", /\bWebSocket\b/],
  ["EventSource", /\bEventSource\b/],
  ["URL state", /\b(?:history\.(?:pushState|replaceState)|location\.(?:hash|search))\b/],
];

const failures = [];
for (const [path, source] of sources) {
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${path} uses ${label}`);
  }
}

const fetchUsers = [];
for (const [path, source] of sources) {
  const count = source.match(/\bfetch\s*\(/g)?.length || 0;
  if (count) fetchUsers.push([path, count]);
}
if (fetchUsers.length !== 1 || fetchUsers[0][0] !== "public/logo-compat.js" || fetchUsers[0][1] !== 1) {
  failures.push(`unexpected browser fetch calls: ${JSON.stringify(fetchUsers)}`);
}

const logoCompat = sources.get("public/logo-compat.js") || "";
if (!/fetch\(url\.href,\s*\{[\s\S]*?credentials:\s*"omit"[\s\S]*?referrerPolicy:\s*"no-referrer"/.test(logoCompat)) {
  failures.push("remote logo fetch must omit credentials and the referrer");
}
if (/fetch\([^)]*(?:buildContent|f_pass|qrOptions)/.test(logoCompat)) {
  failures.push("remote logo fetch references QR form data");
}

const guard = sources.get("public/privacy-guard.js") || "";
for (const [label, pattern] of [
  ["masked Wi-Fi password", /input\.type\s*=\s*"password"/],
  ["password autocomplete isolation", /new-password/],
  ["spellcheck disabled", /spellcheck\s*=\s*false/],
  ["password cleared on page exit", /pagehide/],
  ["QR object cleanup", /qr\s*=\s*null/],
  ["print cache cleanup", /_printSVG\s*=\s*null/],
  ["rendered output cleanup", /qrHost"\)\?\.replaceChildren\(\)/],
  ["back-forward cache refresh", /pageshow/],
  ["QR disclosure", /Anyone who can scan the QR can read this password/],
]) {
  if (!pattern.test(guard)) failures.push(`privacy guard is missing ${label}`);
}

const worker = await readFile(join(root, "src", "index.ts"), "utf8");
if (!worker.includes('<script src="/privacy-guard.js"></script>')) {
  failures.push("Worker does not load privacy-guard.js");
}

if (failures.length) {
  console.error("Privacy checks failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Privacy checks passed for ${sources.size} browser files from ${relative(process.cwd(), root) || "."}.`);
