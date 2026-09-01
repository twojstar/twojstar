import { access, readFile, stat } from "node:fs/promises";

for (const path of [
  "public/index.html",
  "public/index.md",
  "public/llms.txt",
  "public/llms-full.txt",
  "public/app.js",
  "public/document-enhancements.mjs",
  "public/document-enhancements.css",
  "public/text-inspector-core.js",
  "public/text-inspector.js",
  "public/webmcp.js",
  "public/pdf-app.mjs",
  "public/pdf-core.mjs",
  "public/fonts.css",
  "public/styles.css",
  "public/fonts/space-grotesk-latin-ext.woff2",
  "public/fonts/space-grotesk-latin.woff2",
  "public/fonts/space-mono-latin-ext-400.woff2",
  "public/fonts/space-mono-latin-400.woff2",
  "public/fonts/space-mono-latin-ext-700.woff2",
  "public/fonts/space-mono-latin-700.woff2",
  "public/vendor/js-yaml.min.js",
  "public/vendor/marked.umd.js",
  "public/vendor/jsonc-parser/impl/parser.js",
  "public/vendor/jsonc-parser/impl/scanner.js",
  "public/vendor/pdf-lib.min.js",
  "public/vendor/fflate.min.js",
  "public/vendor/pdfjs/pdf.mjs",
  "public/vendor/pdfjs/pdf.worker.mjs",
  "public/vendor/qpdf-run/index.js",
  "public/vendor/qpdf-run/browserRunner.js",
  "public/vendor/qpdf-run/bytes.js",
  "public/vendor/qpdf-run/worker.js",
  "public/vendor/qpdf/lib/qpdf.js",
  "public/vendor/qpdf/lib/qpdf.wasm",
  "public/portable.html",
]) {
  await access(path);
}

