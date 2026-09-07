import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const benchesRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allProducts = ["codebench", "docbench", "streambench"];
const requestedProduct = process.argv[2];
const products = requestedProduct ? [requestedProduct] : allProducts;
const standaloneDisplays = new Set(["standalone", "minimal-ui", "fullscreen"]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const wranglerBin = join(
  benchesRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

if (requestedProduct && !allProducts.includes(requestedProduct)) {
  throw new Error(`Unknown Bench: ${requestedProduct}`);
}
assert(existsSync(wranglerBin), "Wrangler is not installed; run npm ci in benches first");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  assert(port, "Could not allocate a local port for Wrangler");
  return port;
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(buffer, label) {
  assert(buffer.length >= 33 && buffer.subarray(0, 8).equals(pngSignature), `${label}: invalid PNG signature`);

  let offset = 8;
  let dimensions = null;
  let seenHeader = false;
  let seenEnd = false;
  const compressedParts = [];

  while (offset < buffer.length) {
    assert(offset + 12 <= buffer.length, `${label}: truncated PNG chunk header`);
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    assert(chunkEnd <= buffer.length, `${label}: truncated PNG chunk`);

    const typeBytes = buffer.subarray(typeStart, dataStart);
    const type = typeBytes.toString("ascii");
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    assert(actualCrc === expectedCrc, `${label}: invalid ${type} CRC`);

    if (!seenHeader) {
      assert(type === "IHDR" && length === 13, `${label}: PNG must start with a 13-byte IHDR`);
      dimensions = [data.readUInt32BE(0), data.readUInt32BE(4)];
      seenHeader = true;
    } else {
      assert(type !== "IHDR", `${label}: duplicate IHDR chunk`);
    }

    if (type === "IDAT") compressedParts.push(data);
    if (type === "IEND") {
      assert(length === 0, `${label}: invalid IEND chunk`);
      assert(chunkEnd === buffer.length, `${label}: trailing data after IEND`);
      seenEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  assert(seenHeader && seenEnd, `${label}: incomplete PNG structure`);
  assert(compressedParts.length > 0, `${label}: PNG has no image data`);
  try {
    inflateSync(Buffer.concat(compressedParts));
  } catch {
    throw new Error(`${label}: corrupt PNG image data`);
  }
  return dimensions;
}

async function fetchOk(url, label) {
  const response = await fetch(url);
  assert(response.ok, `${label}: HTTP ${response.status}`);
  return response;
}

async function validatePng(origin, href, expectedSize) {
  const url = new URL(href, origin).href;
  const response = await fetchOk(url, href);
  assert(response.headers.get("content-type")?.toLowerCase().startsWith("image/png"), `${href}: response is not image/png`);
  const dimensions = pngDimensions(Buffer.from(await response.arrayBuffer()), href);
  if (expectedSize) {
    assert(
      dimensions[0] === expectedSize[0] && dimensions[1] === expectedSize[1],
      `${href}: expected ${expectedSize.join("x")}, got ${dimensions.join("x")}`,
    );
  }
}

async function waitForWrangler(origin, child, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before becoming ready:\n${logs()}`);
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // The socket is expected to refuse connections briefly while workerd starts.
    }
    await delay(100);
  }
  throw new Error(`Wrangler did not become ready:\n${logs()}`);
}

async function stopWrangler(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) await delay(50);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function withWrangler(product, callback) {
  const root = join(benchesRoot, product);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(wranglerBin, ["dev", "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitForWrangler(origin, child, () => output);
    await callback(origin);
  } finally {
    await stopWrangler(child);
  }
}

async function checkProduct(product, origin) {
  const shellResponse = await fetchOk(`${origin}/`, `${product}: app shell`);
  const shell = await shellResponse.text();

  const manifestLink = linkHref(shell, "manifest");
  assert(manifestLink, `${product}: served app shell does not declare a manifest`);
  const manifestResponse = await fetchOk(new URL(manifestLink.href, origin), `${product}: manifest`);
  const manifest = await manifestResponse.json();

  assert(manifest.id, `${product}: manifest id is missing`);
  assert(manifest.name && manifest.short_name, `${product}: manifest app names are missing`);
  assert(manifest.start_url && manifest.scope, `${product}: manifest start_url/scope are missing`);
  assert(standaloneDisplays.has(manifest.display), `${product}: manifest is not standalone-capable`);
  assert(manifest.theme_color && manifest.background_color, `${product}: manifest colors are missing`);

  const touchIcon = linkHref(shell, "apple-touch-icon");
  assert(touchIcon, `${product}: Apple touch icon is not declared`);
  const touchSize = touchIcon.tag.match(/\bsizes\s*=\s*["'](\d+)x(\d+)["']/iu);
  await validatePng(
    origin,
    touchIcon.href,
    touchSize ? [Number(touchSize[1]), Number(touchSize[2])] : null,
  );

  for (const size of [192, 512]) {
    const icon = manifest.icons?.find((entry) => entry.sizes === `${size}x${size}` && entry.type === "image/png");
    assert(icon?.src, `${product}: ${size}x${size} PNG manifest icon is missing`);
    await validatePng(origin, icon.src, [size, size]);
  }
}

for (const product of products) {
  await withWrangler(product, (origin) => checkProduct(product, origin));
}
