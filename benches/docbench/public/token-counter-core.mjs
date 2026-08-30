const textEncoder = new TextEncoder();
const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;

function countCharacters(text) {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
}

function countWords(text) {
  if (!text) return 0;
  if (wordSegmenter) {
    let count = 0;
    for (const segment of wordSegmenter.segment(text)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function serializedText(text, eol) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (eol === "CRLF") return normalized.replace(/\n/g, "\r\n");
  if (eol === "CR") return normalized.replace(/\n/g, "\r");
  return normalized;
}

export function countSerializedBytes(text, { eol = "LF", bom = false } = {}) {
  return textEncoder.encode(serializedText(text, eol)).byteLength + (bom ? 3 : 0);
}

export function countDocumentStats(text, serialization = {}) {
  return {
    words: countWords(text),
    characters: countCharacters(text),
    bytes: countSerializedBytes(text, serialization),
  };
}
