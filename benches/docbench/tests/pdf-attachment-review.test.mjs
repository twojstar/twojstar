import assert from "node:assert/strict";
import * as PDFLib from "@cantoo/pdf-lib";
import {
  mergePdfAttachmentSets,
  mergePdfAttachmentSourceSets,
  normalizePdfAttachment,
  readPdfAttachments,
  replacePdfAttachments,
  verifyPdfAttachments,
} from "../public/pdf-core.mjs";

async function onePagePdf({ pdfa } = {}) {
  const document = await PDFLib.PDFDocument.create({ updateMetadata: false });
  document.addPage([100, 100]);
  if (pdfa) document.convertToPDFA({ conformance: pdfa });
  return document.save();
}

function firstAttachmentFileSpec(document) {
  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);
  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
  return entries.lookup(1, PDFLib.PDFDict);
}

function attachmentFileSpecByName(document, expectedName) {
  const names = document.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
  const embedded = names.lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict);
  const entries = embedded.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
  for (let index = 0; index + 1 < entries.size(); index += 2) {
    if (entries.lookup(index).decodeText() === expectedName) {
      return entries.lookup(index + 1, PDFLib.PDFDict);
    }
  }
  throw new Error(`Missing attachment FileSpec for ${expectedName}`);
}

assert.equal(
  normalizePdfAttachment({ name: "form.xml", afRelationship: "FormData" }).afRelationship,
  "FormData",
);

const formBase = await onePagePdf();
const formBytes = await replacePdfAttachments(formBase, [{
  name: "form.xml",
  data: new TextEncoder().encode("<form/>") ,
  mimeType: "application/xml",
  afRelationship: "FormData",
}], PDFLib);
const formAttachments = await readPdfAttachments(formBytes, PDFLib);
assert.equal(formAttachments[0].afRelationship, "FormData");

const datedBase = await onePagePdf();
const datedBytes = await replacePdfAttachments(datedBase, [{
  name: "dated.txt",
  data: new TextEncoder().encode("date"),
  mimeType: "text/plain",
  creationDate: "2020-01-02T03:04:05.000Z",
  modificationDate: "2021-02-03T04:05:06.000Z",
}], PDFLib);
const datedDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const datedSpec = firstAttachmentFileSpec(datedDocument);
const ef = datedSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const stream = ef.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
const params = stream.dict.lookup(PDFLib.PDFName.of("Params"), PDFLib.PDFDict);
params.set(
  PDFLib.PDFName.of("CreationDate"),
  PDFLib.PDFHexString.fromText("D:20200102030405Z"),
);
params.set(
  PDFLib.PDFName.of("ModDate"),
  PDFLib.PDFHexString.fromText("D:20210203040506Z"),
);
const hexDateBytes = await datedDocument.save({ updateFieldAppearances: false });
const hexDateAttachments = await readPdfAttachments(hexDateBytes, PDFLib);
assert.equal(hexDateAttachments[0].creationDate, "2020-01-02T03:04:05.000Z");
assert.equal(hexDateAttachments[0].modificationDate, "2021-02-03T04:05:06.000Z");

const pdfa2 = await onePagePdf({ pdfa: "2B" });
await assert.rejects(
  () => replacePdfAttachments(pdfa2, [{
    name: "payload.txt",
    data: new TextEncoder().encode("not a PDF/A file"),
    mimeType: "text/plain",
    afRelationship: "Data",
  }], PDFLib),
  /PDF\/A-2 permits only PDF\/A-1 or PDF\/A-2 attachments/,
);

const pdfa1Child = await onePagePdf({ pdfa: "1B" });
const compliantPdfa2 = await replacePdfAttachments(pdfa2, [{
  name: "archival-child.pdf",
  data: pdfa1Child,
  mimeType: "application/pdf",
  afRelationship: "Supplement",
}], PDFLib);
const compliantAttachments = await readPdfAttachments(compliantPdfa2, PDFLib);
assert.equal(compliantAttachments.length, 1);
assert.equal(compliantAttachments[0].name, "archival-child.pdf");

