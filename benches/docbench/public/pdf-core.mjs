const DESTINATION_TYPES = new Set([
  "XYZ",
  "Fit",
  "FitH",
  "FitV",
  "FitR",
  "FitB",
  "FitBH",
  "FitBV",
]);

function clampByte(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function normalizeDestinationView(explicitDestination) {
  if (!Array.isArray(explicitDestination) || explicitDestination.length < 2) {
    return { type: "Fit", args: [] };
  }

  const rawType = explicitDestination[1]?.name;
  const type = DESTINATION_TYPES.has(rawType) ? rawType : "Fit";
  const expectedArgs = {
    XYZ: 3,
    Fit: 0,
    FitH: 1,
    FitV: 1,
    FitR: 4,
    FitB: 0,
    FitBH: 1,
    FitBV: 1,
  }[type];
  const args = explicitDestination.slice(2, 2 + expectedArgs).map((value) => {
    return Number.isFinite(value) ? Number(value) : null;
  });
  while (args.length < expectedArgs) args.push(null);
  return { type, args };
}

async function resolveDestination(pdfDocument, destination) {
  if (!destination) return null;

  let explicit = destination;
  if (typeof destination === "string") {
    explicit = await pdfDocument.getDestination(destination);
  }
  if (!Array.isArray(explicit) || !explicit.length) return null;

  const pageReference = explicit[0];
  let pageIndex = null;
  if (Number.isInteger(pageReference)) {
    pageIndex = pageReference;
  } else if (pageReference) {
    try {
      pageIndex = await pdfDocument.getPageIndex(pageReference);
    } catch {
      return null;
    }
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;

  return {
    kind: "page",
    pageIndex,
    view: normalizeDestinationView(explicit),
  };
}

async function readOutlineItems(pdfDocument, items) {
  const result = [];
  for (const item of items || []) {
    let target = await resolveDestination(pdfDocument, item.dest);
    if (!target && item.url) {
      target = { kind: "url", url: item.url, newWindow: Boolean(item.newWindow) };
    } else if (!target && item.action) {
      target = { kind: "named", action: item.action };
    }

    result.push({
      title: String(item.title || "Untitled bookmark"),
      target,
      color: Array.from(item.color || []).slice(0, 3).map(clampByte),
      bold: Boolean(item.bold),
      italic: Boolean(item.italic),
      open: Number(item.count || 0) >= 0,
      children: await readOutlineItems(pdfDocument, item.items),
    });
  }
  return result;
}

export async function readPdfOutline(pdfDocument) {
  return readOutlineItems(pdfDocument, await pdfDocument.getOutline());
}

function cloneTarget(target) {
  if (!target) return null;
  if (target.kind === "page") {
    return {
      kind: "page",
      pageIndex: target.pageIndex,
      view: {
        type: target.view?.type || "Fit",
        args: [...(target.view?.args || [])],
      },
    };
  }
  return { ...target };
}

function cloneBookmark(bookmark) {
  return {
    ...bookmark,
    target: cloneTarget(bookmark.target),
    color: [...(bookmark.color || [])],
    children: (bookmark.children || []).map(cloneBookmark),
  };
}

export function clonePdfOutline(outline) {
  return (outline || []).map(cloneBookmark);
}

export function remapOutline(outline, mapPageIndex) {
  let dropped = 0;

  function visit(bookmark) {
    const next = cloneBookmark(bookmark);
    next.children = next.children.map(visit).filter(Boolean);

    if (next.target?.kind === "page") {
      const mapped = mapPageIndex(next.target.pageIndex);
      if (mapped === null || mapped === undefined || mapped < 0) {
        next.target = null;
        if (!next.children.length) {
          dropped += 1;
          return null;
        }
      } else {
        next.target.pageIndex = mapped;
      }
    }
    return next;
  }

  return {
    outline: (outline || []).map(visit).filter(Boolean),
    dropped,
  };
}

function pageIdentity(page) {
  if (!page) return null;
  return `${page.sourceId}:${page.pageIndex}`;
}

export function remapOutlineToPagePlan(outline, oldPlan, newPlan) {
  const outputIndexByIdentity = new Map();
  for (let index = 0; index < newPlan.length; index += 1) {
    const identity = pageIdentity(newPlan[index]);
    if (identity !== null && !outputIndexByIdentity.has(identity)) {
      outputIndexByIdentity.set(identity, index);
    }
  }

  return remapOutline(outline, (oldOutputIndex) => {
    const identity = pageIdentity(oldPlan[oldOutputIndex]);
    return identity === null ? null : (outputIndexByIdentity.get(identity) ?? null);
  });
}

export function buildCombinedOutline(sources, pagePlan) {
  const surviving = new Map();
  for (let outputIndex = 0; outputIndex < pagePlan.length; outputIndex += 1) {
    const page = pagePlan[outputIndex];
    const key = `${page.sourceId}:${page.pageIndex}`;
    if (!surviving.has(key)) surviving.set(key, outputIndex);
  }

  const results = [];
  let dropped = 0;
  const multipleSources = sources.length > 1;

  for (let sourceId = 0; sourceId < sources.length; sourceId += 1) {
    const source = sources[sourceId];
    const firstOutputPage = pagePlan.findIndex((page) => page.sourceId === sourceId);
    if (firstOutputPage < 0) continue;

    const remapped = remapOutline(source.outline, (oldPageIndex) => {
      return surviving.get(`${sourceId}:${oldPageIndex}`) ?? null;
    });
    dropped += remapped.dropped;

    if (!multipleSources) {
      results.push(...remapped.outline);
      continue;
    }

    results.push({
      title: source.filename,
      target: {
        kind: "page",
        pageIndex: firstOutputPage,
        view: { type: "Fit", args: [] },
      },
      color: [],
      bold: false,
      italic: false,
      open: true,
      children: remapped.outline,
    });
  }

  return { outline: results, dropped };
}

function normalizeMetadataDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

export function normalizePdfMetadata(metadata = {}) {
  return {
    title: String(metadata.title ?? ""),
    author: String(metadata.author ?? ""),
    subject: String(metadata.subject ?? ""),
    keywords: String(metadata.keywords ?? ""),
    creator: String(metadata.creator ?? ""),
    producer: String(metadata.producer ?? ""),
    creationDate: normalizeMetadataDate(metadata.creationDate),
    modificationDate: normalizeMetadataDate(metadata.modificationDate),
  };
}

function safeMetadataValue(getter, fallback = "") {
  try {
    return getter() ?? fallback;
  } catch {
    return fallback;
  }
}

function optionalMetadataValue(getter) {
  try {
    return getter() ?? undefined;
  } catch {
    return undefined;
  }
}

function metadataFromDocument(pdfDocument) {
  return normalizePdfMetadata({
    title: safeMetadataValue(() => pdfDocument.getTitle()),
    author: safeMetadataValue(() => pdfDocument.getAuthor()),
    subject: safeMetadataValue(() => pdfDocument.getSubject()),
    keywords: safeMetadataValue(() => pdfDocument.getKeywords()),
    creator: safeMetadataValue(() => pdfDocument.getCreator()),
    producer: safeMetadataValue(() => pdfDocument.getProducer()),
    creationDate: safeMetadataValue(() => pdfDocument.getCreationDate()),
    modificationDate: safeMetadataValue(() => pdfDocument.getModificationDate()),
  });
}

function decodeXmpBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const starts = (...values) => values.every((value, index) => data[index] === value);
  let encoding = "utf-8";
  let offset = 0;
  if (starts(0x00, 0x00, 0xfe, 0xff)) { encoding = "utf-32be"; offset = 4; }
  else if (starts(0xff, 0xfe, 0x00, 0x00)) { encoding = "utf-32le"; offset = 4; }
  else if (starts(0xfe, 0xff)) { encoding = "utf-16be"; offset = 2; }
  else if (starts(0xff, 0xfe)) { encoding = "utf-16le"; offset = 2; }
  else if (starts(0xef, 0xbb, 0xbf)) { offset = 3; }
  else if (starts(0x00, 0x00, 0x00, 0x3c)) encoding = "utf-32be";
  else if (starts(0x3c, 0x00, 0x00, 0x00)) encoding = "utf-32le";
  else if (starts(0x00, 0x3c, 0x00, 0x3f)) encoding = "utf-16be";
  else if (starts(0x3c, 0x00, 0x3f, 0x00)) encoding = "utf-16le";
  const payload = data.subarray(offset);
  if (encoding === "utf-8") return new TextDecoder("utf-8").decode(payload);
  if (encoding === "utf-16le" || encoding === "utf-16be") {
    return new TextDecoder(encoding).decode(payload);
  }
  let result = "";
  const littleEndian = encoding === "utf-32le";
  for (let index = 0; index + 3 < payload.length; index += 4) {
    const codePoint = littleEndian
      ? (payload[index] | (payload[index + 1] << 8) | (payload[index + 2] << 16) | (payload[index + 3] << 24)) >>> 0
      : ((payload[index] << 24) | (payload[index + 1] << 16) | (payload[index + 2] << 8) | payload[index + 3]) >>> 0;
    result += codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "\ufffd";
  }
  return result;
}

function readCatalogMetadataXml(pdfDocument, PDFLib) {
  try {
    const stream = pdfDocument.catalog.lookup(PDFLib.PDFName.of("Metadata"));
    if (!(stream instanceof PDFLib.PDFRawStream)) return "";
    return decodeXmpBytes(PDFLib.decodePDFRawStream(stream).decode());
  } catch {
    return "";
  }
}

function writeCatalogMetadataXml(pdfDocument, xml, PDFLib) {
  const metadataStream = pdfDocument.context.stream(
    new TextEncoder().encode(xml),
    { Type: "Metadata", Subtype: "XML" },
  );
  const key = PDFLib.PDFName.of("Metadata");
  const existingRef = pdfDocument.catalog.get(key);
  if (existingRef instanceof PDFLib.PDFRef) {
    pdfDocument.context.assign(existingRef, metadataStream);
  } else {
    pdfDocument.catalog.set(key, pdfDocument.context.register(metadataStream));
  }
}

const XMP_NAMESPACE_FIELDS = {
  title: ["http://purl.org/dc/elements/1.1/", "title"],
  author: ["http://purl.org/dc/elements/1.1/", "creator"],
  subject: ["http://purl.org/dc/elements/1.1/", "description"],
  keywords: ["http://ns.adobe.com/pdf/1.3/", "Keywords"],
  creator: ["http://ns.adobe.com/xap/1.0/", "CreatorTool"],
  producer: ["http://ns.adobe.com/pdf/1.3/", "Producer"],
  creationDate: ["http://ns.adobe.com/xap/1.0/", "CreateDate"],
  modificationDate: ["http://ns.adobe.com/xap/1.0/", "ModifyDate"],
};
const PDFA_NAMESPACE = "http://www.aiim.org/pdfa/ns/id/";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namespacePrefixes(xml, namespace) {
  const prefixes = [];
  const pattern = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([^"']+)\2/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[3] === namespace && !prefixes.includes(match[1])) prefixes.push(match[1]);
  }
  return prefixes;
}

function removeNamespacedProperty(xml, prefix, localName) {
  const name = `${escapeRegex(prefix)}:${escapeRegex(localName)}`;
  let result = xml.replace(new RegExp(`\\s+${name}\\s*=\\s*"[^"]*"`, "gi"), "");
  result = result.replace(new RegExp(`\\s+${name}\\s*=\\s*'[^']*'`, "gi"), "");
  result = result.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>`, "gi"), "");
  return result.replace(new RegExp(`<${name}\\b[^>]*/\\s*>`, "gi"), "");
}

function stripEditedStandardXmp(xml, changes) {
  let result = xml;
  for (const key of Object.keys(changes || {})) {
    const field = XMP_NAMESPACE_FIELDS[key];
    if (!field) continue;
    const [namespace, localName] = field;
    for (const prefix of namespacePrefixes(result, namespace)) {
      result = removeNamespacedProperty(result, prefix, localName);
    }
  }
  return result;
}

const OWNED_XMP_NAMESPACES = new Set([
  "http://purl.org/dc/elements/1.1/",
  "http://ns.adobe.com/xap/1.0/",
  "http://ns.adobe.com/pdf/1.3/",
  PDFA_NAMESPACE,
]);
const STRUCTURAL_XMP_NAMESPACES = new Set([
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  "http://www.w3.org/XML/1998/namespace",
]);

function namespaceMap(xml) {
  const namespaces = new Map();
  const pattern = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([^"']+)\2/g;
  for (const match of xml.matchAll(pattern)) namespaces.set(match[1], match[3]);
  return namespaces;
}

function extractMixedForeignDescription(description, namespaces) {
  const openingEnd = description.indexOf(">");
  if (openingEnd < 0 || description.endsWith("/>")) return "";
  const opening = description.slice(0, openingEnd + 1);
  const inner = description.slice(openingEnd + 1, description.lastIndexOf("</rdf:Description>"));
  const foreign = [...namespaces].filter(([, uri]) =>
    !OWNED_XMP_NAMESPACES.has(uri) && !STRUCTURAL_XMP_NAMESPACES.has(uri));
  if (!foreign.length) return "";
  const attributes = [];
  const children = [];
  for (const [prefix] of foreign) {
    const escaped = escapeRegex(prefix);
    const attrPattern = new RegExp(`\\s+${escaped}:([\\w.-]+)\\s*=\\s*(?:"[^"]*"|'[^']*')`, "g");
    attributes.push(...opening.match(attrPattern) || []);
    const childPattern = new RegExp(`<${escaped}:[\\w.-]+\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${escaped}:[\\w.-]+\\s*>)`, "g");
    children.push(...inner.match(childPattern) || []);
  }
  if (!attributes.length && !children.length) return "";
  const about = /\srdf:about\s*=\s*("[^"]*"|'[^']*')/.exec(opening)?.[1] || '""';
  const declarations = foreign.map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join("");
  return `<rdf:Description rdf:about=${about}${declarations}${attributes.join("")}>${children.join("")}</rdf:Description>`;
}

function extractPreservableXmpExtensions(xml, PDFLib) {
  const preserved = [...(PDFLib.extractForeignXmpDescriptions?.(xml) || [])];
  const existing = new Set(preserved);
  const namespaces = namespaceMap(xml);
  const descriptions = xml.match(/<rdf:Description\b[^>]*\/>|<rdf:Description\b[^>]*>[\s\S]*?<\/rdf:Description>/g) || [];
  for (const description of descriptions) {
    if (existing.has(description)) continue;
    const mixed = extractMixedForeignDescription(description, namespaces);
    if (mixed && !existing.has(mixed)) {
      existing.add(mixed);
      preserved.push(mixed);
    }
  }
  return preserved;
}

function pdfaMetadataInfo(pdfDocument, conformance, extensions) {
  return {
    conformance,
    title: optionalMetadataValue(() => pdfDocument.getTitle()),
    author: optionalMetadataValue(() => pdfDocument.getAuthor()),
    subject: optionalMetadataValue(() => pdfDocument.getSubject()),
    keywords: optionalMetadataValue(() => pdfDocument.getKeywords()),
    creator: optionalMetadataValue(() => pdfDocument.getCreator()),
    producer: optionalMetadataValue(() => pdfDocument.getProducer()),
    creationDate: optionalMetadataValue(() => pdfDocument.getCreationDate()),
    modificationDate: optionalMetadataValue(() => pdfDocument.getModificationDate()),
    extensions,
  };
}

function supportedPdfaConformance(xml, PDFLib) {
  return PDFLib.parsePDFAConformanceFromXmp?.(xml);
}

function attachmentPdfaConformance(xml, PDFLib) {
  const parsed = supportedPdfaConformance(xml, PDFLib);
  if (parsed) return parsed;
  if (!xml || !xml.includes(PDFA_NAMESPACE)) return null;

  const readField = (localName) => {
    for (const prefix of namespacePrefixes(xml, PDFA_NAMESPACE)) {
      const escaped = escapeRegex(prefix);
      const local = escapeRegex(localName);
      const attribute = new RegExp(String.raw`${escaped}:${local}\s*=\s*["']([^"']+)["']`, "i").exec(xml)?.[1];
      if (attribute) return attribute.trim();
      const element = new RegExp(String.raw`<${escaped}:${local}\b[^>]*>\s*([^<]+?)\s*</${escaped}:${local}\s*>`, "i").exec(xml)?.[1];
      if (element) return element.trim();
    }
    return "";
  };

  const part = Number(readField("part"));
  const conformance = readField("conformance").toUpperCase();
  if (Number.isInteger(part) && part > 0) return { part, conformance };
  return { unsupported: true };
}

function synchronizeCatalogXmp(pdfDocument, changes, PDFLib) {
  const xml = readCatalogMetadataXml(pdfDocument, PDFLib);
  if (!xml || !Object.keys(changes || {}).length) return;

  const conformance = supportedPdfaConformance(xml, PDFLib);
  if (conformance) {
    const extensions = extractPreservableXmpExtensions(xml, PDFLib);
    const synchronized = PDFLib.buildPDFAMetadata(
      pdfaMetadataInfo(pdfDocument, conformance, extensions),
    );
    writeCatalogMetadataXml(pdfDocument, synchronized, PDFLib);
    return;
  }

  if (xml.includes(PDFA_NAMESPACE)) {
    throw new Error("This PDF/A XMP version cannot be edited safely by Doc Bench.");
  }

  const stripped = stripEditedStandardXmp(xml, changes);
  if (stripped !== xml) writeCatalogMetadataXml(pdfDocument, stripped, PDFLib);
}

export async function readPdfMetadata(pdfBytes, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
  return metadataFromDocument(pdfDocument);
}

function normalizeXmpPacket(xml) {
  return String(xml || "").replace(/\r\n?/g, "\n").trim();
}

export async function verifyPdfMetadata(
  pdfBytes,
  expectedMetadata,
  changes = {},
  PDFLib = globalThis.PDFLib,
) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
  const actualMetadata = metadataFromDocument(pdfDocument);
  if (JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)) {
    throw new Error("Output verification failed: document metadata changed.");
  }

  const xml = readCatalogMetadataXml(pdfDocument, PDFLib);
  if (!xml || !Object.keys(changes || {}).length) return;
  const conformance = supportedPdfaConformance(xml, PDFLib);
  if (conformance) {
    const extensions = extractPreservableXmpExtensions(xml, PDFLib);
    const expectedXml = PDFLib.buildPDFAMetadata(
      pdfaMetadataInfo(pdfDocument, conformance, extensions),
    );
    if (normalizeXmpPacket(xml) !== normalizeXmpPacket(expectedXml)) {
      throw new Error("Output verification failed: PDF/A XMP metadata is out of sync.");
    }
    return;
  }
  if (xml.includes(PDFA_NAMESPACE)) {
    throw new Error("Output verification failed: unsupported PDF/A XMP metadata remains.");
  }
  if (stripEditedStandardXmp(xml, changes) !== xml) {
    throw new Error("Output verification failed: stale XMP metadata remains.");
  }
}

