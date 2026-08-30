import assert from "node:assert/strict";
import * as PDFLib from "@cantoo/pdf-lib";
import {
  buildCombinedOutline,
  buildQpdfFinalizeRequest,
  buildQpdfPageRequest,
  clonePdfOutline,
  mergePdfAttachmentSets,
  readPdfAttachments,
  readPdfMetadata,
  readPdfOutline,
  replacePdfAttachments,
  replacePdfMetadata,
  verifyPdfAttachments,
  verifyPdfMetadata,
  remapOutline,
  remapOutlineToPagePlan,
  replacePdfOutline,
} from "../public/pdf-core.mjs";

const fakePdfJs = {
  async getOutline() {
    return [
      {
        title: "Rozdział 1",
        dest: "chapter-1",
        color: new Uint8ClampedArray([12, 34, 56]),
        bold: true,
        italic: false,
        count: 1,
        items: [
          {
            title: "Nested",
            dest: [{ num: 7, gen: 0 }, { name: "XYZ" }, 10, 20, 1.25],
            items: [],
          },
        ],
      },
      { title: "Website", url: "https://example.com/", newWindow: true, items: [] },
    ];
  },
  async getDestination(name) {
    assert.equal(name, "chapter-1");
    return [{ num: 3, gen: 0 }, { name: "FitH" }, 700];
  },
  async getPageIndex(ref) {
    return ref.num === 3 ? 0 : 2;
  },
};

const read = await readPdfOutline(fakePdfJs);
assert.equal(read[0].title, "Rozdział 1");
assert.equal(read[0].target.pageIndex, 0);
assert.equal(read[0].target.view.type, "FitH");
assert.equal(read[0].children[0].target.pageIndex, 2);
assert.equal(read[1].target.kind, "url");

const cloned = clonePdfOutline(read);
cloned[0].title = "Edited";
assert.equal(read[0].title, "Rozdział 1");

const remapped = remapOutline(read, (pageIndex) => ({ 0: 2, 2: null })[pageIndex]);
assert.equal(remapped.outline[0].target.pageIndex, 2);
assert.equal(remapped.outline[0].children.length, 0);
assert.equal(remapped.dropped, 1);

const oldPlan = [
  { sourceId: 0, pageIndex: 0 },
  { sourceId: 0, pageIndex: 1 },
  { sourceId: 0, pageIndex: 2 },
];
const reorderedPlan = [oldPlan[2], oldPlan[0], oldPlan[1]];
const editedOutline = [{
  title: "My edited title",
  target: { kind: "page", pageIndex: 0, view: { type: "Fit", args: [] } },
  children: [{
    title: "Deleted target",
    target: { kind: "page", pageIndex: 1, view: { type: "Fit", args: [] } },
    children: [],
  }],
}];
const reorderedOutline = remapOutlineToPagePlan(editedOutline, oldPlan, reorderedPlan);
assert.equal(reorderedOutline.outline[0].title, "My edited title");
assert.equal(reorderedOutline.outline[0].target.pageIndex, 1);
assert.equal(reorderedOutline.outline[0].children[0].target.pageIndex, 2);

const deletedPlan = [oldPlan[2], oldPlan[0]];
const afterDelete = remapOutlineToPagePlan(reorderedOutline.outline, reorderedPlan, deletedPlan);
assert.equal(afterDelete.outline[0].target.pageIndex, 1);
assert.equal(afterDelete.outline[0].children.length, 0);
assert.equal(afterDelete.dropped, 1);

const sources = [
  { filename: "one.pdf", outline: read, bytes: new Uint8Array([1]) },
  {
    filename: "two.pdf",
    outline: [{
      title: "Second",
      target: { kind: "page", pageIndex: 0, view: { type: "Fit", args: [] } },
      children: [],
    }],
    bytes: new Uint8Array([2]),
  },
];
const plan = [
  { sourceId: 1, pageIndex: 0 },
  { sourceId: 0, pageIndex: 2 },
  { sourceId: 0, pageIndex: 0 },
];
const combined = buildCombinedOutline(sources, plan);
assert.deepEqual(combined.outline.map((item) => item.title), ["one.pdf", "two.pdf"]);
assert.equal(combined.outline[0].target.pageIndex, 1);
assert.equal(combined.outline[1].target.pageIndex, 0);

const qpdfRequest = buildQpdfPageRequest(sources, plan);
assert.deepEqual(qpdfRequest.args, [
  "source-0.pdf",
  "--pages",
  "source-1.pdf",
  "1",
  "source-0.pdf",
  "3",
  "source-0.pdf",
  "1",
  "--",
  "output.pdf",
]);
assert.equal(qpdfRequest.inputs["source-1.pdf"][0], 2);