const spacedAttachment = mergePdfAttachmentSets([], [{
  name: " report.txt ",
  data: new TextEncoder().encode("spaces"),
  mimeType: "text/plain",
}]);
assert.equal(spacedAttachment[0].name, " report.txt ");
const spacedBytes = await replacePdfAttachments(await onePagePdf(), spacedAttachment, PDFLib);
const spacedRead = await readPdfAttachments(spacedBytes, PDFLib);
assert.equal(spacedRead[0].name, " report.txt ");

const collidingSortNames = [
  { name: "résumé.txt", data: new Uint8Array([1]), mimeType: "text/plain" },
  { name: "resume.txt", data: new Uint8Array([2]), mimeType: "text/plain" },
];
const collatingBytes = await replacePdfAttachments(await onePagePdf(), collidingSortNames, PDFLib);
await verifyPdfAttachments(collatingBytes, collidingSortNames, PDFLib);

const caseDistinctSources = mergePdfAttachmentSourceSets([
  [
    { name: "A.txt", data: new Uint8Array([10]), mimeType: "text/plain" },
    { name: "a.txt", data: new Uint8Array([11]), mimeType: "text/plain" },
  ],
  [
    { name: "A.txt", data: new Uint8Array([12]), mimeType: "text/plain" },
  ],
]);
assert.deepEqual(
  caseDistinctSources.map((attachment) => attachment.name),
  ["A.txt", "a.txt", "A (2).txt"],
);

const checksumDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const checksumSpec = firstAttachmentFileSpec(checksumDocument);
const checksumEf = checksumSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const checksumStream = checksumEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
const checksumParams = checksumStream.dict.lookup(PDFLib.PDFName.of("Params"), PDFLib.PDFDict);
const checksumValue = PDFLib.PDFHexString.of("00112233445566778899aabbccddeeff");
checksumParams.set(PDFLib.PDFName.of("CheckSum"), checksumValue);
const checksumBytes = await checksumDocument.save({ updateFieldAppearances: false });
const checksumAttachments = await readPdfAttachments(checksumBytes, PDFLib);
assert.deepEqual([...checksumAttachments[0].checksum], [...checksumValue.asBytes()]);
const rebuiltChecksumBytes = await replacePdfAttachments(checksumBytes, checksumAttachments, PDFLib);
const rebuiltChecksumAttachments = await readPdfAttachments(rebuiltChecksumBytes, PDFLib);
assert.deepEqual([...rebuiltChecksumAttachments[0].checksum], [...checksumValue.asBytes()]);
await verifyPdfAttachments(rebuiltChecksumBytes, checksumAttachments, PDFLib);

const undecodableDocument = await PDFLib.PDFDocument.load(datedBytes, { updateMetadata: false });
const undecodableSpec = firstAttachmentFileSpec(undecodableDocument);
const undecodableEf = undecodableSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const undecodableStream = undecodableEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFStream);
undecodableStream.dict.set(PDFLib.PDFName.of("Filter"), PDFLib.PDFName.of("UnsupportedDocbenchFilter"));
const undecodableBytes = await undecodableDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => readPdfAttachments(undecodableBytes, PDFLib),
  /Could not decode PDF attachment dated\.txt; refusing to rewrite attachments/,
);

const associatedDocument = await PDFLib.PDFDocument.load(formBytes, { updateMetadata: false });
const [{ specRef: oldSpecRef, fileSpec: oldFileSpec }] = associatedDocument.getRawAttachments();
const oldEf = oldFileSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const oldStreamRef = oldEf.get(PDFLib.PDFName.of("F"));
const associatedPage = associatedDocument.getPage(0);
associatedPage.node.set(PDFLib.PDFName.of("AF"), associatedDocument.context.obj([oldSpecRef]));
const annotation = associatedDocument.context.obj({
  Type: "Annot",
  Subtype: "FileAttachment",
  Rect: [0, 0, 10, 10],
  AF: [oldSpecRef],
  FS: oldSpecRef,
});
const annotationRef = associatedDocument.context.register(annotation);
associatedPage.node.set(PDFLib.PDFName.of("Annots"), associatedDocument.context.obj([annotationRef]));
const associatedBytes = await associatedDocument.save({ updateFieldAppearances: false });
const associatedAttachments = await readPdfAttachments(associatedBytes, PDFLib);
assert.equal(associatedAttachments.length, 1);
const retainedAssociatedBytes = await replacePdfAttachments(associatedBytes, associatedAttachments, PDFLib);
const retainedAssociatedDocument = await PDFLib.PDFDocument.load(retainedAssociatedBytes, { updateMetadata: false });
const retainedPage = retainedAssociatedDocument.getPage(0);
const retainedAnnots = retainedPage.node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const retainedAnnotation = retainedAnnots.lookup(0, PDFLib.PDFDict);
assert.equal(retainedAnnotation.has(PDFLib.PDFName.of("FS")), true);
assert.equal(retainedAnnotation.has(PDFLib.PDFName.of("AF")), true);

