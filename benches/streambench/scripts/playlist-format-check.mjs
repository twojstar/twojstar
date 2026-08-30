import { readFile } from "node:fs/promises";

import { dedupePlaylist, parseM3uWorkspace, serializeM3u } from "../public/playlist-format.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = `#EXTM3U
#EXTINF:-1 tvg-id="tv.one" tvg-logo="https://example.com/logo.png" tvg-name="TV One" group-title="News",TV One
https://example.com/live.mpd
#EXTINF:-1 tvg-logo="https://example.com/radio.png" tvg-tags="news,pop" tvg-codec="MP3" tvg-bitrate="128" tvg-quality="MP3 · 128 kb/s",Radio One
#EXTALB:BBC
#EXTVLCOPT:http-user-agent=Streambench Test
https://example.com/radio.m3u8
https://example.com/raw.mp3
https://example.com/raw.mp3
`;

const items = parseM3uWorkspace(source, { providerId: "local", providerLabel: "Lokalna", defaultRadio: true });
assert(items.length === 4, "playlist entries were not parsed");
assert(items[0].id === "tv.one" && items[0].url.endsWith("live.mpd"), "IPTV metadata mismatch");
assert(items[1].album === "BBC" && items[1].group === "Bez grupy", "EXTALB was not preserved independently");
assert(items[1].tags === "news,pop" && items[1].codec === "MP3" && items[1].bitrate === "128", "radio metadata mismatch");
assert(items[2].radio && items[2].title === "example.com", "bare radio URL mismatch");
assert(dedupePlaylist(items).length === 3, "exact URL deduplication failed");

const exported = serializeM3u(items);
assert(exported.startsWith("#EXTM3U\n"), "export header is missing");
assert(exported.includes('tvg-id="tv.one"'), "tvg-id was not exported");
assert(exported.includes('tvg-tags="news,pop"'), "radio tags were not exported");
assert(exported.includes('tvg-codec="MP3"'), "radio codec was not exported");
assert(exported.includes('tvg-bitrate="128"'), "radio bitrate was not exported");
assert(exported.includes("#EXTALB:BBC"), "EXTALB was not exported");
assert(exported.includes("#EXTVLCOPT:http-user-agent=Streambench Test"), "item directive was not exported");
assert(exported.includes("https://example.com/live.mpd"), "MPD URL was not exported");
assert(exported.match(/https:\/\/example\.com\/raw\.mp3/g)?.length === 1, "export did not deduplicate exact URLs");

const repositorySource = await readFile(new URL("../public/playlists/iptv.m3u8", import.meta.url), "utf8");
const repositoryItems = parseM3uWorkspace(repositorySource, { providerId: "local", providerLabel: "Lokalna" });
assert(repositoryItems.length > 20, "repository IPTV playlist was not parsed");
assert(repositoryItems.some((item) => item.hls), "repository IPTV playlist lost HLS entries");
assert(repositoryItems.some((item) => item.url.endsWith(".mpd")), "repository IPTV playlist lost MPD entries");

console.log("playlist format checks passed");
