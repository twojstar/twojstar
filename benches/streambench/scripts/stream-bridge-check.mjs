import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRecoverableHlsError, shouldWaitForHlsRecovery } from "../public/playback-recovery-policy.js";
import { parseProviderRelays } from "../public/provider-relay.js";
import { relayTarget } from "../public/stream-bridge.js";
import { activePlaylistIndex, playbackSubmissionContext, setActivePlaylistIndex, submitPlaybackForm } from "../public/playback-submission.js";

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
assert.equal(shouldWaitForHlsRecovery("HLS: manifestLoadError", "error", "idle"), true);
assert.equal(shouldWaitForHlsRecovery("HLS: manifestLoadError", "error", "pending"), true);
assert.equal(shouldWaitForHlsRecovery("HLS: manifestLoadError", "error", "exhausted"), false);

const submitted = [];
const fakeForm = {
  dataset: {},
  requestSubmit() { submitted.push(playbackSubmissionContext(fakeForm)); },
};
setActivePlaylistIndex(fakeForm, 0);
assert.equal(activePlaylistIndex(fakeForm), 0);
submitPlaybackForm(fakeForm, { preserveAttempt: true });
assert.deepEqual(submitted, [{ playlistIndex: 0, preserveSelection: true, preserveAttempt: true }]);
assert.equal(activePlaylistIndex(fakeForm), 0);
assert.equal(playbackSubmissionContext(fakeForm).playlistIndex, -1);

const [appSource, workspaceSource, bridgeSource, recoverySource, sourceWorkspaceSource] = await Promise.all([
  readFile(new URL("../client/app.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/playlist-workspace.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/stream-bridge.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/playback-recovery.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/source-workspace.ts", import.meta.url), "utf8"),
]);
assert.match(appSource, /import "\.\/stream-bridge\.js";/);
const playbackStart = appSource.indexOf("async function startPlaylistPlayback");
const playbackEnd = appSource.indexOf("function stopStreamPlayback", playbackStart);
assert.ok(playbackStart >= 0 && playbackEnd > playbackStart);
const webmcpPlayback = appSource.slice(playbackStart, playbackEnd);
assert.match(webmcpPlayback, /action\.click\(\)/);
assert.doesNotMatch(webmcpPlayback, /\bplayStream\s*\(\s*item\.url\b/);
assert.match(appSource, /playbackSubmissionContext/);
assert.match(workspaceSource, /StreambenchWorkspace/);
assert.match(workspaceSource, /submitPlaybackForm/);
assert.match(bridgeSource, /submitPlaybackForm/);
assert.match(recoverySource, /streambench:playback-stop/);
assert.match(sourceWorkspaceSource, /streambench:playback-stop/);
assert.match(sourceWorkspaceSource, /generation !== sourceGeneration/);

console.log("stream bridge checks passed");
