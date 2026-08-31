import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  beginPlaybackAttemptForTarget,
  completePlaybackAttemptIfTerminal,
  createPlaybackAttemptCoordinator,
} from "../public/playback-attempt.js";

const attempts = createPlaybackAttemptCoordinator();
const first = attempts.begin();
const second = attempts.begin();
assert.equal(attempts.current()?.id, second.id);
assert.equal(first.signal.aborted, true);
assert.equal(first.signal.reason, "superseded");
assert.equal(second.signal.aborted, false);
attempts.cancel("stopped");
assert.equal(attempts.current(), null);
assert.equal(second.signal.aborted, true);
assert.equal(second.signal.reason, "stopped");
const completed = attempts.begin();
attempts.complete(completed);
attempts.cancel("stopped");
assert.equal(completed.signal.aborted, false);

const guarded = createPlaybackAttemptCoordinator();
const validPending = guarded.begin();
for (const rejected of [null, { hidden: true, item: {} }, { hidden: false, item: { external: true } }]) {
  assert.equal(beginPlaybackAttemptForTarget(guarded, rejected).ok, false);
  assert.equal(validPending.signal.aborted, false);
}
const validReplacement = beginPlaybackAttemptForTarget(guarded, { hidden: false, item: { external: false } });
assert.equal(validReplacement.ok, true);
assert.equal(validPending.signal.aborted, true);
assert.equal(validPending.signal.reason, "superseded");

const pendingCoordinator = createPlaybackAttemptCoordinator();
const pendingAttempt = pendingCoordinator.begin();
assert.equal(completePlaybackAttemptIfTerminal(pendingCoordinator, pendingAttempt, { pending: true }), false);
pendingCoordinator.cancel("stopped");
assert.equal(pendingAttempt.signal.aborted, true);
const terminalAttempt = pendingCoordinator.begin();
assert.equal(completePlaybackAttemptIfTerminal(pendingCoordinator, terminalAttempt, { pending: false }), true);
pendingCoordinator.cancel("stopped");
assert.equal(terminalAttempt.signal.aborted, false);

const appSource = readFileSync(new URL("../client/app.ts", import.meta.url), "utf8");
assert.match(appSource, /options\.preserveAttempt \? playbackAttempts\.current\(\) : null/);
assert.match(appSource, /shouldWaitForHlsRecovery/);
assert.match(appSource, /persistActivePlaylistIndex\(ui\.form, -1\)/);
assert.match(appSource, /if \(!ownedAttempt\) playbackAttempts\.cancel\("superseded"\)/);
assert.match(appSource, /void settlePendingPlaybackAttempt\(attempt, effectiveEntry\)/);
assert.match(appSource, /dispatchEvent\(new Event\("streambench:playback-stop"\)\)/);

const tools = new Map();
globalThis.document = {
  modelContext: {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  },
};
globalThis.window = { addEventListener() {} };
const calls = [];
globalThis.StreambenchUi = {
  readState: () => ({ status: "idle" }),
  searchEntries: (query, limit) => ({ total: 1, items: [{ index: 7, title: `edited:${query}` }], limit }),
  startPlayback: async (index) => { calls.push(["start", index]); return { ok: true, started: true }; },
  stopPlayback: () => { calls.push(["stop"]); return { ok: true }; },
};

await import(`../public/webmcp.js?check=${Date.now()}`);
assert.deepEqual([...tools.keys()].sort(), [
  "read_stream_state",
  "search_streams",
  "start_stream_playback",
  "stop_stream_playback",
].sort());
assert.deepEqual(tools.get("read_stream_state").execute(), { ok: true, status: "idle" });
const search = tools.get("search_streams").execute({ query: "name", limit: 3 });
assert.equal(search.items[0].title, "edited:name");
assert.equal((await tools.get("start_stream_playback").execute({ index: 7 })).started, true);
assert.equal(tools.get("stop_stream_playback").execute().ok, true);
assert.deepEqual(calls, [["start", 7], ["stop"]]);
assert.equal(tools.get("start_stream_playback").execute({ index: -1 }).ok, false);

delete globalThis.StreambenchUi;
delete globalThis.window;
delete globalThis.document;
console.log("WebMCP behavior checks passed");
