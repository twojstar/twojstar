import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const backend = "https://streambench.travny.workers.dev";
const output = join(publicDir, "portable.html");

const mimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const inlineScript = (source) => source.replaceAll("</script", "<\\/script");

async function inlineCssAssets(css, sourceName) {
  const matches = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)];
  for (const match of matches) {
    const raw = match[2].trim();
    if (/^(?:data:|https?:|blob:|#)/i.test(raw)) continue;
    const relative = raw.startsWith("/")
      ? raw.slice(1)
      : posix.normalize(posix.join(posix.dirname(sourceName), raw));
    const type = mimeTypes.get(extname(relative).toLowerCase());
    if (!type) throw new Error(`unsupported CSS asset: ${relative}`);
    const bytes = await readFile(join(publicDir, relative));
    css = css.replace(match[0], `url("data:${type};base64,${bytes.toString("base64")}")`);
  }
  return css;
}

function moduleSpecifier(sourceName, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  return `bench/${posix.normalize(posix.join(posix.dirname(sourceName), specifier))}`;
}

function rewriteModule(source, sourceName) {
  const rewrite = (_match, prefix, specifier, suffix) => `${prefix}${moduleSpecifier(sourceName, specifier)}${suffix}`;
  let rewritten = source
    .replace(/(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])/g, rewrite)
    .replace(/(\bimport\s*["'])(\.{1,2}\/[^"']+)(["'])/g, rewrite)
    .replace(/(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, rewrite)
    .replaceAll("location.origin", '(location.protocol === "file:" ? window.__STREAMBENCH_BACKEND__ : location.origin)');

  if (sourceName === "app.js") {
    const needle = "media.src = url;";
    if (!rewritten.includes(needle)) throw new Error("media source assignment not found");
    rewritten = rewritten.replace(
      needle,
      'if (url.startsWith(window.__STREAMBENCH_BACKEND__)) media.crossOrigin = "anonymous";\n  else media.removeAttribute("crossorigin");\n  media.src = url;',
    );
  }
  return rewritten;
}

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

let html = await readFile(join(publicDir, "index.html"), "utf8");
const styles = [];
for (const match of [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>\s*/gi)]) {
  const relative = match[1].replace(/^\//, "");
  styles.push(await inlineCssAssets(await readFile(join(publicDir, relative), "utf8"), relative));
  html = html.replace(match[0], "");
}
html = html.replace("</head>", `<style data-portable-styles>\n${styles.join("\n")}\n</style>\n</head>`);

const hlsTag = /<script\s+src=["']\/?vendor\/hls\.min\.js["']\s*><\/script>\s*/i;
if (!hlsTag.test(html)) throw new Error("hls.js script tag not found");
const hls = inlineScript(await readFile(join(publicDir, "vendor", "hls.min.js"), "utf8"));
html = html.replace(hlsTag, `<script data-portable-source="vendor/hls.min.js">\n${hls}\n</script>\n`);

const entryModules = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["'][^>]*><\/script>\s*/gi)]
  .map((match) => match[1]);
if (entryModules.length === 0) throw new Error("module entry points not found");
if (!entryModules.includes("webmcp.js")) throw new Error("WebMCP module entry point not found");
html = html.replace(/<script\b[^>]*type=["']module["'][^>]*src=["'][^"']+["'][^>]*><\/script>\s*/gi, "");

const moduleFiles = (await readdir(publicDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name)
  .sort();
const imports = {};
for (const name of moduleFiles) {
  imports[`bench/${name}`] = dataModule(rewriteModule(await readFile(join(publicDir, name), "utf8"), name));
}
for (const entry of entryModules) {
  if (!imports[`bench/${entry}`]) throw new Error(`missing module: ${entry}`);
}

const playlists = {
  "/playlists/iptv.m3u8": await readFile(join(publicDir, "playlists", "iptv.m3u8"), "utf8"),
  "/playlists/internet_radio.m3u8": await readFile(join(publicDir, "playlists", "internet_radio.m3u8"), "utf8"),
};
const portableSetup = `window.__STREAMBENCH_BACKEND__=${JSON.stringify(backend)};\n`
  + `const __streambenchPlaylists=${JSON.stringify(playlists).replaceAll("<", "\\u003c")};\n`
  + `const __streambenchFetch=window.fetch.bind(window);\n`
  + `window.fetch=(input,init)=>{\n`
  + `  const raw=typeof input==="string"?input:input instanceof URL?input.href:input?.url||String(input);\n`
  + `  if(Object.hasOwn(__streambenchPlaylists,raw)){\n`
  + `    return Promise.resolve(new Response(__streambenchPlaylists[raw],{headers:{"content-type":"audio/x-mpegurl; charset=utf-8"}}));\n`
  + `  }\n`
  + `  if(raw.startsWith("/api/")){\n`
  + `    return __streambenchFetch(new URL(raw,window.__STREAMBENCH_BACKEND__).href,init);\n`
  + `  }\n`
  + `  return __streambenchFetch(input,init);\n`
  + `};`;
const importMap = JSON.stringify({ imports });
const bootstrap = entryModules.map((entry) => `import "bench/${entry}";`).join("\n");
html = html.replace("</body>", `<script data-portable-setup>\n${portableSetup}\n</script>\n<script type="importmap">${importMap}</script>\n<script type="module">\n${bootstrap}\n</script>\n</body>`);

html = html
  .replace(/<link\b[^>]*>\s*/gi, "")
  .replace('class="brand" href="/"', 'class="brand" href="#"');

const tagOnlyHtml = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1</script>");
for (const forbidden of [
  /<script\b[^>]*\bsrc=/i,
  /<link\b[^>]*\brel=["']stylesheet["']/i,
  /<script\b[^>]*type=["']module["'][^>]*\bsrc=/i,
]) {
  if (forbidden.test(tagOnlyHtml)) throw new Error(`portable output keeps external asset: ${forbidden}`);
}
if (!html.includes(backend) || !html.includes('type="importmap"')) {
  throw new Error("portable backend or module map missing");
}

await writeFile(output, `<!-- Generated by scripts/portable.mjs. Do not edit. -->\n${html}`);
console.log("Built public/portable.html");