const fsOnlyDocument = await PDFLib.PDFDocument.load(associatedBytes, { updateMetadata: false });
const fsOnlyNames = fsOnlyDocument.catalog.lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict);
fsOnlyNames.delete(PDFLib.PDFName.of("EmbeddedFiles"));
fsOnlyDocument.catalog.delete(PDFLib.PDFName.of("AF"));
const fsOnlyBytes = await fsOnlyDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(fsOnlyBytes, PDFLib)).length, 1, "FS-only attachment should be read");

const removedAssociatedBytes = await replacePdfAttachments(associatedBytes, [], PDFLib);
assert.equal((await readPdfAttachments(removedAssociatedBytes, PDFLib)).length, 0);
const removedAssociatedDocument = await PDFLib.PDFDocument.load(removedAssociatedBytes, { updateMetadata: false });
const removedPage = removedAssociatedDocument.getPage(0);
assert.equal(removedPage.node.has(PDFLib.PDFName.of("AF")), false);
const removedAnnots = removedPage.node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const removedAnnotation = removedAnnots.lookup(0, PDFLib.PDFDict);
assert.equal(removedAnnotation.has(PDFLib.PDFName.of("AF")), false);
assert.equal(removedAnnotation.has(PDFLib.PDFName.of("FS")), false);
assert.equal(removedAssociatedDocument.context.lookup(oldSpecRef), undefined);
assert.equal(removedAssociatedDocument.context.lookup(oldStreamRef), undefined);


const collisionBase = await PDFLib.PDFDocument.create({ updateMetadata: false });
collisionBase.addPage([100, 100]);
collisionBase.addPage([100, 100]);
let collisionBytes = await collisionBase.save();
collisionBytes = await replacePdfAttachments(collisionBytes, [
  { name: "dup.txt", data: new Uint8Array([21]), mimeType: "text/plain" },
  { name: "other.txt", data: new Uint8Array([22]), mimeType: "text/plain" },
], PDFLib);
const collisionDocument = await PDFLib.PDFDocument.load(collisionBytes, { updateMetadata: false });
const collisionRaw = collisionDocument.getRawAttachments();
const collisionNames = collisionDocument.catalog
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
for (let index = 0; index < 2; index += 1) {
  collisionNames.set(index * 2, PDFLib.PDFHexString.fromText("dup.txt"));
  collisionRaw[index].fileSpec.set(PDFLib.PDFName.of("F"), PDFLib.PDFString.of("dup.txt"));
  collisionRaw[index].fileSpec.set(PDFLib.PDFName.of("UF"), PDFLib.PDFHexString.fromText("dup.txt"));
  collisionDocument.getPage(index).node.set(
    PDFLib.PDFName.of("AF"),
    collisionDocument.context.obj([collisionRaw[index].specRef]),
  );
}
const duplicateNameBytes = await collisionDocument.save({ updateFieldAppearances: false });
const duplicateAttachments = await readPdfAttachments(duplicateNameBytes, PDFLib);
assert.deepEqual(duplicateAttachments.map((attachment) => attachment.name), ["dup.txt", "dup.txt"]);
const collisionDesired = mergePdfAttachmentSourceSets(
  duplicateAttachments.map((attachment) => [attachment]),
);
assert.deepEqual(collisionDesired.map((attachment) => attachment.name), ["dup.txt", "dup (2).txt"]);
const remappedCollisionBytes = await replacePdfAttachments(duplicateNameBytes, collisionDesired, PDFLib);
const remappedCollisionDocument = await PDFLib.PDFDocument.load(remappedCollisionBytes, { updateMetadata: false });
const pageAssociationNames = remappedCollisionDocument.getPages().map((page) => {
  const af = page.node.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
  const spec = af.lookup(0, PDFLib.PDFDict);
  return spec.lookup(PDFLib.PDFName.of("UF")).decodeText();
});
assert.deepEqual(pageAssociationNames, ["dup.txt", "dup (2).txt"]);


