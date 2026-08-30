import assert from "node:assert/strict";
import { countDocumentStats, countSerializedBytes } from "../public/token-counter-core.mjs";
import { Tiktoken } from "../public/vendor/js-tiktoken/lite.js";
import o200kBase from "../public/vendor/js-tiktoken/ranks/o200k_base.js";

const sample = "Hello world\nZażółć";
const stats = countDocumentStats(sample);
assert.equal(stats.words, 3);
assert.equal(stats.characters, [...sample].length);
assert.equal(stats.bytes, new TextEncoder().encode(sample).byteLength);
assert.equal(
  countSerializedBytes("a\nb", { eol: "CRLF" }),
  new TextEncoder().encode("a\r\nb").byteLength,
);
assert.equal(
  countSerializedBytes("a\nb", { eol: "CRLF", bom: true }),
  new TextEncoder().encode("a\r\nb").byteLength + 3,
);

const encoder = new Tiktoken(o200kBase);
const tokens = encoder.encode("hello world");
assert.ok(tokens.length > 0);
assert.equal(encoder.decode(tokens), "hello world");

console.log("DocBench token counter checks passed.");
