import { readFile } from "node:fs/promises";

const projectUrl = new URL("../", import.meta.url);
const publicUrl = new URL("public/", projectUrl);

async function text(path) {
  return readFile(new URL(path, publicUrl), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [
  index,
  robots,
  sitemap,
  llms,
  llmsFull,
  indexMarkdown,
  manifestSource,
  socialImage,
  notFound,
  staticHeaders,
  wranglerSource,
  webmcp,
] = await Promise.all([
  text("index.html"),
  text("robots.txt"),
  text("sitemap.xml"),
  text("llms.txt"),
  text("llms-full.txt"),
  text("index.md"),
  text("site.webmanifest"),
  text("og.svg"),
  text("404.html"),
  text("_headers"),
  readFile(new URL("wrangler.jsonc", projectUrl), "utf8"),
  text("webmcp.js"),
]);

const origin = "https://streambench.trfny.com";
assert(index.includes(`<link rel="canonical" href="${origin}/">`), "canonical URL is missing");
assert(index.includes(`<meta property="og:url" content="${origin}/">`), "Open Graph URL is missing");
assert(index.includes('<meta name="twitter:card" content="summary_large_image">'), "Twitter card is missing");
assert(index.includes("max-image-preview:large"), "crawler preview directives are missing");
assert(index.includes('<link rel="sitemap" type="application/xml" href="/sitemap.xml">'), "sitemap link is missing");
assert(index.includes('<link rel="alternate" type="text/markdown" href="/index.md"'), "Markdown alternate is missing");
assert(index.includes('<link rel="describedby" href="/llms.txt"'), "llms.txt describedby link is missing");
assert(index.includes('application/ld+json'), "JSON-LD is missing");

assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`), "robots sitemap URL is missing");
assert(robots.includes("Disallow: /api/"), "API crawler rule is missing");
assert(sitemap.includes(`<loc>${origin}/</loc>`), "sitemap application URL is missing");
assert(llms.includes("# Streambench"), "llms.txt title is missing");
assert(llms.includes(`${origin}/index.md`), "llms.txt Markdown application URL is missing");
assert(llms.includes(`${origin}/llms-full.txt`), "llms.txt full guide URL is missing");
assert(llmsFull.startsWith("# Streambench full documentation"), "llms-full.txt title is missing");
assert(indexMarkdown.startsWith("# Streambench"), "index.md title is missing");
assert(llms.includes("https://trfny.com/"), "TRAVNY hub is missing from llms.txt");
assert(index.includes('<script type="module" src="/webmcp.js"></script>'), "WebMCP page module is missing");
for (const toolName of ["read_stream_state", "search_streams", "start_stream_playback", "stop_stream_playback"]) {
  assert(webmcp.includes(`name: "${toolName}"`), `WebMCP module is missing tool: ${toolName}`);
}

const manifest = JSON.parse(manifestSource);
assert(manifest.id === "/", "manifest id is missing");
assert(manifest.lang === "pl", "manifest language is missing");
assert(manifest.categories?.includes("utilities"), "manifest category is missing");
assert(socialImage.includes('viewBox="0 0 1200 630"'), "social preview dimensions are invalid");
assert(socialImage.includes("streambench.trfny.com"), "social preview canonical domain is missing");
assert(!socialImage.includes("streambench.travny.workers.dev"), "social preview still advertises the workers.dev domain");

const wrangler = JSON.parse(wranglerSource);
const workerRoutes = wrangler.assets?.run_worker_first;
assert(wrangler.assets?.not_found_handling === "404-page", "404 asset handling is missing");
assert(Array.isArray(workerRoutes), "Worker asset routing is not selective");
assert(workerRoutes.includes("/"), "homepage does not run through Worker for canonical redirect");
assert(workerRoutes.includes("/index.html"), "index alias does not run through Worker");
assert(workerRoutes.includes("/api/*"), "API routes do not run through Worker");
assert(workerRoutes.includes("/health"), "health route does not run through Worker");
assert(!workerRoutes.includes("/*"), "all static assets still run through Worker");
assert(notFound.includes('<meta name="robots" content="noindex">'), "404 page can be indexed");
assert(staticHeaders.includes("Content-Security-Policy:"), "static CSP is missing");
assert(staticHeaders.includes("X-Frame-Options: DENY"), "static frame protection is missing");

console.log("SEO and discovery checks passed");