const caseDistinctBase = await onePagePdf();
const caseDistinctBytes = await replacePdfAttachments(caseDistinctBase, [
  { name: "A.txt", data: new Uint8Array([31]), mimeType: "text/plain" },
  { name: "a.txt", data: new Uint8Array([32]), mimeType: "text/plain" },
], PDFLib);
assert.deepEqual((await readPdfAttachments(caseDistinctBytes, PDFLib)).map((item) => item.name).sort(), ["A.txt", "a.txt"]);

const pdfa2aDocument = await PDFLib.PDFDocument.load(await onePagePdf({ pdfa: "2B" }), { updateMetadata: false });
const metadataKey = PDFLib.PDFName.of("Metadata");
const metadataStream = pdfa2aDocument.catalog.lookup(metadataKey, PDFLib.PDFRawStream);
const metadataXml = new TextDecoder().decode(PDFLib.decodePDFRawStream(metadataStream).decode());
const levelAXml = metadataXml.replace(/(<[^:>]+:conformance\b[^>]*>\s*)B(\s*<\/[^:>]+:conformance\s*>)/i, "$1A$2");
assert.notEqual(levelAXml, metadataXml, "PDF/A fixture should expose a conformance element");
const levelAStream = pdfa2aDocument.context.stream(new TextEncoder().encode(levelAXml), { Type: "Metadata", Subtype: "XML" });
pdfa2aDocument.catalog.set(metadataKey, pdfa2aDocument.context.register(levelAStream));
const pdfa2aBytes = await pdfa2aDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => replacePdfAttachments(pdfa2aBytes, [{ name: "payload.txt", data: new Uint8Array([1]), mimeType: "text/plain" }], PDFLib),
  /PDF\/A-2 permits only PDF\/A-1 or PDF\/A-2 attachments/,
);