const finalizeRequest = buildQpdfFinalizeRequest(
  new Uint8Array([4, 5, 6]),
  { optimize: true, linearize: true },
);
assert.deepEqual(finalizeRequest.args, [
  "input.pdf",
  "--object-streams=generate",
  "--recompress-flate",
  "--compression-level=9",
  "--linearize",
  "output.pdf",
]);
assert.deepEqual([...finalizeRequest.inputs["input.pdf"]], [4, 5, 6]);

const lossyRequest = buildQpdfFinalizeRequest(
  new Uint8Array([7, 8]),
  { lossyImages: true, jpegQuality: 60 },
);
assert.deepEqual(lossyRequest.args, [
  "input.pdf",
  "--optimize-images",
  "--jpeg-quality=60",
  "output.pdf",
]);

const clampedLossyRequest = buildQpdfFinalizeRequest(
  new Uint8Array([9]),
  { lossyImages: true, jpegQuality: 999 },
);
assert.ok(clampedLossyRequest.args.includes("--jpeg-quality=100"));

const metadataDocument = await PDFLib.PDFDocument.create();
metadataDocument.addPage([100, 100]);
metadataDocument.setTitle("Original");
metadataDocument.setAuthor("Żółw");
metadataDocument.setSubject("Metadata test");
metadataDocument.setKeywords(["alpha, beta"]);
metadataDocument.setCreator("Doc Bench test");
metadataDocument.setProducer("Original producer");
metadataDocument.setCreationDate(new Date("2020-01-02T03:04:05Z"));
metadataDocument.setModificationDate(new Date("2021-02-03T04:05:06Z"));
const metadataBytes = await metadataDocument.save();
const originalMetadata = await readPdfMetadata(metadataBytes, PDFLib);
assert.equal(originalMetadata.title, "Original");
assert.equal(originalMetadata.author, "Żółw");
assert.equal(originalMetadata.keywords, "alpha, beta");
assert.equal(originalMetadata.creationDate, "2020-01-02T03:04:05.000Z");
assert.equal(originalMetadata.modificationDate, "2021-02-03T04:05:06.000Z");

const editedMetadataBytes = await replacePdfMetadata(metadataBytes, {
  title: "Edited",
  keywords: "one, two; three",
  creationDate: "2022-03-04T05:06:07.000Z",
  modificationDate: "",
}, PDFLib);
const editedMetadata = await readPdfMetadata(editedMetadataBytes, PDFLib);
assert.equal(editedMetadata.title, "Edited");
assert.equal(editedMetadata.author, "Żółw");
assert.equal(editedMetadata.subject, "Metadata test");
assert.equal(editedMetadata.keywords, "one, two; three");
assert.equal(editedMetadata.creator, "Doc Bench test");
assert.equal(editedMetadata.producer, "Original producer");
assert.equal(editedMetadata.creationDate, "2022-03-04T05:06:07.000Z");
assert.equal(editedMetadata.modificationDate, "");

async function readTestXmp(bytes) {
  const loaded = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const stream = loaded.catalog.lookup(PDFLib.PDFName.of("Metadata"));
  if (!(stream instanceof PDFLib.PDFRawStream)) return "";
  return new TextDecoder().decode(PDFLib.decodePDFRawStream(stream).decode());
}

const pdfaDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });
pdfaDocument.addPage([100, 100]);
pdfaDocument.setTitle("Old PDF/A title");
pdfaDocument.setAuthor("Old PDF/A author");
pdfaDocument.convertToPDFA({
  conformance: "3B",
  extensions: [
    '<rdf:Description rdf:about="" xmlns:docbench="urn:docbench:test"><docbench:Keep>yes</docbench:Keep></rdf:Description>',
  ],
});
const pdfaBytes = await pdfaDocument.save();
const pdfaChanges = { title: "Synced PDF/A title", author: "Synced author" };
const editedPdfaBytes = await replacePdfMetadata(pdfaBytes, pdfaChanges, PDFLib);
const editedPdfaMetadata = await readPdfMetadata(editedPdfaBytes, PDFLib);
await verifyPdfMetadata(editedPdfaBytes, editedPdfaMetadata, pdfaChanges, PDFLib);
const editedPdfaXmp = await readTestXmp(editedPdfaBytes);
assert.ok(editedPdfaXmp.includes("Synced PDF/A title"));
assert.ok(editedPdfaXmp.includes("Synced author"));
assert.ok(!editedPdfaXmp.includes("Old PDF/A title"));
assert.ok(editedPdfaXmp.includes("docbench:Keep"));

const genericXmpDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });
genericXmpDocument.addPage([100, 100]);
genericXmpDocument.setTitle("Old generic title");
const genericXmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:docbench="urn:docbench:test">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old generic title</rdf:li></rdf:Alt></dc:title>
<docbench:Keep>yes</docbench:Keep>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const genericStream = genericXmpDocument.context.stream(new TextEncoder().encode(genericXmp), {
  Type: "Metadata",
  Subtype: "XML",
});
genericXmpDocument.catalog.set(
  PDFLib.PDFName.of("Metadata"),
  genericXmpDocument.context.register(genericStream),
);
const genericXmpBytes = await genericXmpDocument.save();
const genericChanges = { title: "New generic title" };
const editedGenericBytes = await replacePdfMetadata(genericXmpBytes, genericChanges, PDFLib);
const editedGenericMetadata = await readPdfMetadata(editedGenericBytes, PDFLib);
await verifyPdfMetadata(editedGenericBytes, editedGenericMetadata, genericChanges, PDFLib);
const editedGenericXmp = await readTestXmp(editedGenericBytes);
assert.ok(!editedGenericXmp.includes("Old generic title"));
assert.ok(!editedGenericXmp.includes("<dc:title"));
assert.ok(editedGenericXmp.includes("docbench:Keep"));

function encodeUtf16Le(text) {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff; bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes[2 + index * 2] = unit & 0xff;
    bytes[3 + index * 2] = unit >>> 8;
  }
  return bytes;
}

function encodeUtf32Be(text) {
  const points = [...text].map((char) => char.codePointAt(0));
  const bytes = new Uint8Array(4 + points.length * 4);
  bytes.set([0x00, 0x00, 0xfe, 0xff]);
  points.forEach((point, index) => {
    const offset = 4 + index * 4;
    bytes[offset] = point >>> 24;
    bytes[offset + 1] = point >>> 16;
    bytes[offset + 2] = point >>> 8;
    bytes[offset + 3] = point;
  });
  return bytes;
}

async function withXmpPacket(xmlBytes, title) {
  const pdf = await PDFLib.PDFDocument.create({ updateMetadata: false });
  pdf.addPage([100, 100]);
  pdf.setTitle(title);
  const stream = pdf.context.stream(xmlBytes, { Type: "Metadata", Subtype: "XML" });
  pdf.catalog.set(PDFLib.PDFName.of("Metadata"), pdf.context.register(stream));
  return pdf.save();
}

const encodedGenericXml = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:keep="urn:keep"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old encoded title</rdf:li></rdf:Alt></dc:title><keep:Value>yes</keep:Value></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
for (const encoded of [encodeUtf16Le(encodedGenericXml), encodeUtf32Be(encodedGenericXml)]) {
  const source = await withXmpPacket(encoded, "Old encoded title");
  const edited = await replacePdfMetadata(source, { title: "New encoded title" }, PDFLib);
  const metadata = await readPdfMetadata(edited, PDFLib);
  await verifyPdfMetadata(edited, metadata, { title: "New encoded title" }, PDFLib);
  const xmp = await readTestXmp(edited);
  assert.ok(!xmp.includes("Old encoded title"));
  assert.ok(xmp.includes("keep:Value"));
}

const mixedPdfaXml = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:keep="urn:keep" keep:flag="yes"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old mixed title</rdf:li></rdf:Alt></dc:title><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance><keep:Value>preserve me</keep:Value></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const mixedSource = await withXmpPacket(new TextEncoder().encode(mixedPdfaXml), "Old mixed title");
const mixedEdited = await replacePdfMetadata(mixedSource, { title: "New mixed title" }, PDFLib);
const mixedMetadata = await readPdfMetadata(mixedEdited, PDFLib);
await verifyPdfMetadata(mixedEdited, mixedMetadata, { title: "New mixed title" }, PDFLib);
const mixedXmp = await readTestXmp(mixedEdited);
assert.ok(mixedXmp.includes("keep:Value"));
assert.ok(mixedXmp.includes('keep:flag="yes"'));
assert.ok(!mixedXmp.includes("Old mixed title"));

const attachmentDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });
attachmentDocument.addPage([100, 100]);
await attachmentDocument.attach(new TextEncoder().encode("hello attachment"), "note.txt", {
  mimeType: "text/plain",
  description: "Doc Bench attachment test",
  creationDate: new Date("2023-01-02T03:04:05Z"),
  modificationDate: new Date("2024-02-03T04:05:06Z"),
  afRelationship: PDFLib.AFRelationship.Data,
});
const attachmentBytes = await attachmentDocument.save();
const attachments = await readPdfAttachments(attachmentBytes, PDFLib);
assert.equal(attachments.length, 1);
assert.equal(attachments[0].name, "note.txt");
assert.equal(new TextDecoder().decode(attachments[0].data), "hello attachment");
assert.equal(attachments[0].mimeType, "text/plain");
assert.equal(attachments[0].afRelationship, "Data");
assert.equal(attachments[0].description, "Doc Bench attachment test");
assert.equal(attachments[0].creationDate, "2023-01-02T03:04:05.000Z");
assert.equal(attachments[0].modificationDate, "2024-02-03T04:05:06.000Z");