function deleteInfoKey(pdfDocument, key, PDFLib) {
  const infoRef = pdfDocument.context.trailerInfo.Info;
  if (!infoRef) return;
  const info = pdfDocument.context.lookup(infoRef);
  info?.delete?.(PDFLib.PDFName.of(key));
}

function applyMetadataDate(pdfDocument, key, value, setter, PDFLib) {
  if (!value) {
    deleteInfoKey(pdfDocument, key, PDFLib);
    return;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid PDF metadata date: ${key}.`);
  setter.call(pdfDocument, date);
}

export async function replacePdfMetadata(
  pdfBytes,
  changes = {},
  PDFLib = globalThis.PDFLib,
) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });

  const stringFields = [
    ["title", "setTitle"],
    ["author", "setAuthor"],
    ["subject", "setSubject"],
    ["creator", "setCreator"],
    ["producer", "setProducer"],
  ];
  for (const [key, setter] of stringFields) {
    if (Object.hasOwn(changes, key)) pdfDocument[setter](String(changes[key] ?? ""));
  }
  if (Object.hasOwn(changes, "keywords")) {
    pdfDocument.setKeywords([String(changes.keywords ?? "")]);
  }
  if (Object.hasOwn(changes, "creationDate")) {
    applyMetadataDate(pdfDocument, "CreationDate", changes.creationDate, pdfDocument.setCreationDate, PDFLib);
  }
  if (Object.hasOwn(changes, "modificationDate")) {
    applyMetadataDate(pdfDocument, "ModDate", changes.modificationDate, pdfDocument.setModificationDate, PDFLib);
  }
  synchronizeCatalogXmp(pdfDocument, changes, PDFLib);

  return pdfDocument.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

const MAX_ATTACHMENT_TREE_NODES = 10000;
const AF_RELATIONSHIPS = new Set([
  "Source", "Data", "Alternative", "Supplement", "FormData",
  "EncryptedPayload", "Schema", "Unspecified",
]);

function normalizeAttachmentDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

function pdfText(value, PDFLib) {
  if (value instanceof PDFLib.PDFHexString || value instanceof PDFLib.PDFString) {
    try { return value.decodeText(); } catch { return ""; }
  }
  return "";
}

function pdfDate(value, PDFLib) {
  if (!(value instanceof PDFLib.PDFString || value instanceof PDFLib.PDFHexString)) return "";
  try {
    const dateString = value instanceof PDFLib.PDFString
      ? value
      : PDFLib.PDFString.of(value.decodeText());
    return normalizeAttachmentDate(dateString.decodeDate());
  } catch {
    return "";
  }
}

function pdfNameOrText(value, PDFLib) {
  if (value instanceof PDFLib.PDFName) return value.toString().slice(1);
  return pdfText(value, PDFLib);
}

function pdfRawBytes(value, PDFLib) {
  if (value instanceof PDFLib.PDFHexString || value instanceof PDFLib.PDFString) {
    try {
      const bytes = value.asBytes?.();
      if (bytes instanceof Uint8Array) return bytes.slice();
    } catch {}
  }
  return new Uint8Array();
}

function normalizeAttachmentChecksum(value) {
  if (!value) return new Uint8Array();
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value);
}

export function normalizePdfAttachment(attachment = {}) {
  const rawData = attachment.data ?? new Uint8Array();
  const data = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
  const relationship = String(attachment.afRelationship || "");
  return {
    name: String(attachment.name || ""),
    data,
    mimeType: String(attachment.mimeType || ""),
    afRelationship: AF_RELATIONSHIPS.has(relationship) ? relationship : "",
    description: String(attachment.description || ""),
    creationDate: normalizeAttachmentDate(attachment.creationDate),
    modificationDate: normalizeAttachmentDate(attachment.modificationDate),
    checksum: normalizeAttachmentChecksum(attachment.checksum),
    sourcePdfBytes: attachment.sourcePdfBytes instanceof Uint8Array
      ? attachment.sourcePdfBytes
      : null,
    sourceSpecIndex: Number.isInteger(attachment.sourceSpecIndex)
      ? attachment.sourceSpecIndex
      : null,
  };
}

function attachmentFromFileSpec(fileSpec, treeName, PDFLib) {
  const ef = fileSpec.lookup(PDFLib.PDFName.of("EF"));
  if (!(ef instanceof PDFLib.PDFDict)) return null;
  const stream = ef.has(PDFLib.PDFName.of("UF"))
    ? ef.lookup(PDFLib.PDFName.of("UF"))
    : ef.lookup(PDFLib.PDFName.of("F"));
  if (!(stream instanceof PDFLib.PDFStream)) return null;

  const specName = fileSpec.has(PDFLib.PDFName.of("UF"))
    ? pdfText(fileSpec.lookup(PDFLib.PDFName.of("UF")), PDFLib)
    : pdfText(fileSpec.lookup(PDFLib.PDFName.of("F")), PDFLib);
  const subtype = stream.dict.lookup(PDFLib.PDFName.of("Subtype"));
  const mimeType = pdfNameOrText(subtype, PDFLib)
    .replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const params = stream.dict.lookup(PDFLib.PDFName.of("Params"));
  const creationDate = params instanceof PDFLib.PDFDict
    ? pdfDate(params.lookup(PDFLib.PDFName.of("CreationDate")), PDFLib)
    : "";
  const modificationDate = params instanceof PDFLib.PDFDict
    ? pdfDate(params.lookup(PDFLib.PDFName.of("ModDate")), PDFLib)
    : "";
  const checksum = params instanceof PDFLib.PDFDict
    ? pdfRawBytes(params.lookup(PDFLib.PDFName.of("CheckSum")), PDFLib)
    : new Uint8Array();
  const relationship = pdfNameOrText(
    fileSpec.lookup(PDFLib.PDFName.of("AFRelationship")), PDFLib,
  );
  const description = pdfText(fileSpec.lookup(PDFLib.PDFName.of("Desc")), PDFLib);
  const attachmentName = treeName || specName || "attachment";
  let data;
  try {
    data = PDFLib.decodePDFRawStream(stream).decode();
  } catch (error) {
    throw new Error(
      `Could not decode PDF attachment ${attachmentName}; refusing to rewrite attachments.`,
      { cause: error },
    );
  }
  return normalizePdfAttachment({
    name: attachmentName,
    data,
    mimeType,
    afRelationship: relationship,
    description,
    creationDate,
    modificationDate,
    checksum,
  });
}

const MAX_ATTACHMENT_GRAPH_NODES = 50000;

function walkPdfObjectGraph(pdfDocument, PDFLib, visitDict) {
  const seenRefs = new Set();
  const seenObjects = new Set();
  let visited = 0;

  const walk = (rawValue) => {
    let value = rawValue;
    if (value instanceof PDFLib.PDFRef) {
      const key = value.toString();
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      try { value = pdfDocument.context.lookup(value); } catch { return; }
    }
    if (value instanceof PDFLib.PDFStream) return;
    if (value instanceof PDFLib.PDFDict) {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);
      visited += 1;
      if (visited > MAX_ATTACHMENT_GRAPH_NODES) {
        throw new Error("PDF object graph is too large to preserve attachment associations safely.");
      }
      visitDict(value);
      let type = "";
      try { type = pdfNameOrText(value.lookup(PDFLib.PDFName.of("Type")), PDFLib); } catch {}
      if (type === "Filespec") return;
      for (const key of value.keys()) {
        const name = key.toString();
        if (name === "/AF" || name === "/FS" || name === "/EF") continue;
        walk(value.get(key));
      }
      return;
    }
    if (value instanceof PDFLib.PDFArray) {
      if (seenObjects.has(value)) return;
      seenObjects.add(value);
      visited += 1;
      if (visited > MAX_ATTACHMENT_GRAPH_NODES) {
        throw new Error("PDF object graph is too large to preserve attachment associations safely.");
      }
      for (let index = 0; index < value.size(); index += 1) walk(value.get(index));
    }
  };

  walk(pdfDocument.catalog);
  for (const page of pdfDocument.getPages()) walk(page.node);
}

function collectPdfAttachmentSpecs(pdfDocument, PDFLib, records = null) {
  const results = [];
  const seenRefs = new Set();
  const seenDicts = new Set();
  const visitedNodes = new Set();
  let visitedCount = 0;

  const addSpec = (rawSpec, fileSpec, treeName = "", { allowAlias = false } = {}) => {
    const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";
    const alreadySeen = refKey ? seenRefs.has(refKey) : seenDicts.has(fileSpec);
    if (alreadySeen && !allowAlias) return;
    if (!alreadySeen) {
      if (refKey) seenRefs.add(refKey); else seenDicts.add(fileSpec);
    }
    const attachment = attachmentFromFileSpec(fileSpec, treeName, PDFLib);
    if (!attachment) return;
    results.push(attachment);
    records?.push({ rawSpec, fileSpec, attachment });
  };

  const collectAssociated = (dict) => {
    const afKey = PDFLib.PDFName.of("AF");
    if (!(dict instanceof PDFLib.PDFDict) || !dict.has(afKey)) return;
    const associated = dict.lookup(afKey);
    if (!(associated instanceof PDFLib.PDFArray)) return;
    for (let index = 0; index < associated.size(); index += 1) {
      let rawSpec;
      let fileSpec;
      try {
        rawSpec = associated.get(index);
        fileSpec = associated.lookup(index, PDFLib.PDFDict);
      } catch {
        continue;
      }
      addSpec(rawSpec, fileSpec);
    }
  };

  const walkNameTree = (node) => {
    if (!(node instanceof PDFLib.PDFDict) || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    visitedCount += 1;
    if (visitedCount > MAX_ATTACHMENT_TREE_NODES) {
      throw new Error("PDF attachment name tree is too large.");
    }
    const namesKey = PDFLib.PDFName.of("Names");
    if (node.has(namesKey)) {
      const names = node.lookup(namesKey);
      if (names instanceof PDFLib.PDFArray) {
        for (let index = 0; index + 1 < names.size(); index += 2) {
          let name;
          let rawSpec;
          let fileSpec;
          try {
            name = pdfText(names.lookup(index), PDFLib);
            rawSpec = names.get(index + 1);
            fileSpec = names.lookup(index + 1, PDFLib.PDFDict);
          } catch {
            continue;
          }
          addSpec(rawSpec, fileSpec, name, { allowAlias: true });
        }
      }
    }
    const kidsKey = PDFLib.PDFName.of("Kids");
    if (node.has(kidsKey)) {
      const kids = node.lookup(kidsKey);
      if (kids instanceof PDFLib.PDFArray) {
        for (let index = 0; index < kids.size(); index += 1) {
          let child;
          try { child = kids.lookup(index, PDFLib.PDFDict); } catch { continue; }
          walkNameTree(child);
        }
      }
    }
  };

  const namesKey = PDFLib.PDFName.of("Names");
  const embeddedKey = PDFLib.PDFName.of("EmbeddedFiles");
  if (pdfDocument.catalog.has(namesKey)) {
    const names = pdfDocument.catalog.lookup(namesKey);
    if (names instanceof PDFLib.PDFDict && names.has(embeddedKey)) {
      const embedded = names.lookup(embeddedKey);
      if (embedded instanceof PDFLib.PDFDict) walkNameTree(embedded);
    }
  }

  walkPdfObjectGraph(pdfDocument, PDFLib, (dict) => {
    collectAssociated(dict);
    let subtype = "";
    try { subtype = pdfNameOrText(dict.lookup(PDFLib.PDFName.of("Subtype")), PDFLib); } catch {}
    const fsKey = PDFLib.PDFName.of("FS");
    if (subtype !== "FileAttachment" || !dict.has(fsKey)) return;
    let rawSpec;
    let fileSpec;
    try {
      rawSpec = dict.get(fsKey);
      fileSpec = dict.lookup(fsKey, PDFLib.PDFDict);
    } catch {
      return;
    }
    addSpec(rawSpec, fileSpec);
  });
  return results;
}

export async function readPdfAttachments(pdfBytes, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const sourcePdfBytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const pdfDocument = await PDFLib.PDFDocument.load(sourcePdfBytes, { updateMetadata: false });
  return collectPdfAttachmentSpecs(pdfDocument, PDFLib).map((attachment, sourceSpecIndex) => ({
    ...attachment,
    sourcePdfBytes,
    sourceSpecIndex,
  }));
}

function attachmentRecordFor(rawSpec, fileSpec, records, PDFLib) {
  const refKey = rawSpec instanceof PDFLib.PDFRef ? rawSpec.toString() : "";
  for (const record of records) {
    const recordRef = record.rawSpec instanceof PDFLib.PDFRef ? record.rawSpec.toString() : "";
    if ((refKey && recordRef === refKey) || (!refKey && record.fileSpec === fileSpec)) {
      return record;
    }
  }
  return null;
}

function attachmentPayloadMatches(left, right) {
  return left.mimeType === right.mimeType
    && left.afRelationship === right.afRelationship
    && left.description === right.description
    && left.creationDate === right.creationDate
    && left.modificationDate === right.modificationDate
    && sameBytes(left.checksum || new Uint8Array(), right.checksum || new Uint8Array())
    && sameBytes(left.data, right.data);
}

function assignAttachmentTargets(records, attachments) {
  const used = new Set();
  const findMatch = (record, requireName) => {
    for (let index = 0; index < attachments.length; index += 1) {
      if (used.has(index)) continue;
      const candidate = attachments[index];
      if (requireName && candidate.name !== record.attachment.name) continue;
      if (attachmentPayloadMatches(record.attachment, candidate)) return index;
    }
    return -1;
  };

  for (const record of records) {
    let index = findMatch(record, true);
    if (index < 0) index = findMatch(record, false);
    record.targetName = index < 0 ? null : attachments[index].name;
    if (index >= 0) used.add(index);
  }
  return used;
}

function detachAssociatedFileLocations(pdfDocument, records, PDFLib) {
  const locations = [];
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");

  const recordFor = (rawSpec, fileSpec) => {
    const record = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);
    if (!record) {
      throw new Error("Could not preserve an associated-file reference safely.");
    }
    return record;
  };

  walkPdfObjectGraph(pdfDocument, PDFLib, (dict) => {
    if (dict.has(afKey)) {
      const recordList = [];
      const associated = dict.lookup(afKey);
      if (!(associated instanceof PDFLib.PDFArray)) {
        throw new Error("Could not preserve a malformed associated-file array safely.");
      }
      for (let index = 0; index < associated.size(); index += 1) {
        let rawSpec;
        let fileSpec;
        try {
          rawSpec = associated.get(index);
          fileSpec = associated.lookup(index, PDFLib.PDFDict);
        } catch (error) {
          throw new Error("Could not preserve an associated-file reference safely.", { cause: error });
        }
        recordList.push(recordFor(rawSpec, fileSpec));
      }
      locations.push({ kind: "AF", dict, records: recordList, isCatalog: dict === pdfDocument.catalog });
      dict.delete(afKey);
    }

    let subtype = "";
    try { subtype = pdfNameOrText(dict.lookup(PDFLib.PDFName.of("Subtype")), PDFLib); } catch {}
    if (subtype !== "FileAttachment" || !dict.has(fsKey)) return;
    let rawSpec;
    let fileSpec;
    try {
      rawSpec = dict.get(fsKey);
      fileSpec = dict.lookup(fsKey, PDFLib.PDFDict);
    } catch (error) {
      throw new Error("Could not preserve a FileAttachment /FS reference safely.", { cause: error });
    }
    const managedRecord = attachmentRecordFor(rawSpec, fileSpec, records, PDFLib);
    if (!managedRecord) return;
    locations.push({ kind: "FS", dict, records: [managedRecord], isCatalog: false });
    dict.delete(fsKey);
  });
  return locations;
}

function deleteOldAttachmentObjects(pdfDocument, records, PDFLib) {
  const deleted = new Set();
  const deleteRef = (value) => {
    if (!(value instanceof PDFLib.PDFRef)) return;
    const key = value.toString();
    if (deleted.has(key)) return;
    deleted.add(key);
    pdfDocument.context.delete(value);
  };

  for (const { rawSpec, fileSpec } of records) {
    try {
      const ef = fileSpec.lookup(PDFLib.PDFName.of("EF"));
      if (ef instanceof PDFLib.PDFDict) {
        for (const key of ef.keys()) deleteRef(ef.get(key));
      }
    } catch {}
    deleteRef(rawSpec);
  }
}

function clearPdfAttachmentRoots(pdfDocument, records, PDFLib) {
  const locations = detachAssociatedFileLocations(pdfDocument, records, PDFLib);
  const namesKey = PDFLib.PDFName.of("Names");
  const embeddedKey = PDFLib.PDFName.of("EmbeddedFiles");
  if (pdfDocument.catalog.has(namesKey)) {
    const names = pdfDocument.catalog.lookup(namesKey);
    if (names instanceof PDFLib.PDFDict) names.delete(embeddedKey);
  }
  pdfDocument.catalog.delete(PDFLib.PDFName.of("AF"));
  deleteOldAttachmentObjects(pdfDocument, records, PDFLib);
  return locations;
}

function restoreAssociatedFileLocations(pdfDocument, locations, newAttachmentNames, PDFLib) {
  const rawAttachments = pdfDocument.getRawAttachments?.() || [];
  const byName = new Map(rawAttachments.map(({ fileName, specRef }) => [pdfText(fileName, PDFLib), specRef]));
  const afKey = PDFLib.PDFName.of("AF");
  const fsKey = PDFLib.PDFName.of("FS");
  pdfDocument.catalog.delete(afKey);

  let catalogLocation = null;
  for (const location of locations) {
    if (location.isCatalog) catalogLocation = location;
    const refs = location.records
      .map((record) => record.targetName ? byName.get(record.targetName) : null)
      .filter(Boolean);
    if (location.kind === "AF" && refs.length) {
      location.dict.set(afKey, pdfDocument.context.obj(refs));
    } else if (location.kind === "FS" && refs[0]) {
      location.dict.set(fsKey, refs[0]);
    }
  }

  const newRefs = newAttachmentNames.map((name) => byName.get(name)).filter(Boolean);
  if (!newRefs.length) return;
  if (catalogLocation) {
    const current = pdfDocument.catalog.lookup(afKey);
    const refs = [];
    if (current instanceof PDFLib.PDFArray) {
      for (let index = 0; index < current.size(); index += 1) refs.push(current.get(index));
    }
    refs.push(...newRefs);
    pdfDocument.catalog.set(afKey, pdfDocument.context.obj(refs));
  } else {
    pdfDocument.catalog.set(afKey, pdfDocument.context.obj(newRefs));
  }
}

async function restoreSourceFileSpecs(pdfDocument, attachments, PDFLib) {
  if (!attachments.some((attachment) => attachment.sourcePdfBytes && Number.isInteger(attachment.sourceSpecIndex))) return;
  if (!PDFLib.PDFObjectCopier?.for) {
    throw new Error("PDF object copier is unavailable; refusing to rewrite source attachment FileSpecs.");
  }

  const targetRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, targetRecords);
  const targets = new Map(
    targetRecords.map(({ attachment, fileSpec }) => [attachment.name, fileSpec]),
  );
  const loaded = new Map();
  for (const attachment of attachments) {
    if (!attachment.sourcePdfBytes || !Number.isInteger(attachment.sourceSpecIndex)) continue;
    let source = loaded.get(attachment.sourcePdfBytes);
    if (!source) {
      const document = await PDFLib.PDFDocument.load(attachment.sourcePdfBytes, { updateMetadata: false });
      const records = [];
      collectPdfAttachmentSpecs(document, PDFLib, records);
      source = { document, records, copier: PDFLib.PDFObjectCopier.for(document.context, pdfDocument.context) };
      loaded.set(attachment.sourcePdfBytes, source);
    }
    const record = source.records[attachment.sourceSpecIndex];
    const target = targets.get(attachment.name);
    if (!record || !target) {
      throw new Error(`Could not restore source FileSpec for ${attachment.name}.`);
    }
    for (const key of record.fileSpec.keys()) {
      const name = key.toString();
      if (name === "/Type") continue;
      if (name === "/EF") {
        let sourceEf;
        try { sourceEf = record.fileSpec.lookup(key, PDFLib.PDFDict); } catch {}
        if (sourceEf) {
          const restoredEf = pdfDocument.context.obj({});
          for (const efKey of sourceEf.keys()) {
            restoredEf.set(efKey, source.copier.copy(sourceEf.get(efKey)));
          }
          target.set(key, restoredEf);
        }
        continue;
      }
      if (name === "/F" || name === "/UF") {
        let sourceName = "";
        try { sourceName = pdfText(record.fileSpec.lookup(key), PDFLib); } catch {}
        if (sourceName === record.attachment.name) continue;
      }
      target.set(key, source.copier.copy(record.fileSpec.get(key)));
    }
  }
}

function attachmentOptions(attachment) {
  return {
    mimeType: attachment.mimeType || undefined,
    description: attachment.description || undefined,
    creationDate: attachment.creationDate ? new Date(attachment.creationDate) : undefined,
    modificationDate: attachment.modificationDate ? new Date(attachment.modificationDate) : undefined,
    afRelationship: attachment.afRelationship === "FormData"
      ? undefined
      : (attachment.afRelationship || undefined),
  };
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function restoreAttachmentChecksums(pdfDocument, attachments, PDFLib) {
  const checksums = new Map(
    attachments
      .filter((attachment) => attachment.checksum?.byteLength)
      .map((attachment) => [attachment.name, attachment.checksum]),
  );
  if (!checksums.size) return;

  for (const { fileName, fileSpec } of pdfDocument.getRawAttachments?.() || []) {
    const checksum = checksums.get(pdfText(fileName, PDFLib));
    if (!checksum) continue;
    const ef = fileSpec.lookup(PDFLib.PDFName.of("EF"));
    if (!(ef instanceof PDFLib.PDFDict)) continue;
    const stream = ef.has(PDFLib.PDFName.of("UF"))
      ? ef.lookup(PDFLib.PDFName.of("UF"))
      : ef.lookup(PDFLib.PDFName.of("F"));
    if (!(stream instanceof PDFLib.PDFStream)) continue;
    const paramsKey = PDFLib.PDFName.of("Params");
    let params = stream.dict.lookup(paramsKey);
    if (!(params instanceof PDFLib.PDFDict)) {
      params = pdfDocument.context.obj({});
      stream.dict.set(paramsKey, params);
    }
    params.set(
      PDFLib.PDFName.of("CheckSum"),
      PDFLib.PDFHexString.of(bytesToHex(checksum)),
    );
  }
}

function restoreFormDataRelationships(pdfDocument, attachments, PDFLib) {
  const formDataNames = new Set(
    attachments
      .filter((attachment) => attachment.afRelationship === "FormData")
      .map((attachment) => attachment.name),
  );
  if (!formDataNames.size) return;

  for (const { fileName, fileSpec } of pdfDocument.getRawAttachments?.() || []) {
    const name = pdfText(fileName, PDFLib);
    if (formDataNames.has(name)) {
      fileSpec.set(PDFLib.PDFName.of("AFRelationship"), PDFLib.PDFName.of("FormData"));
    }
  }
}

async function pdfaAttachmentConformance(attachment, PDFLib) {
  const data = attachment.data;
  if (data.byteLength < 5) return null;
  const signature = new TextDecoder("ascii").decode(data.subarray(0, 5));
  if (signature !== "%PDF-") return null;
  try {
    const document = await PDFLib.PDFDocument.load(data, { updateMetadata: false });
    return attachmentPdfaConformance(readCatalogMetadataXml(document, PDFLib), PDFLib);
  } catch {
    return null;
  }
}

async function validatePdfaAttachmentSet(conformance, attachments, PDFLib) {
  if (conformance?.unsupported) {
    throw new Error("This PDF/A declaration cannot be validated safely for embedded files.");
  }
  const part = Number(conformance?.part);
  if (part === 1 && attachments.length) {
    throw new Error("PDF/A-1 does not permit embedded files.");
  }
  if (part !== 2) return;
  for (const attachment of attachments) {
    const embeddedConformance = await pdfaAttachmentConformance(attachment, PDFLib);
    const embeddedPart = Number(embeddedConformance?.part);
    if (embeddedPart !== 1 && embeddedPart !== 2) {
      throw new Error(
        `PDF/A-2 permits only PDF/A-1 or PDF/A-2 attachments; remove or replace ${attachment.name}.`,
      );
    }
  }
}

export async function replacePdfAttachments(
  pdfBytes,
  attachments = [],
  PDFLib = globalThis.PDFLib,
) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");
  const normalized = attachments.map(normalizePdfAttachment);
  const names = new Set();
  for (const attachment of normalized) {
    if (!attachment.name.trim()) throw new Error("Attachment names cannot be empty.");
    const key = attachment.name;
    if (names.has(key)) throw new Error(`Duplicate attachment name: ${attachment.name}`);
    names.add(key);
  }
  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: false });
  const conformance = attachmentPdfaConformance(readCatalogMetadataXml(pdfDocument, PDFLib), PDFLib);
  await validatePdfaAttachmentSet(conformance, normalized, PDFLib);
  const oldRecords = [];
  collectPdfAttachmentSpecs(pdfDocument, PDFLib, oldRecords);
  const matchedTargets = assignAttachmentTargets(oldRecords, normalized);
  const newAttachmentNames = normalized
    .filter((_, index) => !matchedTargets.has(index))
    .map((attachment) => attachment.name);
  const associatedLocations = clearPdfAttachmentRoots(pdfDocument, oldRecords, PDFLib);
  for (const attachment of normalized) {
    await pdfDocument.attach(
      attachment.data,
      attachment.name,
      attachmentOptions(attachment),
    );
  }
  await pdfDocument.flush();
  await restoreSourceFileSpecs(pdfDocument, normalized, PDFLib);
  restoreFormDataRelationships(pdfDocument, normalized, PDFLib);
  restoreAttachmentChecksums(pdfDocument, normalized, PDFLib);
  restoreAssociatedFileLocations(pdfDocument, associatedLocations, newAttachmentNames, PDFLib);
  return pdfDocument.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function attachmentSignature(attachment) {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    afRelationship: attachment.afRelationship,
    description: attachment.description,
    creationDate: attachment.creationDate,
    modificationDate: attachment.modificationDate,
    checksum: [...(attachment.checksum || [])],
  };
}

export async function verifyPdfAttachments(
  pdfBytes,
  expectedAttachments = [],
  PDFLib = globalThis.PDFLib,
) {
  const expected = expectedAttachments.map(normalizePdfAttachment);
  const actual = await readPdfAttachments(pdfBytes, PDFLib);
  if (actual.length !== expected.length) {
    throw new Error(`Output verification failed: expected ${expected.length} attachments, got ${actual.length}.`);
  }
  const actualByName = new Map(actual.map((attachment) => [attachment.name, attachment]));
  for (const expectedAttachment of expected) {
    const actualAttachment = actualByName.get(expectedAttachment.name);
    if (!actualAttachment) {
      throw new Error(`Output verification failed: attachment ${expectedAttachment.name} is missing.`);
    }
    if (JSON.stringify(attachmentSignature(actualAttachment)) !== JSON.stringify(attachmentSignature(expectedAttachment))) {
      throw new Error(`Output verification failed: attachment metadata changed for ${expectedAttachment.name}.`);
    }
    if (!sameBytes(actualAttachment.data, expectedAttachment.data)) {
      throw new Error(`Output verification failed: attachment bytes changed for ${expectedAttachment.name}.`);
    }
  }
}

function uniqueAttachmentName(name, used) {
  const rawName = String(name ?? "");
  const base = rawName.trim() ? rawName : "attachment";
  if (!used.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : "";
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const candidate = `${stem} (${suffix})${extension}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("Could not allocate a unique attachment name.");
}

export function mergePdfAttachmentSets(existing = [], incoming = []) {
  const merged = existing.map(normalizePdfAttachment);
  const used = new Set(merged.map((attachment) => attachment.name.toLowerCase()));
  for (const raw of incoming) {
    const attachment = normalizePdfAttachment(raw);
    attachment.name = uniqueAttachmentName(attachment.name, used);
    used.add(attachment.name.toLowerCase());
    merged.push(attachment);
  }
  return merged;
}

export function mergePdfAttachmentSourceSets(sourceSets = [], existing = null) {
  let merged = existing == null ? null : existing.map(normalizePdfAttachment);
  for (const sourceSet of sourceSets) {
    const normalized = (sourceSet || []).map(normalizePdfAttachment);
    if (merged == null) {
      merged = normalized;
    } else {
      merged = mergePdfAttachmentSets(merged, normalized);
    }
  }
  return merged || [];
}

export function buildQpdfPageRequest(sources, pagePlan, outputName = "output.pdf") {
  if (!sources.length) throw new Error("At least one PDF source is required.");
  if (!pagePlan.length) throw new Error("A PDF must contain at least one page.");

  const inputNames = sources.map((_, index) => `source-${index}.pdf`);
  const inputs = Object.fromEntries(
    sources.map((source, index) => [inputNames[index], source.bytes]),
  );
  const args = [inputNames[0], "--pages"];

  for (const page of pagePlan) {
    const name = inputNames[page.sourceId];
    if (!name || !Number.isInteger(page.pageIndex) || page.pageIndex < 0) {
      throw new Error("Invalid PDF page plan.");
    }
    args.push(name, String(page.pageIndex + 1));
  }
  args.push("--", outputName);

  return { inputs, args, outputs: [outputName], outputName };
}

function normalizeJpegQuality(value) {
  const quality = Number(value);
  if (!Number.isFinite(quality)) return 75;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

export function buildQpdfFinalizeRequest(
  pdfBytes,
  { optimize = false, linearize = false, lossyImages = false, jpegQuality = 75 } = {},
  outputName = "output.pdf",
) {
  const inputName = "input.pdf";
  const args = [inputName];
  if (optimize) {
    args.push("--object-streams=generate", "--recompress-flate", "--compression-level=9");
  }
  if (lossyImages) {
    args.push("--optimize-images", `--jpeg-quality=${normalizeJpegQuality(jpegQuality)}`);
  }
  if (linearize) args.push("--linearize");
  args.push(outputName);
  return {
    inputs: { [inputName]: pdfBytes },
    args,
    outputs: [outputName],
    outputName,
  };
}

function setIf(dict, key, value, PDFLib) {
  if (value !== undefined && value !== null) {
    dict.set(PDFLib.PDFName.of(key), value);
  }
}

function applyBookmarkTarget(pdfDocument, dict, target, PDFLib) {
  if (!target) return;

  if (target.kind === "page") {
    if (target.pageIndex < 0 || target.pageIndex >= pdfDocument.getPageCount()) return;
    const pageRef = pdfDocument.getPage(target.pageIndex).ref;
    const type = DESTINATION_TYPES.has(target.view?.type) ? target.view.type : "Fit";
    const args = (target.view?.args || []).map((value) => {
      return Number.isFinite(value) ? Number(value) : null;
    });
    dict.set(
      PDFLib.PDFName.of("Dest"),
      pdfDocument.context.obj([pageRef, PDFLib.PDFName.of(type), ...args]),
    );
    return;
  }

  if (target.kind === "url" && target.url) {
    dict.set(
      PDFLib.PDFName.of("A"),
      pdfDocument.context.obj({
        S: "URI",
        URI: PDFLib.PDFString.of(target.url),
        ...(target.newWindow ? { NewWindow: true } : {}),
      }),
    );
    return;
  }

  if (target.kind === "named" && target.action) {
    dict.set(
      PDFLib.PDFName.of("A"),
      pdfDocument.context.obj({
        S: "Named",
        N: PDFLib.PDFName.of(target.action),
      }),
    );
  }
}

function buildOutlineLevel(pdfDocument, bookmarks, parentRef, PDFLib) {
  const context = pdfDocument.context;
  const records = (bookmarks || []).map((bookmark) => {
    const dict = context.obj({
      Title: PDFLib.PDFHexString.fromText(bookmark.title || "Untitled bookmark"),
      Parent: parentRef,
    });
    return { bookmark, dict, ref: context.register(dict), descendants: 0 };
  });

  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    if (index > 0) current.dict.set(PDFLib.PDFName.of("Prev"), records[index - 1].ref);
    if (index + 1 < records.length) {
      current.dict.set(PDFLib.PDFName.of("Next"), records[index + 1].ref);
    }

    applyBookmarkTarget(pdfDocument, current.dict, current.bookmark.target, PDFLib);

    if ((current.bookmark.color || []).length === 3) {
      const color = current.bookmark.color.map((value) => clampByte(value) / 255);
      current.dict.set(PDFLib.PDFName.of("C"), context.obj(color));
    }
    const flags = (current.bookmark.italic ? 1 : 0) | (current.bookmark.bold ? 2 : 0);
    if (flags) current.dict.set(PDFLib.PDFName.of("F"), context.obj(flags));

    if (current.bookmark.children?.length) {
      const children = buildOutlineLevel(
        pdfDocument,
        current.bookmark.children,
        current.ref,
        PDFLib,
      );
      setIf(current.dict, "First", children.first, PDFLib);
      setIf(current.dict, "Last", children.last, PDFLib);
      current.descendants = children.total;
      current.dict.set(
        PDFLib.PDFName.of("Count"),
        context.obj(current.bookmark.open === false ? -children.total : children.total),
      );
    }
  }

  return {
    first: records[0]?.ref,
    last: records.at(-1)?.ref,
    total: records.reduce((sum, record) => sum + 1 + record.descendants, 0),
  };
}

export async function replacePdfOutline(pdfBytes, outline, PDFLib = globalThis.PDFLib) {
  if (!PDFLib?.PDFDocument) throw new Error("PDF mutation engine is unavailable.");

  const pdfDocument = await PDFLib.PDFDocument.load(pdfBytes, {
    updateMetadata: false,
  });
  const outlinesKey = PDFLib.PDFName.of("Outlines");
  pdfDocument.catalog.delete(outlinesKey);

  if (outline?.length) {
    const root = pdfDocument.context.obj({ Type: "Outlines" });
    const rootRef = pdfDocument.context.register(root);
    const children = buildOutlineLevel(pdfDocument, outline, rootRef, PDFLib);
    setIf(root, "First", children.first, PDFLib);
    setIf(root, "Last", children.last, PDFLib);
    root.set(PDFLib.PDFName.of("Count"), pdfDocument.context.obj(children.total));
    pdfDocument.catalog.set(outlinesKey, rootRef);
  }

  return pdfDocument.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

export function formatPdfSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