const richBase = await replacePdfAttachments(await onePagePdf(), [
  { name: "rich.bin", data: new Uint8Array([40, 41]), mimeType: "application/octet-stream" },
  { name: "plain.bin", data: new Uint8Array([50]), mimeType: "application/octet-stream" },
], PDFLib);
const richDocument = await PDFLib.PDFDocument.load(richBase, { updateMetadata: false });
const richRaw = richDocument.getRawAttachments();
const richRawEntry = richRaw.find(({ fileName }) => fileName.decodeText() === "rich.bin");
assert.ok(richRawEntry, "rich.bin raw attachment should exist");
const richSpec = attachmentFileSpecByName(richDocument, "rich.bin");
const richEf = richSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
const originalUf = richEf.get(PDFLib.PDFName.of("UF")) || richEf.get(PDFLib.PDFName.of("F"));
const alternateStream = richDocument.context.flateStream(new Uint8Array([90, 91, 92]), { Type: "EmbeddedFile" });
richEf.set(PDFLib.PDFName.of("F"), richDocument.context.register(alternateStream));
richEf.set(PDFLib.PDFName.of("UF"), originalUf);
richSpec.set(PDFLib.PDFName.of("CI"), richDocument.context.obj({ Department: PDFLib.PDFHexString.fromText("Legal"), Rank: 7 }));
richDocument.catalog.set(PDFLib.PDFName.of("AF"), richDocument.context.obj([richRawEntry.specRef]));
const structElem = richDocument.context.obj({ Type: "StructElem", S: "P", AF: [richRawEntry.specRef] });
richDocument.catalog.set(PDFLib.PDFName.of("StructTreeRoot"), richDocument.context.obj({ Type: "StructTreeRoot", K: [structElem] }));
const richSourceBytes = await richDocument.save({ updateFieldAppearances: false });
const richSourceCheck = await PDFLib.PDFDocument.load(richSourceBytes, { updateMetadata: false });
const richSourceSpec = attachmentFileSpecByName(richSourceCheck, "rich.bin");
const richSourceEf = richSourceSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
assert.equal(richSourceEf.has(PDFLib.PDFName.of("F")), true, "fixture should contain /EF/F");
assert.equal(richSourceEf.has(PDFLib.PDFName.of("UF")), true, "fixture should contain /EF/UF");
assert.deepEqual([...PDFLib.decodePDFRawStream(richSourceEf.lookup(PDFLib.PDFName.of("UF"), PDFLib.PDFRawStream)).decode()], [40, 41]);
const richAttachments = await readPdfAttachments(richSourceBytes, PDFLib);
const richRoundTrip = await replacePdfAttachments(richSourceBytes, richAttachments, PDFLib);
const richOutput = await PDFLib.PDFDocument.load(richRoundTrip, { updateMetadata: false });
const richOutputSpec = attachmentFileSpecByName(richOutput, "rich.bin");
const outputEf = richOutputSpec.lookup(PDFLib.PDFName.of("EF"), PDFLib.PDFDict);
assert.equal(outputEf.has(PDFLib.PDFName.of("F")), true);
assert.equal(outputEf.has(PDFLib.PDFName.of("UF")), true);
assert.deepEqual([...PDFLib.decodePDFRawStream(outputEf.lookup(PDFLib.PDFName.of("F"), PDFLib.PDFRawStream)).decode()], [90, 91, 92]);
assert.deepEqual([...PDFLib.decodePDFRawStream(outputEf.lookup(PDFLib.PDFName.of("UF"), PDFLib.PDFRawStream)).decode()], [40, 41]);
const outputCi = richOutputSpec.lookup(PDFLib.PDFName.of("CI"), PDFLib.PDFDict);
assert.equal(outputCi.lookup(PDFLib.PDFName.of("Department")).decodeText(), "Legal");
assert.equal(outputCi.lookup(PDFLib.PDFName.of("Rank"), PDFLib.PDFNumber).asNumber(), 7);
const outputCatalogAf = richOutput.catalog.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
assert.equal(outputCatalogAf.size(), 1, "catalog /AF subset should stay a subset");
const outputStruct = richOutput.catalog.lookup(PDFLib.PDFName.of("StructTreeRoot"), PDFLib.PDFDict);
const outputStructKids = outputStruct.lookup(PDFLib.PDFName.of("K"), PDFLib.PDFArray);
const outputStructElem = outputStructKids.lookup(0, PDFLib.PDFDict);
const outputStructAf = outputStructElem.lookup(PDFLib.PDFName.of("AF"), PDFLib.PDFArray);
assert.equal(outputStructAf.size(), 1, "structure-element /AF should be rebound");

const oversizedTreeDocument = await PDFLib.PDFDocument.create({ updateMetadata: false });
oversizedTreeDocument.addPage([100, 100]);
const oversizedKids = oversizedTreeDocument.context.obj([]);
for (let index = 0; index < 10000; index += 1) {
  oversizedKids.push(oversizedTreeDocument.context.obj({}));
}
const oversizedEmbedded = oversizedTreeDocument.context.obj({ Kids: oversizedKids });
const oversizedNames = oversizedTreeDocument.context.obj({ EmbeddedFiles: oversizedEmbedded });
oversizedTreeDocument.catalog.set(PDFLib.PDFName.of("Names"), oversizedNames);
const oversizedTreeBytes = await oversizedTreeDocument.save({ updateFieldAppearances: false });
await assert.rejects(
  () => readPdfAttachments(oversizedTreeBytes, PDFLib),
  /PDF attachment name tree is too large/,
);


const aliasBase = await replacePdfAttachments(await onePagePdf(), [{
  name: "canonical.bin",
  data: new Uint8Array([71, 72]),
  mimeType: "application/octet-stream",
}], PDFLib);
const aliasDocument = await PDFLib.PDFDocument.load(aliasBase, { updateMetadata: false });
const aliasRaw = aliasDocument.getRawAttachments()[0];
const aliasNames = aliasDocument.catalog
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("EmbeddedFiles"), PDFLib.PDFDict)
  .lookup(PDFLib.PDFName.of("Names"), PDFLib.PDFArray);
