import { describeHls, describeMedia, describeSource } from "../public/diagnostics.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = describeSource("http://example.com/live.m3u8?token=secret", {
  pageProtocol: "https:",
  title: "News HD",
});
assert(source.address === "http://example.com/live.m3u8?…", "diagnostic address leaked or mismatched query");
assert(source.type === "HLS · HD", "source type mismatch");
assert(source.security.startsWith("Mixed content"), "mixed content was not detected");

const hls = describeHls([
  { height: 720, videoCodec: "avc1", audioCodec: "mp4a" },
  { height: 1080, videoCodec: "avc1", audioCodec: "mp4a" },
], { live: true });
assert(hls.includes("live") && hls.includes("2 wariantów") && hls.includes("1080p"), "HLS summary mismatch");

const media = describeMedia({
  videoWidth: 1920,
  videoHeight: 1080,
  duration: 120.4,
  readyState: 4,
  networkState: 1,
});
assert(media.includes("1920×1080") && media.includes("120 s"), "media summary mismatch");

console.log("diagnostics checks passed");
