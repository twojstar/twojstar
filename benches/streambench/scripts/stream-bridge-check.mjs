import assert from "node:assert/strict";
import { isRecoverableHlsError } from "../public/playback-recovery.js";
import { parseProviderRelays } from "../public/provider-relay.js";
import { relayTarget } from "../public/stream-bridge.js";

const origin = "https://streambench.example";
const httpRadio = "http://radio.example/live.mp3?token=abc";
const hls = "https://video.example/live/master.m3u8?token=abc";
const httpsAudio = "https://radio.example/live.mp3";
const bundledUrls = new Set([httpRadio, hls, httpsAudio]);

const radioRelay = relayTarget(httpRadio, { origin, bundledUrls });
assert.equal(radioRelay?.origin, origin);
assert.equal(radioRelay?.pathname, "/api/relay");
assert.equal(radioRelay?.searchParams.get("url"), httpRadio);
assert.equal(radioRelay?.hash, "#streambench.mp3");

const hlsRelay = relayTarget(hls, { origin, bundledUrls });
assert.equal(hlsRelay?.searchParams.get("url"), hls);
assert.equal(hlsRelay?.hash, "#streambench.m3u8");

const providerSource = "http://provider.example/live/master.m3u8";
const providerRelay = `${origin}/api/relay?url=${encodeURIComponent(providerSource)}&sig=${"a".repeat(43)}#streambench.m3u8`;
const providerRelays = parseProviderRelays(
  `#EXTM3U\n#EXTINF:-1 streambench-relay="${providerRelay}",Provider\n${providerSource}\n`,
  origin,
);
const signedRelay = relayTarget(providerSource, { origin, bundledUrls, providerRelays });
assert.equal(signedRelay?.href, providerRelay);

assert.equal(relayTarget(httpsAudio, { origin, bundledUrls }), null);
assert.equal(relayTarget("http://other.example/live.mp3", { origin, bundledUrls }), null);
assert.equal(relayTarget("not a url", { origin, bundledUrls }), null);

assert.equal(isRecoverableHlsError("HLS: manifestLoadError"), true);
assert.equal(isRecoverableHlsError("HLS: fragLoadTimeOut"), true);
assert.equal(isRecoverableHlsError("HLS: bufferAppendError"), false);
assert.equal(isRecoverableHlsError("HLS: manifestLoadError", "loading"), false);

console.log("stream bridge checks passed");