const documentEnhancements = await readFile(
  "public/document-enhancements.mjs",
  "utf8",
);
if (documentEnhancements.includes("innerHTML")) {
  throw new Error("Rich document preview must not inject rendered HTML.");
}
for (const capability of [
  "showOpenFilePicker",
  "showSaveFilePicker",
  "createWritable",
  "writable.abort",
]) {
  if (!documentEnhancements.includes(capability)) {
    throw new Error(`Document workspace is missing ${capability} support.`);
  }
}
if (!documentEnhancements.includes("MAX_TREE_NODES")) {
  throw new Error("Structured previews must keep a bounded tree renderer.");
}
if (!documentEnhancements.includes('root?.localName !== "html"')
  || !documentEnhancements.includes('const candidate = body?.firstElementChild;')) {
  throw new Error("XML parser errors must detect Chromium's HTML wrapper.");
}
if (!/for \(const attribute of node\.attributes\) \{\r?\n\s*if \(nodes >= MAX_TREE_NODES\)/.test(documentEnhancements)) {
  throw new Error("XML attributes must count against the tree node budget.");
}
if (!documentEnhancements.includes("source.slice(node.offset, node.offset + node.length)")) {
  throw new Error("JSON tree preview must preserve source scalar lexemes.");
}
if (documentEnhancements.includes("JSON.parse(editor.value)")) {
  throw new Error("JSON tree preview must not coerce source numbers through JSON.parse.");
}
const fallbackFunction = documentEnhancements.match(
  /async function syncFallbackFile\(file, revision\) \{([\s\S]*?)\n\}/,
)?.[1] || "";
if (
  !fallbackFunction
  || /catch \{[\s\S]*?state\.handle = null/.test(fallbackFunction)
  || !fallbackFunction.includes("editor.value = normalizeEol(raw)")
  || !fallbackFunction.includes("state.documentRevision !== revision")
) {
  throw new Error("Fallback reads must stay revision-safe and replace the editor only after success.");
}
if (!/fileInput\.addEventListener\("change", \(event\) => \{[\s\S]*?event\.stopImmediatePropagation\(\)[\s\S]*?\}, true\);/.test(documentEnhancements)) {
  throw new Error("Fallback file input must intercept the legacy async open handler.");
}
for (const fidelityGuard of [
  "renderYamlTree",
  "parseEvents",
  "eventsToAst",
  "mergeTag",
  "timestampTag",
  "currentDocumentSnapshot",
  "documentRevision",
  "StaleDocumentError",
  "markdownBudget",
  "appendMarkdownLimit",
  "loadNativeHandle(handle, revision)",
  "syncFallbackFile(file, revision)",
  "appendEmptyDocument",
  "normalizeYamlTag",
  "`Key ${index + 1}`",
  "preservesXmlSpace",
  "PROCESSING_INSTRUCTION_NODE",
  "DOCUMENT_TYPE_NODE",
  'statusBadge.textContent === "Format failed"',
]) {
  if (!documentEnhancements.includes(fidelityGuard)) {
    throw new Error(`Structured preview is missing fidelity guard: ${fidelityGuard}`);
  }
}

const pdfCore = await readFile("public/pdf-core.mjs", "utf8");
for (const metadataCoreGuard of [
  "readPdfMetadata",
  "replacePdfMetadata",
  "normalizePdfMetadata",
  "updateMetadata: false",
  'pdfDocument.setKeywords([String(changes.keywords ?? "")])',
  "deleteInfoKey",
  "decodeXmpBytes",
  "extractPreservableXmpExtensions",
  "readPdfAttachments",
  "replacePdfAttachments",
  "verifyPdfAttachments",
  "MAX_ATTACHMENT_TREE_NODES",
]) {
  if (!pdfCore.includes(metadataCoreGuard)) {
    throw new Error(`PDF metadata core is missing guard: ${metadataCoreGuard}`);
  }
}

const pdfApp = await readFile("public/pdf-app.mjs", "utf8");
for (const exportGuard of [
  "extractSelectedPage",
  "splitAllPages",
  "ZipPassThrough",
  "remapOutlineToPagePlan(snapshot.outline, snapshot.plan, plan)",
  "await verifyOutput(finalBytes, plan.length, outline, snapshot.metadata, snapshot.metadataChanges, snapshot.attachments)",
  "state.exporting",
  "currentMetadataChanges",
  "metadataChanges",
  "replacePdfMetadata",
  "expectedMetadata",
  "mergePdfAttachmentSets",
  "replacePdfAttachments",
  "snapshot.attachments",
]) {
  if (!pdfApp.includes(exportGuard)) {
    throw new Error(`PDF split/extract is missing guard: ${exportGuard}`);
  }
}

const workerSource = await readFile("src/index.ts", "utf8");
if (!workerSource.includes('if (asset.ok && headers.get("content-type")?.includes("text/html"))')) {
  throw new Error("Discovery headers must be limited to successful HTML assets.");
}

const html = await readFile("public/index.html", "utf8");
for (const metadataUiGuard of [
  "pdf-metadata-panel",
  "pdf-meta-title",
  "pdf-meta-author",
  "pdf-meta-subject",
  "pdf-meta-keywords",
  "pdf-meta-creator",
  "pdf-meta-producer",
  "pdf-meta-created",
  "pdf-meta-modified",
  "pdf-metadata-reset",
  "pdf-attachments-panel",
  "pdf-attachment-input",
  "pdf-attachment-add",
  "pdf-attachments-state",
]) {
  if (!html.includes(metadataUiGuard)) {
    throw new Error(`PDF metadata UI is missing guard: ${metadataUiGuard}`);
  }
}

if (!html.includes('rel="alternate" type="text/markdown" href="/index.md"')) {
  throw new Error("Doc Bench Markdown alternate is missing.");
}
if (!html.includes('rel="describedby" href="/llms.txt"')) {
  throw new Error("Doc Bench llms.txt describedby link is missing.");
}
const llms = await readFile("public/llms.txt", "utf8");
const llmsFull = await readFile("public/llms-full.txt", "utf8");
if (!llms.includes("https://docbench.travny.workers.dev/index.md") || !llms.includes("/llms-full.txt")) {
  throw new Error("Doc Bench llms.txt v2 resources are incomplete.");
}
if (!llmsFull.startsWith("# Doc Bench full documentation")) {
  throw new Error("Doc Bench llms-full.txt is missing its H1.");
}

const portable = await readFile("public/portable.html", "utf8");
const resourceHtml = portable.replace(
  /(<script\b[^>]*>)[\s\S]*?<\/script>/gi,
  "$1</script>",
);
const resourceUrls = [];
for (const match of resourceHtml.matchAll(/<(?:script|link|img|source|iframe)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
  resourceUrls.push(match[1]);
}
for (const leaked of [
  "/vendor/",
  "/fonts/",
  "/app.js",
  "/document-enhancements.mjs",
  "/text-inspector.js",
  "/text-inspector-core.js",
  "webmcp.js",
  "/webmcp.js",
  "/pdf-app.mjs",
  "/pdf-core.mjs",
  "/fonts.css",
  "/styles.css",
  "/document-enhancements.css",
]) {
  if (resourceUrls.some((url) => url.startsWith(leaked))) {
    throw new Error(`Portable build still references ${leaked}`);
  }
}
if (portable.includes('./vendor/jsonc-parser/impl/parser.js')) {
  throw new Error("Portable build still references the external JSON parser module.");
}
if (resourceUrls.some((url) => /^https?:\/\//i.test(url))) {
  throw new Error("Portable build must not load third-party resources");
}
if (!portable.includes("Space Grotesk") || !portable.includes("Space Mono")) {
  throw new Error("Portable build is missing embedded Bench fonts");
}
if (!portable.includes("jsyaml")) throw new Error("Portable build is missing YAML runtime");
if (!portable.includes("marked")) throw new Error("Portable build is missing Markdown runtime");
if (!portable.includes("parseTree")) throw new Error("Portable build is missing JSON tree runtime");
if (!portable.includes("Text safety inspection") || !portable.includes("inspect-button")) {
  throw new Error("Portable build is missing text inspector support.");
}
for (const toolName of ["read_document", "set_document_text", "validate_document", "format_document", "inspect_document"]) {
  if (!portable.includes(`name: "${toolName}"`)) {
    throw new Error(`Portable build is missing WebMCP tool: ${toolName}`);
  }
}
if (!portable.includes("showSaveFilePicker") || !portable.includes("createWritable")) {
  throw new Error("Portable build is missing direct-save support");
}
if (!portable.includes("PDFLib")) throw new Error("Portable build is missing PDF mutation runtime");
if (!portable.includes("ZipPassThrough")) throw new Error("Portable build is missing ZIP runtime");
if (!portable.includes("pdf-meta-title") || !portable.includes("replacePdfMetadata")) {
  throw new Error("Portable build is missing PDF metadata editor support");
}
if (!portable.includes("pdf-attachment-add") || !portable.includes("replacePdfAttachments")) {
  throw new Error("Portable build is missing PDF attachment editor support");
}
if (!portable.includes("__docbenchPdfAssets")) {
  throw new Error("Portable build is missing embedded PDF runtime assets");
}
const portableSize = (await stat("public/portable.html")).size;
if (portableSize >= 24 * 1024 * 1024) {
  throw new Error("Portable Doc Bench exceeds the Cloudflare per-asset safety margin.");
}
console.log(`Doc Bench static checks passed (${(portableSize / 1024 / 1024).toFixed(1)} MiB portable).`);
