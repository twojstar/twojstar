import assert from "node:assert/strict";
import { filterFreeTvPlaylist } from "../src/providers/free-tv.ts";

const source = `#EXTM3U
#EXTINF:-1 tvg-id="Poland.pl" tvg-country="PL",Poland HD
https://example.com/poland/index.m3u8
#EXTINF:-1 tvg-id="Germany.de" tvg-country="DE",Germany HD
https://example.com/germany/index.m3u8
#EXTINF:-1 tvg-id="Http.pl" tvg-country="PL",HTTP only
http://example.com/http/index.m3u8
#EXTINF:-1 tvg-id="Youtube.pl" tvg-country="PL",YouTube
https://www.youtube.com/@example/live
#EXTINF:-1 tvg-id="Geo.pl" tvg-country="PL",Geo Ⓖ
https://example.com/geo/index.m3u8
#EXTINF:-1 tvg-id="Poland.pl" tvg-country="PL",Duplicate
https://example.com/duplicate/index.m3u8
#EXTINF:-1 tvg-id="File.pl" tvg-country="PL",File
https://example.com/video.mp4
#EXTINF:-1 tvg-id="Forwarder.pl" tvg-country="PL",Forwarder
https://example.com/stream-forwarder/get.php?x=TVP1
`;

const poland = filterFreeTvPlaylist(source, "PL");
assert.equal(poland.total, 8);
assert.equal(poland.count, 3);
assert.match(poland.body, /Poland HD/);
assert.match(poland.body, /video\.mp4/);
assert.match(poland.body, /stream-forwarder\/get\.php\?x=TVP1/);
assert.doesNotMatch(poland.body, /HTTP only|YouTube|Geo|Duplicate|Germany/);

const all = filterFreeTvPlaylist(source, "ALL");
assert.equal(all.count, 4);
assert.match(all.body, /Germany HD/);

assert.throws(() => filterFreeTvPlaylist(source, "XX"), /unsupported/);
assert.throws(() => filterFreeTvPlaylist("not a playlist", "PL"), /invalid/);

console.log("Free-TV Lite filter checks passed.");
