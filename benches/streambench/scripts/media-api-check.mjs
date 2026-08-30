import assert from "node:assert/strict";
import { isPrivateHost, radioParadiseChannel, rewriteHlsManifest } from "../src/media-api.ts";
import { rewriteSignedHlsManifest } from "../src/signed-media-api.ts";

assert.equal(isPrivateHost("127.0.0.1"), true);
assert.equal(isPrivateHost("192.168.1.4"), true);
assert.equal(isPrivateHost("stream.radioparadise.com"), false);
assert.equal(isPrivateHost("fd18f1cadd404894a31a3362c5f319bd.mediatailor.us-east-1.amazonaws.com"), false);
assert.equal(isPrivateHost("fd00::1"), true);
assert.equal(isPrivateHost("::ffff:7f00:1"), true);
assert.equal(isPrivateHost("::ffff:c0a8:101"), true);
assert.equal(isPrivateHost("::ffff:8.8.8.8"), false);

assert.equal(radioParadiseChannel("http://stream-uk1.radioparadise.com/aac-320"), 0);
assert.equal(radioParadiseChannel("http://stream.radioparadise.com/ogg-192m"), 1);
assert.equal(radioParadiseChannel("http://stream.radioparadise.com/rock-320"), 2);
assert.equal(radioParadiseChannel("http://stream.radioparadise.com/global-320"), 3);
assert.equal(radioParadiseChannel("https://example.com/radio"), null);

const requestUrl = new URL("https://streambench.example/api/relay");
const sourceUrl = new URL("http://radio.example/master.m3u8");
const currentUrl = new URL("https://cdn.example/live/master.m3u8");
const authorizationParent = new URL("http://radio.example/redirecting-master.m3u8");
const rewritten = rewriteHlsManifest(
  '#EXTM3U\nvariant.m3u8\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\n',
  currentUrl,
  sourceUrl,
  requestUrl,
  authorizationParent,
);
const lines = rewritten.split("\n");
const variant = new URL(lines[1]);
assert.equal(variant.origin, requestUrl.origin);
assert.equal(variant.pathname, "/api/relay");
assert.equal(variant.searchParams.get("url"), "https://cdn.example/live/variant.m3u8");
assert.equal(variant.searchParams.get("source"), sourceUrl.href);
assert.equal(variant.searchParams.get("parent"), authorizationParent.href);
assert.match(lines[2], /https%3A%2F%2Fcdn\.example%2Flive%2Fkeys%2Fkey\.bin/);

const signature = "a".repeat(43);
const signed = rewriteSignedHlsManifest(
  '#EXTM3U\nvariant.m3u8\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\n',
  currentUrl,
  sourceUrl,
  requestUrl,
  signature,
  authorizationParent,
);
const signedLines = signed.split("\n");
const signedVariant = new URL(signedLines[1]);
assert.equal(signedVariant.searchParams.get("source"), sourceUrl.href);
assert.equal(signedVariant.searchParams.get("parent"), authorizationParent.href);
assert.equal(signedVariant.searchParams.get("sig"), signature);
assert.match(signedLines[2], new RegExp(`sig=${signature}`));

console.log("media API checks passed");
