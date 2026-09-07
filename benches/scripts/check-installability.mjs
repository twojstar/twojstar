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
const wranglerCli = join(benchesRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const requestTimeoutMs = 10_000;
const readinessTimeoutMs = 1_000;

if (requestedProduct && !allProducts.includes(requestedProduct)) {
  throw new Error(`Unknown Bench: ${requestedProduct}`);
}
assert(existsSync(wranglerCli), "Wrangler is not installed; run npm ci in benches first");

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

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "iu"));
  return match?.[1] ?? match?.[2] ?? null;
}

function visibleHtmlSegments(source) {
  const segments = [];
  let cursor = 0;
  while (cursor < source.length) {
    const commentStart = source.indexOf("<!--", cursor);
    if (commentStart === -1) {
      segments.push(source.slice(cursor));
      break;
    }
    segments.push(source.slice(cursor, commentStart));
    const commentEnd = source.indexOf("-->", commentStart + 4);
    if (commentEnd === -1) break;
    cursor = commentEnd + 3;
  }
  return segments;
}

function linkHref(source, relation) {
  for (const segment of visibleHtmlSegments(source)) {
    const links = segment.match(/<link\b[^>]*>/giu) ?? [];
    for (const link of links) {
      const rel = attributeValue(link, "rel");
      if (!rel?.toLowerCase().split(/\s+/u).includes(relation.toLowerCase())) continue;
      const href = attributeValue(link, "href");
      if (href) return { href, tag: link };
    }
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

function colorChannels(colorType, label) {
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  assert(channels, `${label}: unsupported PNG color type ${colorType}`);
  return channels;
}

function validateBitDepth(bitDepth, colorType, label) {
  const allowed = {
    0: new Set([1, 2, 4, 8, 16]),
    2: new Set([8, 16]),
    3: new Set([1, 2, 4, 8]),
    4: new Set([8, 16]),
    6: new Set([8, 16]),
  }[colorType];
  assert(allowed?.has(bitDepth), `${label}: invalid PNG bit depth ${bitDepth} for color type ${colorType}`);
}

function passExtent(size, start, step) {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function validateScanlines(data, width, height, bitDepth, colorType, interlace, label) {
  const channels = colorChannels(colorType, label);
  const passes = interlace === 0
    ? [[0, 0, 1, 1]]
    : [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ];

  let offset = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = passExtent(width, startX, stepX);
    const passHeight = passExtent(height, startY, stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * channels * bitDepth) / 8);
    for (let row = 0; row < passHeight; row += 1) {
      assert(offset + 1 + rowBytes <= data.length, `${label}: truncated PNG scanline data`);
      assert(data[offset] <= 4, `${label}: invalid PNG filter type ${data[offset]}`);
      offset += 1 + rowBytes;
    }
  }
  assert(offset === data.length, `${label}: unexpected PNG scanline data length`);
}

function inflatePng(parts, label) {
  try {
    return inflateSync(Buffer.concat(parts));
  } catch {
    throw new Error(`${label}: corrupt PNG image data`);
  }
}

function pngDimensions(buffer, label) {
  assert(buffer.length >= 33 && buffer.subarray(0, 8).equals(pngSignature), `${label}: invalid PNG signature`);

  let offset = 8;
  let dimensions = null;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  let seenHeader = false;
  let seenEnd = false;
  let seenPalette = false;
  let seenIdat = false;
  let idatEnded = false;
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
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert(width > 0 && height > 0, `${label}: invalid PNG dimensions`);
      validateBitDepth(bitDepth, colorType, label);
      assert(data[10] === 0, `${label}: unsupported PNG compression method`);
      assert(data[11] === 0, `${label}: unsupported PNG filter method`);
      assert(data[12] === 0 || data[12] === 1, `${label}: invalid PNG interlace method`);
      interlace = data[12];
      dimensions = [width, height];
      seenHeader = true;
    } else {
      assert(type !== "IHDR", `${label}: duplicate IHDR chunk`);
    }

    if (type === "PLTE") {
      assert(!seenPalette, `${label}: duplicate PLTE chunk`);
      assert(colorType !== 0 && colorType !== 4, `${label}: PLTE is not allowed for color type ${colorType}`);
      assert(!seenIdat, `${label}: PLTE appears after IDAT`);
      assert(length > 0 && length % 3 === 0 && length <= 768, `${label}: invalid PLTE chunk`);
      if (colorType === 3) assert(length / 3 <= 2 ** bitDepth, `${label}: PLTE exceeds indexed bit depth`);
      seenPalette = true;
    }

    if (type === "IDAT") {
      assert(!idatEnded, `${label}: non-consecutive IDAT chunks`);
      seenIdat = true;
      compressedParts.push(data);
    } else if (seenIdat && type !== "IEND") {
      idatEnded = true;
    }

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
  if (colorType === 3) assert(seenPalette, `${label}: indexed PNG has no PLTE chunk`);

  const inflated = inflatePng(compressedParts, label);
  validateScanlines(inflated, dimensions[0], dimensions[1], bitDepth, colorType, interlace, label);
  return dimensions;
}

async function fetchOk(url, label, options = {}) {
  let response = null;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) {
    throw new Error(`${label}: request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(response.ok, `${label}: HTTP ${response.status}`);
  return response;
}

async function validatePng(baseUrl, href, expectedSize) {
  const url = new URL(href, baseUrl).href;
  const response = await fetchOk(url, href);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  assert(contentType === "image/png", `${href}: response is not image/png`);
  const dimensions = pngDimensions(Buffer.from(await response.arrayBuffer()), href);
  if (expectedSize) {
    assert(
      dimensions[0] === expectedSize[0] && dimensions[1] === expectedSize[1],
      `${href}: expected ${expectedSize.join("x")}, got ${dimensions.join("x")}`,
    );
  }
}

async function waitForWrangler(origin, child, logs, launchError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (launchError()) throw new Error(`Wrangler failed to launch: ${launchError().message}`);
    if (child.exitCode !== null) throw new Error(`Wrangler exited before becoming ready:\n${logs()}`);
    try {
      const response = await fetch(origin, {
        redirect: "manual",
        signal: AbortSignal.timeout(readinessTimeoutMs),
      });
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
  const child = spawn(process.execPath, [wranglerCli, "dev", "--ip", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let childError = null;
  child.once("error", (error) => { childError = error; });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitForWrangler(origin, child, () => output, () => childError);
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
  const touchSize = attributeValue(touchIcon.tag, "sizes")?.match(/^(\d+)x(\d+)$/iu);
  await validatePng(
    origin,
    touchIcon.href,
    touchSize ? [Number(touchSize[1]), Number(touchSize[2])] : null,
  );

  for (const size of [192, 512]) {
    const icon = manifest.icons?.find((entry) => entry.sizes === `${size}x${size}` && entry.type === "image/png");
    assert(icon?.src, `${product}: ${size}x${size} PNG manifest icon is missing`);
    await validatePng(manifestResponse.url, icon.src, [size, size]);
  }
}

for (const product of products) {
  await withWrangler(product, (origin) => checkProduct(product, origin));
}
