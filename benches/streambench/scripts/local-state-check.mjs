import { createLocalState, itemKey, normalizeState } from "../public/local-state.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const channel = {
  id: "channel.one",
  url: "https://example.com/live.m3u8",
  title: "Channel One",
  providerId: "provider",
  providerLabel: "Provider",
  protocol: "HTTPS",
  playback: "HLS",
};
assert(itemKey(channel) === "provider:channel.one|https://example.com/live.m3u8", "stable item key mismatch");

const longPrefix = "x".repeat(400);
const longOne = { ...channel, id: "", url: `https://example.com/live?token=${longPrefix}one` };
const longTwo = { ...channel, id: "", url: `https://example.com/live?token=${longPrefix}two` };
assert(itemKey(longOne) !== itemKey(longTwo), "long signed URLs collided");
assert(itemKey({ ...longOne, stateKey: itemKey(longOne) }) === itemKey(longOne), "full stored key was not preserved");

const storage = memoryStorage();
const library = createLocalState(storage);
assert(library.toggleFavorite(channel), "favorite was not added");
assert(library.isFavorite(channel), "favorite lookup failed");
assert(!library.toggleFavorite(channel), "favorite was not removed");
assert(library.toggleFavorite(longOne), "first long favorite was not added");
assert(library.toggleFavorite(longTwo), "second long favorite was not added");
assert(library.items("favorites").length === 2, "long favorites were merged");

library.addRecent(channel);
library.addRecent({ ...channel, title: "Updated title" });
assert(library.items("recent").length === 1, "recent items were not deduplicated");
assert(library.items("recent")[0].title === "Updated title", "recent snapshot was not updated");

assert(library.toggleHidden(channel), "hidden item was not added");
assert(library.isHidden(channel), "hidden lookup failed");
const edit = library.setEdit(channel, { title: "Edited", url: "https://example.com/edited.m3u8" });
assert(edit?.title === "Edited", "edit was not stored");
assert(library.applyEdit(channel).url.includes("edited.m3u8"), "edit was not applied");
assert(library.isHidden(library.applyEdit(channel)), "stable key was lost after URL edit");
assert(library.clearEdit(channel), "edit was not cleared");

library.setPreference("provider", "radio-browser");
library.setPreference("mediaMode", "audio");
assert(library.value.preferences.provider === "radio-browser", "provider preference mismatch");
assert(library.value.preferences.mediaMode === "audio", "media mode preference mismatch");
library.clearRecent();
assert(library.items("recent").length === 0, "recent items were not cleared");

const normalized = normalizeState({
  favorites: { bad: { url: "javascript:alert(1)" } },
  edits: {
    "provider:channel.one|https://example.com/live.m3u8": { ...channel, title: "Edited" },
  },
  recent: [channel, channel],
  preferences: { mediaMode: "invalid" },
});
assert(Object.keys(normalized.favorites).length === 0, "unsafe favorite was accepted");
assert(
  normalized.edits["provider:channel.one|https://example.com/live.m3u8"]?.title === "Edited",
  "normalized edit is missing",
);
assert(normalized.recent.length === 1, "normalized recent list was not deduplicated");
assert(normalized.preferences.mediaMode === "auto", "invalid media mode was accepted");

console.log("local state checks passed");
