import assert from "node:assert/strict";
import { isPrivateHost, relayUpstream, rewriteManifest, safeRemoteUrl } from "../src/relay-core.ts";

assert.equal(safeRemoteUrl("http://user:pass@example.com/a"), null);
assert.equal(safeRemoteUrl("file:///etc/passwd"), null);
assert.equal(safeRemoteUrl("http://10.0.0.1/stream"), null);
assert.equal(isPrivateHost("example.com"), false);

const requestUrl = new URL("https://streambench.example/api/relay");
const currentUrl = new URL("https://cdn.example/live/master.m3u8");
const sourceUrl = new URL("http://radio.example/master.m3u8");
const unsigned = rewriteManifest("#EXTM3U\nvariant.m3u8\n", currentUrl, sourceUrl, requestUrl);
assert.equal(new URL(unsigned.split("\n")[1]).searchParams.get("sig"), null);

const originalFetch = globalThis.fetch;
function stubFetch(body, headers) {
  globalThis.fetch = async () => new Response(body, { status: 200, headers });
}

try {
  stubFetch("#EXTM3U\nvariant.m3u8\n", { "content-type": "application/vnd.apple.mpegurl" });
  const target = new URL("http://radio.example/master.m3u8");
  const manifestResponse = await relayUpstream(new Request(requestUrl), {
    target,
    source: target,
    requestUrl,
    signature: "b".repeat(43),
    label: "signed-provider",
  });
  assert.equal(manifestResponse.headers.get("x-streambench-relay"), "signed-provider");
  assert.equal(manifestResponse.headers.get("cache-control"), "no-store");
  const rewritten = new URL((await manifestResponse.text()).split("\n")[1]);
  assert.equal(rewritten.pathname, "/api/relay");
  assert.equal(rewritten.searchParams.get("url"), "http://radio.example/variant.m3u8");
  assert.equal(rewritten.searchParams.get("sig"), "b".repeat(43));

  stubFetch("binary-segment", { "content-type": "video/mp2t" });
  const segmentResponse = await relayUpstream(new Request(requestUrl), {
    target: new URL("http://radio.example/live/segment.ts"),
    source: new URL("http://radio.example/master.m3u8"),
    requestUrl,
  });
  assert.equal(segmentResponse.headers.get("x-streambench-relay"), "1");
  assert.equal(segmentResponse.headers.get("content-type"), "video/mp2t");
  assert.equal(await segmentResponse.text(), "binary-segment");

  globalThis.fetch = async () => new Response("nope", { status: 404 });
  const failed = await relayUpstream(new Request(requestUrl), {
    target: new URL("http://radio.example/gone.m3u8"),
    source: new URL("http://radio.example/gone.m3u8"),
    requestUrl,
  });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, "upstream_unavailable");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("relay core checks passed");
