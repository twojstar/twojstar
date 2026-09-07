import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const benchesRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allProducts = ["codebench", "docbench", "streambench"];
const requestedProduct = process.argv[2];
const products = requestedProduct ? [requestedProduct] : allProducts;
const standaloneDisplays = new Set(["standalone", "minimal-ui", "fullscreen"]);

if (requestedProduct && !allProducts.includes(requestedProduct)) {
  throw new Error(`Unknown Bench: ${requestedProduct}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceText(directory) {
  if (!existsSync(directory)) return "";
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceText(path);
      if (!/\.(?:html|js|mjs|ts|jsonc?)$/u.test(entry.name)) return "";
      return readFileSync(path, "utf8");
    })
    .join("\n");
}

for (const product of products) {
  const root = join(benchesRoot, product);
  const publicRoot = join(root, "public");
  const manifestPath = join(publicRoot, "site.webmanifest");
  const wranglerPath = join(root, "wrangler.jsonc");

  assert(existsSync(manifestPath), `${product}: site.webmanifest is missing`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const wrangler = JSON.parse(readFileSync(wranglerPath, "utf8"));
  const servedSource = `${sourceText(publicRoot)}\n${sourceText(join(root, "src"))}`;

  assert(manifest.id, `${product}: manifest id is missing`);
  assert(manifest.name && manifest.short_name, `${product}: manifest app names are missing`);
  assert(manifest.start_url && manifest.scope, `${product}: manifest start_url/scope are missing`);
  assert(standaloneDisplays.has(manifest.display), `${product}: manifest is not standalone-capable`);
  assert(manifest.theme_color && manifest.background_color, `${product}: manifest colors are missing`);
  assert(servedSource.includes('<link rel="manifest" href="/site.webmanifest">'), `${product}: manifest is not linked from the served app shell`);
  assert(servedSource.includes('rel="apple-touch-icon"'), `${product}: Apple touch icon is not declared`);

  for (const size of ["192x192", "512x512"]) {
    const icon = manifest.icons?.find((entry) => entry.sizes === size && entry.type === "image/png");
    assert(icon?.src, `${product}: ${size} PNG manifest icon is missing`);

    const relativeIcon = icon.src.replace(/^\//u, "");
    const staticIcon = existsSync(join(publicRoot, relativeIcon));
    const generatedIcon = servedSource.includes(icon.src);
    const workerFirst = wrangler.assets?.run_worker_first === true
      || wrangler.assets?.run_worker_first?.includes?.(icon.src);

    assert(staticIcon || (generatedIcon && workerFirst), `${product}: ${icon.src} is neither a static asset nor a Worker-served icon`);
  }

  console.log(`${product}: installable web-app contract passed`);
}
