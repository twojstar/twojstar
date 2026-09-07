import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const benchesRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allProducts = ["codebench", "docbench", "streambench"];
const requestedProduct = process.argv[2];
const products = requestedProduct ? [requestedProduct] : allProducts;
const standaloneDisplays = new Set(["standalone", "minimal-ui", "fullscreen"]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

if (requestedProduct && !allProducts.includes(requestedProduct)) {
  throw new Error(`Unknown Bench: ${requestedProduct}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonc(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        output += "  ";
        blockComment = false;
        index += 1;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      blockComment = true;
      index += 1;
      continue;
    }
    output += char;
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (inString) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(output[lookahead] ?? "")) lookahead += 1;
      if (output[lookahead] === "}" || output[lookahead] === "]") continue;
    }
    normalized += char;
  }

  return JSON.parse(normalized);
}

function localImportPath(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const original = resolve(dirname(importer), specifier);
  const candidates = [original];
  const extension = extname(original);
  if (extension === ".js" || extension === ".mjs") {
    candidates.push(original.slice(0, -extension.length) + ".ts");
  } else if (!extension) {
    candidates.push(`${original}.ts`, `${original}.js`, `${original}.mjs`);
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function importedSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [
    /\b(?:import|export)\s+[^;]*?\bfrom\s*["']([^"']+)["']/gu,
    /\bimport\s*["']([^"']+)["']/gu,
  ]) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

function workerGraph(root, main) {
  const mainPath = join(root, main.replace(/^\.\//u, ""));
  const graph = new Map();
  const queue = [mainPath];

  while (queue.length > 0) {
    const path = queue.pop();
    if (!path || graph.has(path) || !existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    const imports = importedSpecifiers(source)
      .map((specifier) => localImportPath(path, specifier))
      .filter(Boolean);
    graph.set(path, { source, imports });
    queue.push(...imports);
  }

  return { graph, mainPath };
}

function canReach(graph, from, target, visited = new Set()) {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  return (graph.get(from)?.imports ?? []).some((next) => canReach(graph, next, target, visited));
}

function shellSource(root, main) {
  const paths = [join(root, "public", "index.html"), join(root, main.replace(/^\.\//u, ""))];
  return paths.filter(existsSync).map((path) => readFileSync(path, "utf8")).join("\n");
}

function linkHref(source, relation) {
  const links = source.match(/<link\b[^>]*>/giu) ?? [];
  for (const link of links) {
    const rel = link.match(/\brel\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (!rel?.split(/\s+/u).includes(relation)) continue;
    const href = link.match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (href) return { href, tag: link };
  }
  return null;
}

function pngDimensions(buffer, label) {
  assert(buffer.length >= 24 && buffer.subarray(0, 8).equals(pngSignature), `${label}: not a valid PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function generatedPng(route, graph, mainPath) {
  const routeFile = [...graph.entries()].find(([, entry]) => entry.source.includes(route))?.[0];
  if (!routeFile) return null;

  const responder = [...graph.entries()].find(([, entry]) => /export function faviconResponse\s*\(/u.test(entry.source))?.[0];
  const mainSource = graph.get(mainPath)?.source ?? "";
  assert(responder && canReach(graph, mainPath, responder), `${route}: icon responder is not reachable from the Worker entry`);
  assert(canReach(graph, responder, routeFile), `${route}: icon registry is not reachable from the responder`);
  assert(/faviconResponse\s*\(\s*url\.pathname\s*\)/u.test(mainSource), `${route}: Worker entry does not route URL paths through the icon responder`);

  const source = graph.get(routeFile).source;
  const routeIndex = source.indexOf(route);
  const assetSource = source.slice(routeIndex, routeIndex + 300_000);
  const match = assetSource.match(/type\s*:\s*["']image\/png["'][\s\S]{0,200}?data\s*:\s*["']([A-Za-z0-9+/=]+)["']/u);
  assert(match, `${route}: reachable Worker icon has no PNG payload`);
  return Buffer.from(match[1], "base64");
}

function workerRunsFirst(wrangler, route) {
  const setting = wrangler.assets?.run_worker_first;
  return setting === true || setting?.includes?.(route) === true;
}

function deliveredPng(root, publicRoot, route, wrangler, worker, expectedSize) {
  const staticPath = join(publicRoot, route.replace(/^\//u, ""));
  let buffer = existsSync(staticPath) ? readFileSync(staticPath) : null;

  if (!buffer) {
    assert(workerRunsFirst(wrangler, route), `${route}: generated icon is not routed through the Worker`);
    buffer = generatedPng(route, worker.graph, worker.mainPath);
  }

  assert(buffer, `${route}: PNG asset is not delivered`);
  const [width, height] = pngDimensions(buffer, route);
  if (expectedSize) {
    assert(width === expectedSize[0] && height === expectedSize[1], `${route}: expected ${expectedSize.join("x")}, got ${width}x${height}`);
  }
}

for (const product of products) {
  const root = join(benchesRoot, product);
  const publicRoot = join(root, "public");
  const manifestPath = join(publicRoot, "site.webmanifest");
  const wranglerPath = join(root, "wrangler.jsonc");

  assert(existsSync(manifestPath), `${product}: site.webmanifest is missing`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const wrangler = parseJsonc(readFileSync(wranglerPath, "utf8"));
  const shell = shellSource(root, wrangler.main);
  const worker = workerGraph(root, wrangler.main);

  assert(manifest.id, `${product}: manifest id is missing`);
  assert(manifest.name && manifest.short_name, `${product}: manifest app names are missing`);
  assert(manifest.start_url && manifest.scope, `${product}: manifest start_url/scope are missing`);
  assert(standaloneDisplays.has(manifest.display), `${product}: manifest is not standalone-capable`);
  assert(manifest.theme_color && manifest.background_color, `${product}: manifest colors are missing`);

  const manifestLink = linkHref(shell, "manifest");
  assert(manifestLink?.href === "/site.webmanifest", `${product}: served app shell does not discover /site.webmanifest`);

  const touchIcon = linkHref(shell, "apple-touch-icon");
  assert(touchIcon, `${product}: Apple touch icon is not declared`);
  const touchSize = touchIcon.tag.match(/\bsizes\s*=\s*["'](\d+)x(\d+)["']/iu);
  deliveredPng(
    root,
    publicRoot,
    touchIcon.href,
    wrangler,
    worker,
    touchSize ? [Number(touchSize[1]), Number(touchSize[2])] : null,
  );

  for (const size of [192, 512]) {
    const icon = manifest.icons?.find((entry) => entry.sizes === `${size}x${size}` && entry.type === "image/png");
    assert(icon?.src, `${product}: ${size}x${size} PNG manifest icon is missing`);
    deliveredPng(root, publicRoot, icon.src, wrangler, worker, [size, size]);
  }
}