const nestedDocument = await PDFLib.PDFDocument.load(attachmentBytes, { updateMetadata: false });
const nestedNames = nestedDocument.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
const nestedEmbedded = nestedNames.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);
const nestedArray = nestedEmbedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
const nestedChild = nestedDocument.context.obj({ Names: nestedArray });
nestedEmbedded.delete(PDFLib.PDFName.of("Names"));
nestedEmbedded.set(
  PDFLib.PDFName.of("Kids"),
  nestedDocument.context.obj([nestedDocument.context.register(nestedChild)]),
);
const nestedBytes = await nestedDocument.save({ addDefaultPage: false, updateFieldAppearances: false });
const nestedAttachments = await readPdfAttachments(nestedBytes, PDFLib);
assert.equal(nestedAttachments.length, 1, "nested attachment name tree should be read");
assert.equal(nestedAttachments[0].name, "note.txt");

const afOnlyDocument = await PDFLib.PDFDocument.load(attachmentBytes, { updateMetadata: false });
const afNames = afOnlyDocument.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
afNames.delete(PDFLib.PDFName.of("EmbeddedFiles"));
const afOnlyBytes = await afOnlyDocument.save({ addDefaultPage: false, updateFieldAppearances: false });
const afOnlyAttachments = await readPdfAttachments(afOnlyBytes, PDFLib);
assert.equal(afOnlyAttachments.length, 1, "AF-only attachment should be read");

const unsupportedRelationshipBytes = await replacePdfAttachments(nestedBytes, [{ ...nestedAttachments[0], afRelationship: "FormData" }], PDFLib);
const unsupportedRelationship = await readPdfAttachments(unsupportedRelationshipBytes, PDFLib);
assert.equal(unsupportedRelationship[0].afRelationship, "FormData");

const mergedAttachments = mergePdfAttachmentSets(nestedAttachments, [{
  name: "NOTE.TXT",
  data: new Uint8Array([1, 2, 3]),
  mimeType: "application/octet-stream",
  afRelationship: "Unspecified",
}]);
assert.deepEqual(mergedAttachments.map((attachment) => attachment.name), ["note.txt", "NOTE (2).TXT"]);
const replacedAttachmentBytes = await replacePdfAttachments(nestedBytes, mergedAttachments, PDFLib);
await verifyPdfAttachments(replacedAttachmentBytes, mergedAttachments, PDFLib);
const replacedAttachments = await readPdfAttachments(replacedAttachmentBytes, PDFLib);
assert.equal(replacedAttachments.length, 2);
assert.deepEqual(
  replacedAttachments.map((attachment) => attachment.name).sort(),
  ["NOTE (2).TXT", "note.txt"],
);

const document = await PDFLib.PDFDocument.create();
document.addPage([300, 400]);
document.addPage([300, 400]);
document.addPage([300, 400]);
const originalBytes = await document.save();
const outline = [
  {
    title: "Zażółć gęślą jaźń",
    target: { kind: "page", pageIndex: 1, view: { type: "XYZ", args: [10, 20, 1] } },
    color: [255, 10, 20],
    bold: true,
    italic: true,
    open: true,
    children: [
      {
        title: "Child",
        target: { kind: "page", pageIndex: 2, view: { type: "Fit", args: [] } },
        children: [],
      },
    ],
  },
  {
    title: "External",
    target: { kind: "url", url: "https://example.com/", newWindow: true },
    children: [],
  },
];
const outlinedBytes = await replacePdfOutline(originalBytes, outline, PDFLib);
const reloaded = await PDFLib.PDFDocument.load(outlinedBytes, { updateMetadata: false });
const rootRef = reloaded.catalog.get(PDFLib.PDFName.of("Outlines"));
assert.ok(rootRef, "outline root should be present");
const root = reloaded.context.lookup(rootRef, PDFLib.PDFDict);
assert.equal(root.lookup(PDFLib.PDFName.of("Count"), PDFLib.PDFNumber).asNumber(), 3);
assert.ok(root.get(PDFLib.PDFName.of("First")));
assert.ok(root.get(PDFLib.PDFName.of("Last")));

console.log("Doc Bench PDF core tests passed.");