aliasNames.set(0, PDFLib.PDFHexString.fromText("alias-one.bin"));
aliasNames.push(PDFLib.PDFHexString.fromText("alias-two.bin"));
aliasNames.push(aliasRaw.specRef);
const aliasBytes = await aliasDocument.save({ updateFieldAppearances: false });
const aliasAttachments = await readPdfAttachments(aliasBytes, PDFLib);
assert.deepEqual(aliasAttachments.map((attachment) => attachment.name), ["alias-one.bin", "alias-two.bin"]);
const aliasRoundTrip = await replacePdfAttachments(aliasBytes, aliasAttachments, PDFLib);
assert.deepEqual(
  (await readPdfAttachments(aliasRoundTrip, PDFLib)).map((attachment) => attachment.name),
  ["alias-one.bin", "alias-two.bin"],
);

const filenamesBase = await replacePdfAttachments(await onePagePdf(), [{
  name: "tree-name.bin",
  data: new Uint8Array([81, 82]),
  mimeType: "application/octet-stream",
}], PDFLib);
const filenamesDocument = await PDFLib.PDFDocument.load(filenamesBase, { updateMetadata: false });
const filenamesSpec = attachmentFileSpecByName(filenamesDocument, "tree-name.bin");
filenamesSpec.set(PDFLib.PDFName.of("F"), PDFLib.PDFString.of("platform-name.bin"));
filenamesSpec.set(PDFLib.PDFName.of("UF"), PDFLib.PDFHexString.fromText("unicode-name.bin"));
const filenamesBytes = await filenamesDocument.save({ updateFieldAppearances: false });
const filenamesAttachments = await readPdfAttachments(filenamesBytes, PDFLib);
assert.equal(filenamesAttachments[0].name, "tree-name.bin");
const filenamesRoundTrip = await replacePdfAttachments(filenamesBytes, filenamesAttachments, PDFLib);
const filenamesOutput = await PDFLib.PDFDocument.load(filenamesRoundTrip, { updateMetadata: false });
const filenamesOutputSpec = attachmentFileSpecByName(filenamesOutput, "tree-name.bin");
assert.equal(filenamesOutputSpec.lookup(PDFLib.PDFName.of("F")).decodeText(), "platform-name.bin");
assert.equal(filenamesOutputSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "unicode-name.bin");


const externalDocument = await PDFLib.PDFDocument.load(await onePagePdf(), { updateMetadata: false });
const externalSpecRef = externalDocument.context.register(externalDocument.context.obj({
  Type: "Filespec",
  F: PDFLib.PDFString.of("manual.txt"),
  UF: PDFLib.PDFHexString.fromText("manual.txt"),
}));
const externalAnnotationRef = externalDocument.context.register(externalDocument.context.obj({
  Type: "Annot",
  Subtype: "FileAttachment",
  Rect: [0, 0, 10, 10],
  FS: externalSpecRef,
}));
externalDocument.getPage(0).node.set(
  PDFLib.PDFName.of("Annots"),
  externalDocument.context.obj([externalAnnotationRef]),
);
const externalBytes = await externalDocument.save({ updateFieldAppearances: false });
assert.equal((await readPdfAttachments(externalBytes, PDFLib)).length, 0);
const externalRoundTrip = await replacePdfAttachments(externalBytes, [], PDFLib);
const externalOutput = await PDFLib.PDFDocument.load(externalRoundTrip, { updateMetadata: false });
const externalAnnots = externalOutput.getPage(0).node.lookup(PDFLib.PDFName.of("Annots"), PDFLib.PDFArray);
const externalAnnotation = externalAnnots.lookup(0, PDFLib.PDFDict);
const externalSpec = externalAnnotation.lookup(PDFLib.PDFName.of("FS"), PDFLib.PDFDict);
assert.equal(externalSpec.lookup(PDFLib.PDFName.of("UF")).decodeText(), "manual.txt");

console.log("Doc Bench PDF attachment review tests passed.");
