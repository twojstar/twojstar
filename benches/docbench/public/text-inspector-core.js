"use strict";

(() => {
const MAX_FINDINGS = 500;
const MAX_BASE64_DECODE_CHARS = 65536;
const BASE64_PREVIEW_CHARS = 8192;
const MIN_BASE64_CANDIDATE_CHARS = 20;
const MAX_VARIATION_PREVIEW_BYTES = 512;
const MAX_TAG_PREVIEW_CHARS = 512;
const MIXED_TOKEN_PREVIEW_BEFORE = 48;
const MIXED_TOKEN_PREVIEW_AFTER = 96;
const severityRank = { high: 0, medium: 1, low: 2 };

const specialCharacters = new Map([
  [0x00ad, ["medium", "Soft hyphen", "Invisible discretionary hyphen."]],
  [0x034f, ["medium", "Combining grapheme joiner", "Invisible combining control."]],
  [0x061c, ["medium", "Arabic letter mark", "Invisible bidi-affecting mark."]],
  [0x200b, ["medium", "Zero-width space", "Invisible separator often used for Unicode smuggling."]],
  [0x200c, ["low", "Zero-width non-joiner", "Can be legitimate in some writing systems; review unexpected use."]],
  [0x200d, ["low", "Zero-width joiner", "Used legitimately in scripts and emoji; review unexpected use."]],
  [0x200e, ["medium", "Left-to-right mark", "Invisible bidirectional text mark."]],
  [0x200f, ["medium", "Right-to-left mark", "Invisible bidirectional text mark."]],
  [0x202a, ["high", "Left-to-right embedding", "Bidi control can make source render in a misleading order."]],
  [0x202b, ["high", "Right-to-left embedding", "Bidi control can make source render in a misleading order."]],
  [0x202c, ["high", "Pop directional formatting", "Bidi control terminator."]],
  [0x202d, ["high", "Left-to-right override", "Bidi override can make source render in a misleading order."]],
  [0x202e, ["high", "Right-to-left override", "Bidi override can make source render in a misleading order."]],
]);

for (const [codePoint, name] of [
  [0x2060, "Word joiner"], [0x2061, "Function application"], [0x2062, "Invisible times"],
  [0x2063, "Invisible separator"], [0x2064, "Invisible plus"],
]) {
  specialCharacters.set(codePoint, ["medium", name, "Invisible formatting character."]);
}
for (const [codePoint, name] of [
  [0x2066, "Left-to-right isolate"], [0x2067, "Right-to-left isolate"],
  [0x2068, "First-strong isolate"], [0x2069, "Pop directional isolate"],
]) {
  specialCharacters.set(codePoint, ["high", name, "Bidi isolation control can conceal source ordering."]);
}
for (let codePoint = 0x206a; codePoint <= 0x206f; codePoint += 1) {
  specialCharacters.set(codePoint, ["high", "Deprecated bidi control", "Deprecated invisible directional control."]);
}
specialCharacters.set(0xfeff, ["medium", "Zero-width no-break space / BOM", "Unexpected inside document text."]);
specialCharacters.set(0xfffd, ["medium", "Replacement character", "May indicate text was decoded or copied with data loss earlier."]);

for (const codePoint of [
  0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000,
]) {
  specialCharacters.set(codePoint, ["low", "Unusual Unicode space", "Whitespace that can be hard to distinguish from an ordinary space."]);
}

const injectionPatterns = [
  /\b(?:ignore|disregard|forget)\b.{0,90}\b(?:previous|prior|above|system|developer)\b.{0,60}\b(?:instruction|instructions|prompt|message|messages)\b/gius,
  /\b(?:reveal|print|show|output|expose|dump)\b.{0,60}\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/gius,
  /\b(?:do not|don't)\s+(?:tell|show|inform)\s+(?:the\s+)?user\b/gius,
  /(?<!\p{L})(?:zignoruj|ignoruj|pomiń|zapomnij)(?!\p{L}).{0,90}\b(?:poprzednie|wcześniejsze|powyższe|systemowe|deweloperskie)\b.{0,60}\b(?:instrukcje|polecenia|prompt|wiadomości)\b/gius,
];

const previewFormatPattern = /\p{Cf}/u;
const mixedTokenCharacterPattern = /[\p{L}\p{N}_-]/u;
const latinCharacterPattern = /\p{Script=Latin}/u;
const cyrillicCharacterPattern = /\p{Script=Cyrillic}/u;
const greekCharacterPattern = /\p{Script=Greek}/u;
const base64LinePattern = /^[A-Za-z0-9+/_-]+={0,2}$/u;

function isControl(codePoint) {
  return (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint))
    || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isNoncharacter(codePoint) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xffff) === 0xfffe
    || (codePoint & 0xffff) === 0xffff;
}

function isTagCharacter(codePoint) {
  return codePoint >= 0xe0000 && codePoint <= 0xe007f;
}

function isVariationSelector(codePoint) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

function codePointLabel(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(codePoint <= 0xffff ? 4 : 6, "0")}`;
}

function previewEscape(codePoint) {
  const hex = codePoint.toString(16).padStart(codePoint <= 0xffff ? 4 : 1, "0");
  return codePoint <= 0xffff ? `\\u${hex}` : `\\u{${hex}}`;
}

function escapedPreviewChar(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint <= 0x1f || codePoint === 0x7f || previewFormatPattern.test(char)) {
    return previewEscape(codePoint);
  }
  return char;
}

function quotedPreview(value, limit = 180) {
  const compact = [...value].map(escapedPreviewChar).join("");
  const clipped = compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
  return JSON.stringify(clipped);
}

function quotedPreviewAround(value, match, limit = 180) {
  if (value.length <= limit) return quotedPreview(value, limit);
  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  const context = Math.max(0, limit - Math.min(match[0].length, limit));
  const before = Math.min(matchStart, Math.floor(context / 2));
  const after = Math.min(value.length - matchEnd, context - before);
  const start = matchStart - before;
  const end = matchEnd + after;
  const prefix = start > 0 ? "…" : "";
  const suffix = end < value.length ? "…" : "";
  return quotedPreview(`${prefix}${value.slice(start, end)}${suffix}`, limit + 2);
}

function hasVisibleText(value) {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0x1f && codePoint !== 0x7f) return true;
  }
  return false;
}

function decodeBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeBytesRecovering(bytes) {
  return decodeBytes(bytes) ?? new TextDecoder("utf-8").decode(bytes);
}

function makeLineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) starts.push(index + 1);
  }
  return starts;
}

function lineIndexForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, high);
}

function* segmentedGraphemeRanges(text, lineStart, lineEnd) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const part of segmenter.segment(text.slice(lineStart, lineEnd))) {
    const start = lineStart + part.index;
    yield { start, end: start + part.segment.length };
  }
}

function* codePointRanges(text, lineStart, lineEnd) {
  for (let cursor = lineStart; cursor < lineEnd;) {
    const codePoint = text.codePointAt(cursor);
    const width = codePoint > 0xffff ? 2 : 1;
    yield { start: cursor, end: cursor + width };
    cursor += width;
  }
}

function graphemeRanges(text, lineStart, lineEnd) {
  return typeof Intl?.Segmenter === "function"
    ? segmentedGraphemeRanges(text, lineStart, lineEnd)
    : codePointRanges(text, lineStart, lineEnd);
}

function assignColumnsInRange(targets, columns, state, range) {
  while (state.index < targets.length && targets[state.index] < range.end) {
    const target = targets[state.index];
    if (target >= range.start) columns.set(target, state.column);
    state.index += 1;
  }
}

function fillRemainingColumns(targets, columns, state) {
  while (state.index < targets.length) {
    columns.set(targets[state.index], state.column);
    state.index += 1;
  }
}

function columnsForOffsets(text, lineStart, lineEnd, offsets) {
  const targets = [...new Set(offsets)].sort((a, b) => a - b);
  const columns = new Map();
  if (!targets.length) return columns;
  const state = { index: 0, column: 1 };
  for (const range of graphemeRanges(text, lineStart, lineEnd)) {
    assignColumnsInRange(targets, columns, state, range);
    if (state.index >= targets.length) break;
    state.column += 1;
  }
  fillRemainingColumns(targets, columns, state);
  return columns;
}

function locateFindings(text, starts, findings) {
  const located = new Array(findings.length);
  const groups = new Map();
  findings.forEach((finding, index) => {
    const lineIndex = lineIndexForOffset(starts, finding.offset);
    if (!groups.has(lineIndex)) groups.set(lineIndex, []);
    groups.get(lineIndex).push({ finding, index });
  });
  for (const [lineIndex, entries] of groups) {
    const lineStart = starts[lineIndex];
    const lineEnd = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : text.length;
    const columns = columnsForOffsets(text, lineStart, lineEnd, entries.map(({ finding }) => finding.offset));
    for (const { finding, index } of entries) {
      located[index] = { ...finding, line: lineIndex + 1, column: columns.get(finding.offset) || 1 };
    }
  }
  return located;
}

function findingRank(finding) {
  return severityRank[finding.severity] ?? severityRank.low;
}

function severityCounts(findings) {
  if (!findings.severityCounts) {
    Object.defineProperty(findings, "severityCounts", { value: [0, 0, 0] });
  }
  return findings.severityCounts;
}

function worstRetainedRank(counts) {
  for (let rank = severityRank.low; rank >= severityRank.high; rank -= 1) {
    if (counts[rank] > 0) return rank;
  }
  return severityRank.high;
}

function replacementIndexForRank(findings, rank) {
  return findings.findIndex((current) => findingRank(current) === rank);
}

function addFinding(findings, finding) {
  const counts = severityCounts(findings);
  const candidateRank = findingRank(finding);
  if (findings.length < MAX_FINDINGS) {
    findings.push(finding);
    counts[candidateRank] += 1;
    return;
  }
  findings.truncated = true;
  const worstRank = worstRetainedRank(counts);
  if (candidateRank >= worstRank) return;
  const replacement = replacementIndexForRank(findings, worstRank);
  if (replacement < 0) return;
  findings[replacement] = finding;
  counts[worstRank] -= 1;
  counts[candidateRank] += 1;
}

function specialCharacterFinding(codePoint, offset, width) {
  const special = specialCharacters.get(codePoint);
  if (!special) return null;
  return {
    severity: special[0], kind: "invisible", label: special[1],
    detail: `${special[2]} ${codePointLabel(codePoint)}`, offset, length: width,
  };
}

function formatControlFinding(codePoint, offset, width) {
  if (!/\p{Cf}/u.test(String.fromCodePoint(codePoint))) return null;
  return {
    severity: "medium", kind: "invisible", label: "Unicode format control",
    detail: `Invisible or formatting control ${codePointLabel(codePoint)}. Review unexpected use.`, offset, length: width,
  };
}

function rawControlFinding(codePoint, offset, width) {
  if (!isControl(codePoint)) return null;
  return {
    severity: "high", kind: "control", label: "Control character",
    detail: `Unexpected non-printing control ${codePointLabel(codePoint)}.`, offset, length: width,
  };
}

function noncharacterFinding(codePoint, offset, width) {
  if (!isNoncharacter(codePoint)) return null;
  return {
    severity: "high", kind: "invalid-unicode", label: "Unicode noncharacter",
    detail: `${codePointLabel(codePoint)} is reserved as a noncharacter.`, offset, length: width,
  };
}

function privateUseFinding(codePoint, offset, width) {
  if (!/\p{Co}/u.test(String.fromCodePoint(codePoint))) return null;
  return {
    severity: "low", kind: "marker-carrier", label: "Private-use character",
    detail: `${codePointLabel(codePoint)} has no standardized meaning and can carry application-specific metadata.`,
    offset, length: width,
  };
}

const characterFindingFactories = [
  specialCharacterFinding,
  formatControlFinding,
  rawControlFinding,
  noncharacterFinding,
  privateUseFinding,
];

function findingForCodePoint(codePoint, offset, width) {
  if (isTagCharacter(codePoint)) return null;
  for (const factory of characterFindingFactories) {
    const finding = factory(codePoint, offset, width);
    if (finding) return finding;
  }
  return null;
}

function variationSelectorByte(codePoint) {
  if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return codePoint - 0xfe00;
  if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return codePoint - 0xe0100 + 16;
  return null;
}

function variationBytesForward(text, start, end, limit) {
  const bytes = [];
  for (let offset = start; offset < end && bytes.length < limit;) {
    const codePoint = text.codePointAt(offset);
    const value = variationSelectorByte(codePoint);
    if (value !== null) bytes.push(value);
    offset += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

function isLowSurrogate(unit) {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function isHighSurrogate(unit) {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function previousCodePointStart(text, offset) {
  const last = offset - 1;
  if (!isLowSurrogate(text.charCodeAt(last))) return last;
  const previous = last - 1;
  return previous >= 0 && isHighSurrogate(text.charCodeAt(previous)) ? previous : last;
}

function previousCodePoint(text, offset) {
  const start = previousCodePointStart(text, offset);
  return { codePoint: text.codePointAt(start), start };
}

function variationBytesBackward(text, start, end, limit) {
  const bytes = [];
  for (let offset = end; offset > start && bytes.length < limit;) {
    const previous = previousCodePoint(text, offset);
    const value = variationSelectorByte(previous.codePoint);
    if (value !== null) bytes.push(value);
    offset = previous.start;
  }
  return bytes.reverse();
}

function variationPreview(bytes) {
  const decoded = decodeBytes(Uint8Array.from(bytes));
  if (decoded && hasVisibleText(decoded)) return quotedPreview(decoded);
  return bytes.slice(0, 48).map((value) => value.toString(16).padStart(2, "0")).join(" ")
    + (bytes.length > 48 ? " …" : "");
}

function variationRunDetail(text, start, end, count) {
  const prefix = variationBytesForward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  if (count <= MAX_VARIATION_PREVIEW_BYTES) {
    return `${count} consecutive variation selectors. Decoded payload: ${variationPreview(prefix)}`;
  }
  const suffix = variationBytesBackward(text, start, end, MAX_VARIATION_PREVIEW_BYTES);
  return `${count} consecutive variation selectors. Decoded prefix: ${variationPreview(prefix)}; suffix: ${variationPreview(suffix)}`;
}

function flushVariationRun(text, findings, state, end) {
  if (state.count >= 4) addFinding(findings, {
    severity: "medium", kind: "marker-carrier", label: "Variation-selector sequence",
    detail: variationRunDetail(text, state.start, end, state.count),
    offset: state.start, length: end - state.start,
  });
  state.start = -1;
  state.count = 0;
}

function updateVariationRun(text, findings, state, codePoint, offset) {
  if (!isVariationSelector(codePoint)) {
    flushVariationRun(text, findings, state, offset);
    return;
  }
  if (state.start < 0) state.start = offset;
  state.count += 1;
}

function scanCharacters(text, findings) {
  const variation = { start: -1, count: 0 };
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    const width = codePoint > 0xffff ? 2 : 1;
    updateVariationRun(text, findings, variation, codePoint, offset);
    const finding = findingForCodePoint(codePoint, offset, width);
    if (finding) addFinding(findings, finding);
    offset += width;
  }
  flushVariationRun(text, findings, variation, text.length);
}

function codePointWidth(codePoint) {
  return codePoint > 0xffff ? 2 : 1;
}

function tagAscii(codePoint) {
  const ascii = codePoint - 0xe0000;
  return ascii >= 0x20 && ascii <= 0x7e ? String.fromCharCode(ascii) : "";
}

function appendTagPreview(state, char) {
  if (!char) return;
  if (state.payload.length < MAX_TAG_PREVIEW_CHARS) {
    state.payload += char;
    return;
  }
  state.truncated = true;
}

function readUnicodeTagRun(text, start) {
  const state = { offset: start, payload: "", count: 0, truncated: false };
  while (state.offset < text.length) {
    const codePoint = text.codePointAt(state.offset);
    if (!isTagCharacter(codePoint)) break;
    appendTagPreview(state, tagAscii(codePoint));
    state.count += 1;
    state.offset += codePointWidth(codePoint);
  }
  return { end: state.offset, payload: state.payload, count: state.count, truncated: state.truncated };
}

function tagRunDetail(run) {
  if (!run.payload) return `${run.count} invisible Unicode tag characters.`;
  const suffix = run.truncated ? " (preview truncated)" : "";
  return `Hidden tag payload: ${quotedPreview(run.payload)}${suffix}`;
}

function scanUnicodeTags(text, findings) {
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    if (!isTagCharacter(codePoint)) {
      offset += codePointWidth(codePoint);
      continue;
    }
    const run = readUnicodeTagRun(text, offset);
    addFinding(findings, {
      severity: "high", kind: "marker-carrier", label: "Unicode tag sequence",
      detail: tagRunDetail(run), offset, length: run.end - offset,
    });
    offset = run.end;
  }
}

function tokenScriptFlags(char) {
  return {
    latin: latinCharacterPattern.test(char),
    cyrillic: cyrillicCharacterPattern.test(char),
    greek: greekCharacterPattern.test(char),
  };
}

function mixedScriptPresent(state) {
  return state.latin && (state.cyrillic || state.greek);
}

function updateMixedTokenScripts(state, char, offset) {
  const wasMixed = mixedScriptPresent(state);
  const flags = tokenScriptFlags(char);
  state.latin ||= flags.latin;
  state.cyrillic ||= flags.cyrillic;
  state.greek ||= flags.greek;
  if (!wasMixed && mixedScriptPresent(state)) state.evidenceOffset = offset;
}

function mixedTokenPreview(text, state) {
  const anchor = state.evidenceOffset ?? state.start;
  const start = Math.max(state.start, anchor - MIXED_TOKEN_PREVIEW_BEFORE);
  const end = Math.min(state.end, anchor + MIXED_TOKEN_PREVIEW_AFTER);
  const prefix = start > state.start ? "…" : "";
  const suffix = end < state.end ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function flushMixedToken(text, findings, state) {
  if (!state || state.end - state.start < 3 || !mixedScriptPresent(state)) return;
  addFinding(findings, {
    severity: "medium",
    kind: "confusable",
    label: "Mixed-script token",
    detail: `Mixed-script token (${state.end - state.start} code units): ${quotedPreview(mixedTokenPreview(text, state))}. Latin mixed with Cyrillic or Greek can create look-alike identifiers or links.`,
    offset: state.start,
    length: state.end - state.start,
  });
}

function scanMixedScripts(text, findings) {
  let state = null;
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    const width = codePointWidth(codePoint);
    const char = String.fromCodePoint(codePoint);
    if (mixedTokenCharacterPattern.test(char)) {
      if (!state) state = { start: offset, end: offset, latin: false, cyrillic: false, greek: false, evidenceOffset: null };
      state.end = offset + width;
      updateMixedTokenScripts(state, char, offset);
    } else if (state) {
      flushMixedToken(text, findings, state);
      state = null;
    }
    offset += width;
  }
  flushMixedToken(text, findings, state);
}

function scanPromptInjection(text, findings) {
  for (const pattern of injectionPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      addFinding(findings, {
        severity: "medium",
        kind: "prompt-injection",
        label: "Prompt-injection-like instruction",
        detail: `Matched instruction: ${quotedPreview(match[0])}. Heuristic match only.`,
        offset: match.index,
        length: match[0].length,
      });
    }
  }
}

function normalizedBase64(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = normalized.length % 4;
  if (remainder === 1) return null;
  return normalized + "=".repeat((4 - remainder) % 4);
}

function decodedNormalizedBase64(value) {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return decodeBytesRecovering(bytes);
  } catch {
    return null;
  }
}

function decodedPromptMatch(value) {
  if (!value) return null;
  for (const pattern of injectionPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(value);
    if (match) return match;
  }
  return null;
}

function scanDecodedPrompt(value) {
  return Boolean(decodedPromptMatch(value));
}

function decodedBase64Slices(value) {
  const normalized = normalizedBase64(value);
  if (!normalized) return [];
  if (normalized.length <= MAX_BASE64_DECODE_CHARS) {
    const decoded = decodedNormalizedBase64(normalized);
    return decoded ? [decoded] : [];
  }
  const chunk = BASE64_PREVIEW_CHARS - (BASE64_PREVIEW_CHARS % 4);
  const suffixStart = Math.max(0, normalized.length - chunk);
  return [normalized.slice(0, chunk), normalized.slice(suffixStart)]
    .map(decodedNormalizedBase64)
    .filter(Boolean);
}

function candidateDecodedSlices(candidate) {
  if (candidate.encoded !== null) return decodedBase64Slices(candidate.encoded);
  return candidate.edges
    .map(normalizedBase64)
    .filter(Boolean)
    .map(decodedNormalizedBase64)
    .filter(Boolean);
}

function pushWrappedCandidate(results, run) {
  if (!run || run.parts.length < 2) return;
  const encoded = run.parts.join("");
  if (!normalizedBase64(encoded)) return;
  if (!decodedBase64Slices(encoded).length) return;
  results.push({ encoded, edges: null, offset: run.start, length: run.end - run.start });
}

function startWrappedRun(part, lineStart, lineEnd) {
  if (part.length < 32 || part.includes("=")) return null;
  return { start: lineStart, end: lineEnd, parts: [part] };
}

function extendWrappedRun(results, run, part, lineEnd) {
  if (!run) return null;
  if (!base64LinePattern.test(part) || part.length < 2) {
    pushWrappedCandidate(results, run);
    return null;
  }
  run.parts.push(part);
  run.end = lineEnd;
  if (part.length < 32 || part.includes("=")) {
    pushWrappedCandidate(results, run);
    return null;
  }
  return run;
}

function wrappedBase64Candidates(text) {
  if (!text.includes("\n")) return [];
  const results = [];
  let run = null;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawEnd = newline < 0 ? text.length : newline;
    const lineEnd = rawEnd > lineStart && text.charCodeAt(rawEnd - 1) === 0x0d ? rawEnd - 1 : rawEnd;
    const part = text.slice(lineStart, lineEnd).trim();
    if (run) run = extendWrappedRun(results, run, part, lineEnd);
    if (!run && base64LinePattern.test(part)) run = startWrappedRun(part, lineStart, lineEnd);
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  pushWrappedCandidate(results, run);
  return results;
}

function isBase64AlphabetCode(unit) {
  return (unit >= 0x41 && unit <= 0x5a)
    || (unit >= 0x61 && unit <= 0x7a)
    || (unit >= 0x30 && unit <= 0x39)
    || unit === 0x2b || unit === 0x2f || unit === 0x5f || unit === 0x2d;
}

function boundedCandidate(text, start, end) {
  const length = end - start;
  if (length <= MAX_BASE64_DECODE_CHARS) {
    return { encoded: text.slice(start, end), edges: null, offset: start, length };
  }
  const chunk = BASE64_PREVIEW_CHARS - (BASE64_PREVIEW_CHARS % 4);
  const suffixOffset = (length - chunk) % 4;
  const suffixStart = end - chunk - suffixOffset;
  return {
    encoded: null,
    edges: [text.slice(start, start + chunk), text.slice(suffixStart, end)],
    offset: start,
    length,
  };
}

function continuousBase64Candidates(text) {
  const results = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && !isBase64AlphabetCode(text.charCodeAt(cursor))) cursor += 1;
    const start = cursor;
    while (cursor < text.length && isBase64AlphabetCode(text.charCodeAt(cursor))) cursor += 1;
    if (cursor - start < MIN_BASE64_CANDIDATE_CHARS) continue;
    let end = cursor;
    let padding = 0;
    while (end < text.length && text.charCodeAt(end) === 0x3d && padding < 2) {
      end += 1;
      padding += 1;
    }
    results.push(boundedCandidate(text, start, end));
    cursor = end;
  }
  return results;
}

function candidateContainedBy(candidate, carrier) {
  return candidate.offset >= carrier.offset
    && candidate.offset + candidate.length <= carrier.offset + carrier.length;
}

function excludeWrappedLineCandidates(candidates, wrapped) {
  const results = [];
  let carrierIndex = 0;
  for (const candidate of candidates) {
    while (carrierIndex < wrapped.length
      && wrapped[carrierIndex].offset + wrapped[carrierIndex].length <= candidate.offset) {
      carrierIndex += 1;
    }
    const carrier = wrapped[carrierIndex];
    if (!carrier || !candidateContainedBy(candidate, carrier)) results.push(candidate);
  }
  return results;
}

function encodedCandidates(text) {
  const wrapped = wrappedBase64Candidates(text);
  const suppressingWrapped = wrapped.filter((candidate) => candidateDecodedSlices(candidate).some(scanDecodedPrompt));
  return [...excludeWrappedLineCandidates(continuousBase64Candidates(text), suppressingWrapped), ...wrapped];
}

function scanEncodedPrompts(text, findings) {
  for (const candidate of encodedCandidates(text)) {
    let decoded = null;
    let match = null;
    for (const slice of candidateDecodedSlices(candidate)) {
      const sliceMatch = decodedPromptMatch(slice);
      if (!sliceMatch) continue;
      decoded = slice;
      match = sliceMatch;
      break;
    }
    if (decoded && match) {
      addFinding(findings, {
        severity: "high", kind: "prompt-injection", label: "Encoded prompt-like instruction",
        detail: `Base64 decoded payload: ${quotedPreviewAround(decoded, match)}`,
        offset: candidate.offset, length: candidate.length,
      });
      continue;
    }
    if (candidate.length > MAX_BASE64_DECODE_CHARS) {
      addFinding(findings, {
        severity: "medium", kind: "marker-carrier", label: "Large Base64 carrier",
        detail: `Encoded run is ${candidate.length} characters; only bounded edge previews were decoded. Hidden content may exist inside.`,
        offset: candidate.offset, length: candidate.length,
      });
    }
  }
}

function scanText(text) {
  const findings = [];
  scanCharacters(text, findings);
  scanUnicodeTags(text, findings);
  scanMixedScripts(text, findings);
  scanPromptInjection(text, findings);
  scanEncodedPrompts(text, findings);

  const starts = makeLineStarts(text);
  const unique = new Map();
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.offset}:${finding.length}:${finding.label}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  const result = locateFindings(text, starts, [...unique.values()])
    .sort((a, b) => a.offset - b.offset || severityRank[a.severity] - severityRank[b.severity])
    .slice(0, MAX_FINDINGS);
  Object.defineProperty(result, "truncated", { value: Boolean(findings.truncated) });
  return result;
}

function summarizeFindings(findings) {
  return findings.reduce((summary, finding) => {
    summary[finding.severity] += 1;
    return summary;
  }, { high: 0, medium: 0, low: 0 });
}

globalThis.DocBenchTextInspector = Object.freeze({ scanText, summarizeFindings });
})();
