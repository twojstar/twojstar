import {
  normalizeRadioBrowserCatalog,
  radioBrowserSearchPath,
  radioBrowserStationsToM3u,
} from "../src/providers/radio-browser.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = normalizeRadioBrowserCatalog([
  { name: "PL", stationcount: "50" },
  { name: "DE", stationcount: "100" },
  { name: "bad", stationcount: "5" },
], [
  { name: "pop", stationcount: "40" },
  { name: "news", stationcount: "20" },
]);
assert(catalog.countries.some((country) => country.code === "PL" && country.flag === "🇵🇱"), "Poland catalog entry is missing");
assert(catalog.tags[0].id === "pop" && catalog.tags[0].name === "pop (40)", "tag catalog mismatch");

const countryPath = radioBrowserSearchPath("country", "PL");
assert(countryPath?.includes("countrycode=PL"), "country search path mismatch");
assert(countryPath?.includes("is_https=true"), "HTTPS filter is missing");
assert(radioBrowserSearchPath("tag", "jazz")?.includes("tagExact=true"), "exact tag search is missing");
assert(radioBrowserSearchPath("country", "POL") === null, "invalid country was accepted");

const playlist = radioBrowserStationsToM3u([
  {
    stationuuid: "one",
    name: "Radio One",
    url_resolved: "https://radio.example/live.mp3",
    favicon: "https://radio.example/logo.png",
    countrycode: "PL",
    language: "polish",
    tags: "news,pop",
    codec: "MP3",
    bitrate: 128,
    lastcheckok: 1,
  },
  {
    stationuuid: "hls",
    name: "Hidden HLS",
    url_resolved: "https://radio.example/live",
    hls: 1,
    lastcheckok: 1,
  },
  {
    stationuuid: "one",
    name: "Duplicate",
    url_resolved: "https://radio.example/duplicate.mp3",
    lastcheckok: 1,
  },
  {
    stationuuid: "broken",
    name: "Broken",
    url: "https://radio.example/broken.mp3",
    lastcheckok: 0,
  },
]);
assert(playlist.count === 2, "station filtering or deduplication failed");
assert(playlist.body.includes('radio="true"'), "radio marker is missing");
assert(playlist.body.includes('tvg-country="PL"'), "country metadata is missing");
assert(playlist.body.includes('tvg-tags="news,pop"'), "tag metadata is missing");
assert(playlist.body.includes('tvg-codec="MP3"'), "codec metadata is missing");
assert(playlist.body.includes('tvg-bitrate="128"'), "bitrate metadata is missing");
assert(playlist.body.includes('tvg-quality="MP3 · 128 kb/s"'), "technical quality badge is missing");
assert(playlist.body.includes("https://radio.example/live.mp3"), "resolved stream URL is missing");
assert(playlist.body.includes('hls="true"'), "HLS metadata is missing");
assert(playlist.body.includes("https://radio.example/live#streambench-hls=.m3u8"), "extensionless HLS marker is missing");

console.log("Radio Browser checks passed");
