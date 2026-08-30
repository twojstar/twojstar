import assert from "node:assert/strict";

import {
  annotateProviderPlaylist,
  createSourceSignature,
  verifySourceSignature,
} from "../src/source-signing.ts";

const secret = "streambench-test-secret-0123456789abcdef";
const sourceUrl = "http://example.com/live/master.m3u8";
const signature = await createSourceSignature(sourceUrl, secret);

assert.match(signature, /^[A-Za-z0-9_-]{43}$/);
assert.equal(await verifySourceSignature(sourceUrl, signature, secret), true);
assert.equal(await verifySourceSignature("http://example.com/other.m3u8", signature, secret), false);
assert.equal(await verifySourceSignature(sourceUrl, signature, "different-streambench-test-secret-123456"), false);

await createSourceSignature(sourceUrl, secret);
const concurrentSecret = "streambench-concurrent-secret-fedcba9876543210";
const concurrentSignatures = await Promise.all([
  createSourceSignature(sourceUrl, concurrentSecret),
  createSourceSignature(sourceUrl, concurrentSecret),
]);
for (const concurrentSignature of concurrentSignatures) {
  assert.equal(await verifySourceSignature(sourceUrl, concurrentSignature, concurrentSecret), true);
}

const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="http",HTTP
${sourceUrl}
#EXTINF:-1 tvg-id="https",HTTPS
https://example.com/live/secure.m3u8
`;
const annotated = await annotateProviderPlaylist(
  playlist,
  "https://streambench.example/api/playlist?provider=iptv-org",
  secret,
);

assert.equal(annotated.enabled, true);
assert.equal(annotated.count, 1);
assert.match(annotated.body, /streambench-relay="https:\/\/streambench\.example\/api\/relay\?/);
assert.match(annotated.body, /sig=[A-Za-z0-9_-]{43}/);
assert.match(annotated.body, /#streambench\.m3u8/);
assert.match(annotated.body, /\nhttp:\/\/example\.com\/live\/master\.m3u8\n/);
assert.doesNotMatch(
  annotated.body.split("#EXTINF:-1 tvg-id=\"https\"")[1].split("\n")[0],
  /streambench-relay/,
);

console.log("source signing checks passed");
