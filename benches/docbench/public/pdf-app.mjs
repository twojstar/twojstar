import {
  buildCombinedOutline,
  buildQpdfFinalizeRequest,
  buildQpdfPageRequest,
  clonePdfOutline,
  formatPdfSize,
  mergePdfAttachmentSets,
  mergePdfAttachmentSourceSets,
  readPdfAttachments,
  readPdfMetadata,
  readPdfOutline,
  remapOutlineToPagePlan,
  replacePdfAttachments,
  replacePdfMetadata,
  verifyPdfAttachments,
  verifyPdfMetadata,
  replacePdfOutline,
} from "./pdf-core.mjs";

const $ = (selector) => document.querySelector(selector);
const pdfInput = $("#pdf-input");
const addPdfInput = $("#pdf-add-input");
const pagesHost = $("#pdf-pages");
const outlineHost = $("#pdf-outline");
const previewCanvas = $("#pdf-preview-canvas");
const pdfStatus = $("#pdf-status");
const pdfFilename = $("#pdf-filename");
const saveButton = $("#pdf-save-button");
const extractButton = $("#pdf-extract-page");
const splitButton = $("#pdf-split-all");
const removeButton = $("#pdf-remove-page");
const leftButton = $("#pdf-move-left");
const rightButton = $("#pdf-move-right");
const optimizeToggle = $("#pdf-optimize");
const lossyImagesToggle = $("#pdf-lossy-images");
const imageQuality = $("#pdf-image-quality");
const imageQualityRow = $("#pdf-image-quality-row");
const imageQualityValue = $("#pdf-image-quality-value");
const linearizeToggle = $("#pdf-linearize");
const metadataFieldset = $("#pdf-metadata-fields");
const metadataState = $("#pdf-metadata-state");
const metadataReset = $("#pdf-metadata-reset");
const metadataBindings = [
  { key: "title", input: $("#pdf-meta-title") },
  { key: "author", input: $("#pdf-meta-author") },
  { key: "subject", input: $("#pdf-meta-subject") },
  { key: "keywords", input: $("#pdf-meta-keywords") },
  { key: "creator", input: $("#pdf-meta-creator") },
  { key: "producer", input: $("#pdf-meta-producer") },
  { key: "creationDate", input: $("#pdf-meta-created"), date: true },
  { key: "modificationDate", input: $("#pdf-meta-modified"), date: true },
];
const attachmentInput = $("#pdf-attachment-input");
const attachmentsHost = $("#pdf-attachments");
const attachmentsState = $("#pdf-attachments-state");
const attachmentAdd = $("#pdf-attachment-add");
const bookmarkEditor = $("#bookmark-editor");
const bookmarkTitle = $("#bookmark-title");
const bookmarkTargetType = $("#bookmark-target-type");
const bookmarkPage = $("#bookmark-page");
const bookmarkPageRow = $("#bookmark-page-row");
const bookmarkUrl = $("#bookmark-url");
const bookmarkUrlRow = $("#bookmark-url-row");
const bookmarkNamed = $("#bookmark-named");
const bookmarkNamedRow = $("#bookmark-named-row");
const bookmarkBold = $("#bookmark-bold");
const bookmarkItalic = $("#bookmark-italic");
const bookmarkOpen = $("#bookmark-open");
const bookmarkAddRoot = $("#bookmark-add-root");
const bookmarkAddSibling = $("#bookmark-add-sibling");
const bookmarkAddChild = $("#bookmark-add-child");
const bookmarkUp = $("#bookmark-up");
const bookmarkDown = $("#bookmark-down");
const bookmarkIndent = $("#bookmark-indent");
const bookmarkOutdent = $("#bookmark-outdent");
const bookmarkDelete = $("#bookmark-delete");

const state = {
  sources: [],
  plan: [],
  outline: [],
  metadata: null,
  metadataOriginal: null,
  attachments: [],
  selectedIndex: -1,
  selectedBookmarkPath: null,
  droppedBookmarks: 0,
  pdfjs: null,
  qpdfModule: null,
  qpdfRunner: null,
  renderToken: 0,
  exporting: false,
};

const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbnailObserver.unobserve(entry.target);
    const index = Number(entry.target.dataset.pageIndex);
    renderThumbnail(index, entry.target).catch(showError);
  }
}, { root: pagesHost, rootMargin: "240px" });

function asset(name, fallback) {
  return globalThis.__docbenchPdfAssets?.[name] || fallback;
}

async function ensurePdfJs() {
  if (state.pdfjs) return state.pdfjs;
  state.pdfjs = await import(asset("pdfModuleUrl", "/vendor/pdfjs/pdf.mjs"));
  state.pdfjs.GlobalWorkerOptions.workerSrc = asset(
    "pdfWorkerUrl",
    "/vendor/pdfjs/pdf.worker.mjs",
  );
  return state.pdfjs;
}

async function ensureQpdf() {
  if (state.qpdfRunner) return state.qpdfRunner;
  state.qpdfModule = state.qpdfModule || await import(
    asset("qpdfModuleUrl", "/vendor/qpdf-run/index.js")
  );
  state.qpdfRunner = await state.qpdfModule.createQpdfRunner({
    workerUrl: asset("qpdfWorkerUrl", "/vendor/qpdf-run/worker.js"),
    qpdfJsUrl: asset("qpdfJsUrl", "/vendor/qpdf/lib/qpdf.js"),
    wasmUrl: asset("qpdfWasmUrl", "/vendor/qpdf/lib/qpdf.wasm"),
    timeoutMs: 90000,
  });
  return state.qpdfRunner;
}

function setStatus(message, bad = false) {
  pdfStatus.textContent = message;
  pdfStatus.classList.toggle("bad", bad);
}

function showError(error) {
  console.error(error);
  setStatus(error?.message || String(error), true);
}

async function openPdfDocument(bytes) {
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    enableScripting: false,
    isEvalSupported: false,
  });
  return loadingTask.promise;
}

async function makeSource(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new Error(`${file.name}: not a PDF file.`);

  const pdf = await openPdfDocument(bytes);
  const outline = await readPdfOutline(pdf);
  const attachments = await readPdfAttachments(bytes);
  let metadata;
  try {
    metadata = await readPdfMetadata(bytes);
  } catch (error) {
    console.warn("Could not read PDF metadata; using empty fields.", error);
    metadata = {
      title: "",
      author: "",
      subject: "",
      keywords: "",
      creator: "",
      producer: "",
      creationDate: "",
      modificationDate: "",
    };
  }
  return {
    filename: file.name || "document.pdf",
    bytes,
    pdf,
    outline,
    metadata,
    attachments,
    pageCount: pdf.numPages,
  };
}

async function closeSources() {
  const oldSources = state.sources.splice(0);
  await Promise.allSettled(oldSources.map((source) => source.pdf?.destroy?.()));
}

function freshCombinedOutline() {
  return buildCombinedOutline(state.sources, state.plan).outline;
}

function mergeAppendedOutlines(oldSourceCount, oldOutline) {
  if (oldSourceCount === 0) return freshCombinedOutline();
  const fresh = freshCombinedOutline();
  const survivingOldSources = new Set(
    state.plan
      .filter((page) => page.sourceId < oldSourceCount)
      .map((page) => page.sourceId),
  ).size;

  if (oldSourceCount === 1) {
    const firstWrapper = fresh[0];
    if (!firstWrapper) return fresh;
    firstWrapper.children = clonePdfOutline(oldOutline);
    return [firstWrapper, ...fresh.slice(1)];
  }
  return [
    ...clonePdfOutline(oldOutline),
    ...fresh.slice(survivingOldSources),
  ];
}

async function openFiles(files, append) {
  const selected = [...files];
  if (!selected.length) return;
  setStatus("Opening PDF…");

  const newSources = [];
  try {
    for (const file of selected) newSources.push(await makeSource(file));
  } catch (error) {
    await Promise.allSettled(newSources.map((source) => source.pdf?.destroy?.()));
    throw error;
  }

  const oldSourceCount = state.sources.length;
  const oldOutline = clonePdfOutline(state.outline);
  const replaceMetadata = !append || oldSourceCount === 0;
  if (!append) {
    await closeSources();
    state.plan = [];
    state.outline = [];
  }
  const offset = state.sources.length;
  state.sources.push(...newSources);
  state.attachments = mergePdfAttachmentSourceSets(
    newSources.map((source) => source.attachments || []),
    append && oldSourceCount ? state.attachments : null,
  );
  newSources.forEach((source, relativeSourceId) => {
    const sourceId = offset + relativeSourceId;
    for (let pageIndex = 0; pageIndex < source.pageCount; pageIndex += 1) {
      state.plan.push({ sourceId, pageIndex });
    }
  });

  state.outline = append
    ? mergeAppendedOutlines(oldSourceCount, oldOutline)
    : freshCombinedOutline();
  if (replaceMetadata) {
    state.metadata = { ...newSources[0].metadata };
    state.metadataOriginal = { ...newSources[0].metadata };
    renderMetadataEditor();
  }
  state.droppedBookmarks = 0;
  state.selectedBookmarkPath = null;
  state.selectedIndex = state.plan.length ? (append ? state.selectedIndex : 0) : -1;
  if (state.selectedIndex < 0 && state.plan.length) state.selectedIndex = 0;
  refreshPdfUi();
}

function selectedEntry() {
  return state.plan[state.selectedIndex] || null;
}

function bookmarkAtPath(path) {
  if (!Array.isArray(path) || !path.length) return null;
  let items = state.outline;
  let bookmark = null;
  for (const index of path) {
    bookmark = items[index];
    if (!bookmark) return null;
    items = bookmark.children || [];
  }
  return bookmark;
}

function bookmarkContainer(path) {
  if (!Array.isArray(path) || !path.length) return null;
  let items = state.outline;
  for (const index of path.slice(0, -1)) {
    const bookmark = items[index];
    if (!bookmark) return null;
    bookmark.children ||= [];
    items = bookmark.children;
  }
  const index = path.at(-1);
  return Number.isInteger(index) ? { items, index } : null;
}

function samePath(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function newBookmark() {
  const pageIndex = state.selectedIndex >= 0 ? state.selectedIndex : 0;
  return {
    title: "New bookmark",
    target: state.plan.length
      ? { kind: "page", pageIndex, view: { type: "Fit", args: [] } }
      : null,
    color: [],
    bold: false,
    italic: false,
    open: true,
    children: [],
  };
}

function isoToLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 19);
}

function localDateTimeToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

function currentMetadataChanges() {
  if (!state.metadata || !state.metadataOriginal) return {};
  const changes = {};
  for (const { key } of metadataBindings) {
    if (state.metadata[key] !== state.metadataOriginal[key]) changes[key] = state.metadata[key];
  }
  return changes;
}

function updateMetadataStatus() {
  const hasMetadata = Boolean(state.metadata);
  const changes = hasMetadata ? Object.keys(currentMetadataChanges()).length : 0;
  metadataState.textContent = !hasMetadata
    ? "No PDF"
    : changes
      ? `${changes} edited field${changes === 1 ? "" : "s"}`
      : "Original";
  metadataFieldset.disabled = !hasMetadata || state.exporting;
  metadataReset.disabled = !hasMetadata || state.exporting || changes === 0;
}

function renderMetadataEditor() {
  for (const { key, input, date } of metadataBindings) {
    const value = state.metadata?.[key] || "";
    input.value = date ? isoToLocalDateTime(value) : value;
  }
  updateMetadataStatus();
}

function renderAttachmentEditor() {
  const totalBytes = state.attachments.reduce((sum, attachment) => sum + attachment.data.byteLength, 0);
  attachmentsState.textContent = !state.sources.length
    ? "No PDF"
    : `${state.attachments.length} file${state.attachments.length === 1 ? "" : "s"} · ${formatPdfSize(totalBytes)}`;
  attachmentAdd.disabled = state.exporting || !state.sources.length;
  attachmentsHost.replaceChildren();
  if (!state.sources.length) {
    attachmentsHost.textContent = "Open a PDF to manage embedded files.";
    return;
  }
  if (!state.attachments.length) {
    attachmentsHost.textContent = "No embedded files.";
    return;
  }
  state.attachments.forEach((attachment, index) => {
    const row = document.createElement("div");
    row.className = "pdf-attachment-row";
    if (attachment.description) row.title = attachment.description;
    const copy = document.createElement("div");
    copy.className = "pdf-attachment-copy";
    const name = document.createElement("strong");
    name.textContent = attachment.name;
    const detail = document.createElement("small");
    detail.textContent = [
      formatPdfSize(attachment.data.byteLength),
      attachment.mimeType,
      attachment.afRelationship,
    ].filter(Boolean).join(" · ");
    copy.append(name, detail);
    const actions = document.createElement("div");
    actions.className = "pdf-attachment-actions";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "mini-button";
    download.textContent = "Download";
    download.disabled = state.exporting;
    download.addEventListener("click", () => {
      downloadBytes(
        attachment.data,
        attachment.name,
        attachment.mimeType || "application/octet-stream",
      );
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button danger";
    remove.textContent = "Remove";
    remove.disabled = state.exporting;
    remove.addEventListener("click", () => {
      if (state.exporting) return;
      const [removed] = state.attachments.splice(index, 1);
      renderAttachmentEditor();
      setStatus(`Removed attachment ${removed.name}.`);
    });
    actions.append(download, remove);
    row.append(copy, actions);
    attachmentsHost.append(row);
  });
}

async function addAttachmentFiles(files) {
  if (!state.sources.length || state.exporting) return;
  const added = [];
  for (const file of [...files]) {
    const modified = file.lastModified ? new Date(file.lastModified) : null;
    added.push({
      name: file.name || "attachment.bin",
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || "",
      afRelationship: "Unspecified",
      description: "",
      creationDate: "",
      modificationDate: modified && !Number.isNaN(modified.getTime())
        ? new Date(Math.floor(modified.getTime() / 1000) * 1000).toISOString()
        : "",
    });
  }
  if (!added.length) return;
  state.attachments = mergePdfAttachmentSets(state.attachments, added);
  renderAttachmentEditor();
  setStatus(`Added ${added.length} attachment${added.length === 1 ? "" : "s"}.`);
}

function updateCompressionControls() {
  imageQualityRow.hidden = !lossyImagesToggle.checked;
  imageQualityValue.value = imageQuality.value;
  imageQualityValue.textContent = imageQuality.value;
}

function updateControls() {
  const hasPage = Boolean(selectedEntry());
  const busy = state.exporting;
  saveButton.disabled = busy || !state.plan.length;
  extractButton.disabled = busy || !hasPage;
  splitButton.disabled = busy || state.plan.length <= 1;
  removeButton.disabled = busy || !hasPage || state.plan.length <= 1;
  leftButton.disabled = busy || !hasPage || state.selectedIndex <= 0;
  rightButton.disabled = busy || !hasPage || state.selectedIndex >= state.plan.length - 1;
  bookmarkAddRoot.disabled = busy || !state.plan.length;
  updateMetadataStatus();
  renderAttachmentEditor();
}

function refreshPdfUi() {
  state.renderToken += 1;
  const totalBytes = state.sources.reduce((sum, source) => sum + source.bytes.byteLength, 0);
  pdfFilename.textContent = state.sources.length
    ? state.sources.map((source) => source.filename).join(" + ")
    : "No PDF loaded";
  setStatus(
    state.sources.length
      ? `${state.plan.length} pages · ${state.sources.length} file${state.sources.length === 1 ? "" : "s"} · ${formatPdfSize(totalBytes)}`
      : "Open a PDF to begin.",
  );
  renderPageStrip();
  renderBookmarkUi();
  renderPreview().catch(showError);
  updateControls();
}

function refreshBookmarkUi() {
  renderOutline();
  renderBookmarkEditor();
  updateControls();
}

function renderPageStrip() {
  thumbnailObserver.disconnect();
  pagesHost.replaceChildren();
  state.plan.forEach((entry, index) => {
    const source = state.sources[entry.sourceId];
    const card = document.createElement("button");
    card.type = "button";
    card.className = `pdf-page-card${index === state.selectedIndex ? " selected" : ""}`;
    card.dataset.index = String(index);
    card.draggable = true;
    card.title = `${source.filename} · page ${entry.pageIndex + 1}`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-thumb";
    canvas.dataset.pageIndex = String(index);
    const label = document.createElement("span");
    label.textContent = `${index + 1}`;
    const sourceLabel = document.createElement("small");
    sourceLabel.textContent = state.sources.length > 1 ? source.filename : `Page ${entry.pageIndex + 1}`;
    card.append(canvas, label, sourceLabel);

    card.addEventListener("click", () => selectPage(index));
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    card.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (Number.isInteger(from)) movePage(from, index);
    });

    pagesHost.append(card);
    thumbnailObserver.observe(canvas);
  });
}

async function renderPageIntoCanvas(planIndex, canvas, maxWidth) {
  const entry = state.plan[planIndex];
  if (!entry) return;
  const source = state.sources[entry.sourceId];
  const page = await source.pdf.getPage(entry.pageIndex + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const cssScale = Math.min(2, maxWidth / baseViewport.width);
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: cssScale * pixelRatio });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
  const context = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
}

async function renderThumbnail(index, canvas) {
  if (!canvas.isConnected || !state.plan[index]) return;
  await renderPageIntoCanvas(index, canvas, 150);
}

async function renderPreview() {
  const token = state.renderToken;
  const entry = selectedEntry();
  if (!entry) {
    previewCanvas.hidden = true;
    return;
  }
  previewCanvas.hidden = false;
  const hostWidth = previewCanvas.parentElement?.clientWidth || 900;
  await renderPageIntoCanvas(state.selectedIndex, previewCanvas, Math.max(300, hostWidth - 36));
  if (token !== state.renderToken) return;
}

function selectPage(index) {
  if (index < 0 || index >= state.plan.length) return;
  state.selectedIndex = index;
  refreshPdfUi();
}

function remapEditedOutline(oldPlan) {
  const remapped = remapOutlineToPagePlan(state.outline, oldPlan, state.plan);
  state.outline = remapped.outline;
  state.droppedBookmarks = remapped.dropped;
  if (remapped.dropped) state.selectedBookmarkPath = null;
}

function movePage(from, to) {
  if (from === to || from < 0 || from >= state.plan.length || to < 0 || to >= state.plan.length) return;
  const oldPlan = state.plan.map((page) => ({ ...page }));
  const [page] = state.plan.splice(from, 1);
  state.plan.splice(to, 0, page);
  state.selectedIndex = to;
  remapEditedOutline(oldPlan);
  refreshPdfUi();
}

function removeSelectedPage() {
  if (state.plan.length <= 1 || state.selectedIndex < 0) return;
  const oldPlan = state.plan.map((page) => ({ ...page }));
  state.plan.splice(state.selectedIndex, 1);
  state.selectedIndex = Math.min(state.selectedIndex, state.plan.length - 1);
  remapEditedOutline(oldPlan);
  refreshPdfUi();
}

function renderBookmarkUi() {
  renderOutline();
  renderBookmarkEditor();
}

function selectBookmark(path) {
  state.selectedBookmarkPath = [...path];
  const bookmark = bookmarkAtPath(path);
  if (bookmark?.target?.kind === "page") {
    state.selectedIndex = bookmark.target.pageIndex;
    refreshPdfUi();
  } else {
    refreshBookmarkUi();
  }
}

function renderOutline() {
  outlineHost.replaceChildren();
  if (!state.sources.length) {
    outlineHost.textContent = "No bookmarks yet.";
    return;
  }
  if (!state.outline.length) {
    outlineHost.textContent = "No bookmarks. Add one to start.";
    return;
  }

  function appendLevel(bookmarks, parent, depth, parentPath = []) {
    bookmarks.forEach((bookmark, index) => {
      const path = [...parentPath, index];
      const row = document.createElement("button");
      row.type = "button";
      row.className = `outline-item${samePath(path, state.selectedBookmarkPath) ? " selected" : ""}`;
      row.style.setProperty("--outline-depth", String(depth));
      row.textContent = bookmark.title || "Untitled bookmark";
      if (!bookmark.target) row.classList.add("targetless");
      row.addEventListener("click", () => selectBookmark(path));
      parent.append(row);
      appendLevel(bookmark.children || [], parent, depth + 1, path);
    });
  }
  appendLevel(state.outline, outlineHost, 0);

  if (state.droppedBookmarks) {
    const note = document.createElement("p");
    note.className = "outline-note";
    note.textContent = `${state.droppedBookmarks} bookmark${state.droppedBookmarks === 1 ? "" : "s"} to deleted pages were pruned.`;
    outlineHost.append(note);
  }
}

function fillBookmarkPages(selectedPageIndex) {
  bookmarkPage.replaceChildren();
  state.plan.forEach((entry, index) => {
    const source = state.sources[entry.sourceId];
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = state.sources.length > 1
      ? `Page ${index + 1} · ${source.filename} p.${entry.pageIndex + 1}`
      : `Page ${index + 1}`;
    bookmarkPage.append(option);
  });
  if (Number.isInteger(selectedPageIndex) && state.plan[selectedPageIndex]) {
    bookmarkPage.value = String(selectedPageIndex);
  }
}

function renderBookmarkEditor() {
  const bookmark = bookmarkAtPath(state.selectedBookmarkPath);
  bookmarkEditor.hidden = !bookmark;
  if (!bookmark) return;

  bookmarkTitle.value = bookmark.title || "";
  const targetType = bookmark.target?.kind || "none";
  bookmarkTargetType.value = targetType;
  bookmarkPageRow.hidden = targetType !== "page";
  bookmarkUrlRow.hidden = targetType !== "url";
  bookmarkNamedRow.hidden = targetType !== "named";
  fillBookmarkPages(bookmark.target?.kind === "page" ? bookmark.target.pageIndex : null);
  bookmarkUrl.value = bookmark.target?.kind === "url" ? bookmark.target.url || "" : "";
  bookmarkNamed.value = bookmark.target?.kind === "named" ? bookmark.target.action || "" : "";
  bookmarkBold.checked = Boolean(bookmark.bold);
  bookmarkItalic.checked = Boolean(bookmark.italic);
  bookmarkOpen.checked = bookmark.children?.length ? bookmark.open !== false : true;
  bookmarkOpen.disabled = !bookmark.children?.length;

  const location = bookmarkContainer(state.selectedBookmarkPath);
  bookmarkUp.disabled = !location || location.index <= 0;
  bookmarkDown.disabled = !location || location.index >= location.items.length - 1;
  bookmarkIndent.disabled = !location || location.index <= 0;
  bookmarkOutdent.disabled = state.selectedBookmarkPath.length < 2;
}

function mutateSelectedBookmark(mutator, rerender = true) {
  const bookmark = bookmarkAtPath(state.selectedBookmarkPath);
  if (!bookmark) return;
  mutator(bookmark);
  state.droppedBookmarks = 0;
  if (rerender) refreshBookmarkUi();
}

function setBookmarkTargetType(type) {
  mutateSelectedBookmark((bookmark) => {
    if (type === "page") {
      const currentPage = bookmark.target?.kind === "page"
        ? bookmark.target.pageIndex
        : Math.max(0, state.selectedIndex);
      bookmark.target = {
        kind: "page",
        pageIndex: Math.min(currentPage, Math.max(0, state.plan.length - 1)),
        view: bookmark.target?.kind === "page"
          ? bookmark.target.view
          : { type: "Fit", args: [] },
      };
    } else if (type === "url") {
      bookmark.target = {
        kind: "url",
        url: bookmark.target?.kind === "url" ? bookmark.target.url : "",
        newWindow: bookmark.target?.kind === "url" && Boolean(bookmark.target.newWindow),
      };
    } else if (type === "named") {
      bookmark.target = {
        kind: "named",
        action: bookmark.target?.kind === "named" ? bookmark.target.action : "NextPage",
      };
    } else {
      bookmark.target = null;
    }
  });
}

function addRootBookmark() {
  if (!state.plan.length) return;
  state.outline.push(newBookmark());
  state.selectedBookmarkPath = [state.outline.length - 1];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
  bookmarkTitle.focus();
  bookmarkTitle.select();
}

function addSiblingBookmark() {
  const location = bookmarkContainer(state.selectedBookmarkPath);
  if (!location) return;
  location.items.splice(location.index + 1, 0, newBookmark());
  state.selectedBookmarkPath = [
    ...state.selectedBookmarkPath.slice(0, -1),
    location.index + 1,
  ];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
  bookmarkTitle.focus();
  bookmarkTitle.select();
}

function addChildBookmark() {
  const bookmark = bookmarkAtPath(state.selectedBookmarkPath);
  if (!bookmark) return;
  bookmark.children ||= [];
  bookmark.children.push(newBookmark());
  state.selectedBookmarkPath = [
    ...state.selectedBookmarkPath,
    bookmark.children.length - 1,
  ];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
  bookmarkTitle.focus();
  bookmarkTitle.select();
}

function moveBookmark(delta) {
  const location = bookmarkContainer(state.selectedBookmarkPath);
  if (!location) return;
  const nextIndex = location.index + delta;
  if (nextIndex < 0 || nextIndex >= location.items.length) return;
  [location.items[location.index], location.items[nextIndex]] = [
    location.items[nextIndex],
    location.items[location.index],
  ];
  state.selectedBookmarkPath = [
    ...state.selectedBookmarkPath.slice(0, -1),
    nextIndex,
  ];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
}

function indentBookmark() {
  const location = bookmarkContainer(state.selectedBookmarkPath);
  if (!location || location.index <= 0) return;
  const [bookmark] = location.items.splice(location.index, 1);
  const previous = location.items[location.index - 1];
  previous.children ||= [];
  previous.children.push(bookmark);
  state.selectedBookmarkPath = [
    ...state.selectedBookmarkPath.slice(0, -1),
    location.index - 1,
    previous.children.length - 1,
  ];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
}

function outdentBookmark() {
  const path = state.selectedBookmarkPath;
  if (!Array.isArray(path) || path.length < 2) return;
  const current = bookmarkContainer(path);
  const parentPath = path.slice(0, -1);
  const parentLocation = bookmarkContainer(parentPath);
  if (!current || !parentLocation) return;

  const [bookmark] = current.items.splice(current.index, 1);
  parentLocation.items.splice(parentLocation.index + 1, 0, bookmark);
  state.selectedBookmarkPath = [
    ...parentPath.slice(0, -1),
    parentLocation.index + 1,
  ];
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
}

function deleteBookmark() {
  const location = bookmarkContainer(state.selectedBookmarkPath);
  if (!location) return;
  location.items.splice(location.index, 1);
  state.selectedBookmarkPath = null;
  state.droppedBookmarks = 0;
  refreshBookmarkUi();
}

function normalizedColor(bookmark) {
  const color = [...(bookmark.color || [])];
  return color.length === 3 ? color : [0, 0, 0];
}

function outlineSignature(outline) {
  return (outline || []).map((bookmark) => {
    let target = null;
    if (bookmark.target?.kind === "page") {
      target = [
        "page",
        bookmark.target.pageIndex,
        bookmark.target.view?.type || "Fit",
        [...(bookmark.target.view?.args || [])],
      ];
    } else if (bookmark.target?.kind === "url") {
      target = ["url", bookmark.target.url, Boolean(bookmark.target.newWindow)];
    } else if (bookmark.target?.kind === "named") {
      target = ["named", bookmark.target.action];
    }
    const children = bookmark.children || [];
    return {
      title: bookmark.title,
      target,
      color: normalizedColor(bookmark),
      bold: Boolean(bookmark.bold),
      italic: Boolean(bookmark.italic),
      open: children.length ? bookmark.open !== false : true,
      children: outlineSignature(children),
    };
  });
}

function validateEditableOutline(outline = state.outline, plan = state.plan) {
  for (const bookmark of outline) {
    if (!String(bookmark.title || "").trim()) {
      throw new Error("Bookmark titles cannot be empty.");
    }
    if (bookmark.target?.kind === "page") {
      if (!Number.isInteger(bookmark.target.pageIndex) || !plan[bookmark.target.pageIndex]) {
        throw new Error(`Bookmark “${bookmark.title}” points to a missing page.`);
      }
    } else if (bookmark.target?.kind === "url" && !String(bookmark.target.url || "").trim()) {
      throw new Error(`Bookmark “${bookmark.title}” has an empty URL.`);
    } else if (bookmark.target?.kind === "named" && !String(bookmark.target.action || "").trim()) {
      throw new Error(`Bookmark “${bookmark.title}” has an empty named action.`);
    }
    validateEditableOutline(bookmark.children || [], plan);
  }
}

async function verifyOutput(bytes, expectedPages, expectedOutline, expectedMetadata, metadataChanges, expectedAttachments) {
  const pdf = await openPdfDocument(bytes);
  try {
    if (pdf.numPages !== expectedPages) {
      throw new Error(`Output verification failed: expected ${expectedPages} pages, got ${pdf.numPages}.`);
    }
    const outline = await readPdfOutline(pdf);
    if (JSON.stringify(outlineSignature(outline)) !== JSON.stringify(outlineSignature(expectedOutline))) {
      throw new Error("Output verification failed: bookmark tree, style or destinations changed.");
    }
    await verifyPdfMetadata(bytes, expectedMetadata, metadataChanges);
    await verifyPdfAttachments(bytes, expectedAttachments);
  } finally {
    await pdf.destroy();
  }
}

function currentExportOptions() {
  return {
    optimize: optimizeToggle.checked,
    linearize: linearizeToggle.checked,
    lossyImages: lossyImagesToggle.checked,
    jpegQuality: Number(imageQuality.value),
  };
}

function exportSnapshot() {
  return {
    sources: state.sources.map((source) => ({
      filename: source.filename,
      bytes: source.bytes,
    })),
    plan: state.plan.map((page) => ({ ...page })),
    outline: clonePdfOutline(state.outline),
    metadata: { ...state.metadata },
    metadataChanges: currentMetadataChanges(),
    attachments: state.attachments.map((attachment) => ({ ...attachment, data: attachment.data })),
    options: currentExportOptions(),
  };
}

async function buildPdfOutput(snapshot, plan, outline) {
  validateEditableOutline(outline, plan);
  const qpdf = await ensureQpdf();
  const pageRequest = buildQpdfPageRequest(snapshot.sources, plan);
  const pageResult = await qpdf.run(pageRequest);
  const pageBytes = pageResult.outputs[pageRequest.outputName];
  let finalBytes = await replacePdfOutline(pageBytes, outline);
  if (Object.keys(snapshot.metadataChanges).length) {
    finalBytes = await replacePdfMetadata(finalBytes, snapshot.metadataChanges);
  }
  finalBytes = await replacePdfAttachments(finalBytes, snapshot.attachments);
  const warnings = [...(pageResult.warnings || [])];

  if (snapshot.options.optimize || snapshot.options.linearize || snapshot.options.lossyImages) {
    const finalizeRequest = buildQpdfFinalizeRequest(finalBytes, snapshot.options);
    const finalizeResult = await qpdf.run(finalizeRequest);
    finalBytes = finalizeResult.outputs[finalizeRequest.outputName];
    warnings.push(...(finalizeResult.warnings || []));
  }

  await verifyOutput(finalBytes, plan.length, outline, snapshot.metadata, snapshot.metadataChanges, snapshot.attachments);
  return { bytes: finalBytes, warnings };
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function outputBaseName(snapshot) {
  const raw = snapshot.sources.length === 1
    ? snapshot.sources[0].filename.replace(/\.pdf$/i, "")
    : "merged";
  return (raw || "document").replace(/[\\/:*?"<>|]/g, "-");
}

function pageFilename(snapshot, outputIndex) {
  const width = Math.max(2, String(snapshot.plan.length).length);
  return `${outputBaseName(snapshot)}-page-${String(outputIndex + 1).padStart(width, "0")}.pdf`;
}

function setExportBusy(busy) {
  state.exporting = busy;
  updateControls();
}

function concatByteChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function createStoredZip(zipApi) {
  const chunks = [];
  let zip;
  const done = new Promise((resolve, reject) => {
    zip = new zipApi.Zip((error, data, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(data);
      if (final) resolve(concatByteChunks(chunks));
    });
  });
  return {
    add(filename, bytes) {
      const entry = new zipApi.ZipPassThrough(filename);
      zip.add(entry);
      entry.push(bytes, true);
    },
    async finish() {
      zip.end();
      return done;
    },
  };
}

async function savePdf() {
  if (!state.plan.length || state.exporting) return;
  const snapshot = exportSnapshot();
  setExportBusy(true);
  setStatus("Building PDF locally…");
  try {
    const result = await buildPdfOutput(snapshot, snapshot.plan, snapshot.outline);
    const filename = snapshot.sources.length === 1
      ? `${outputBaseName(snapshot)}-docbench.pdf`
      : "merged-docbench.pdf";
    downloadBytes(result.bytes, filename, "application/pdf");
    const warningText = result.warnings.length
      ? ` · ${result.warnings.length} qpdf warning(s)`
      : "";
    setStatus(`Saved ${snapshot.plan.length} pages · ${formatPdfSize(result.bytes.byteLength)}${warningText}`);
  } catch (error) {
    showError(error);
  } finally {
    setExportBusy(false);
  }
}

async function extractSelectedPage() {
  if (state.exporting || state.selectedIndex < 0 || !state.plan[state.selectedIndex]) return;
  const snapshot = exportSnapshot();
  const outputIndex = state.selectedIndex;
  const plan = [{ ...snapshot.plan[outputIndex] }];
  const outline = remapOutlineToPagePlan(snapshot.outline, snapshot.plan, plan).outline;
  setExportBusy(true);
  setStatus(`Extracting page ${outputIndex + 1}…`);
  try {
    const result = await buildPdfOutput(snapshot, plan, outline);
    downloadBytes(result.bytes, pageFilename(snapshot, outputIndex), "application/pdf");
    setStatus(`Extracted page ${outputIndex + 1} · ${formatPdfSize(result.bytes.byteLength)}`);
  } catch (error) {
    showError(error);
  } finally {
    setExportBusy(false);
  }
}

async function splitAllPages() {
  if (state.exporting || state.plan.length <= 1) return;
  const zipApi = globalThis.fflate;
  if (!zipApi?.Zip || !zipApi?.ZipPassThrough) {
    showError(new Error("ZIP runtime is unavailable."));
    return;
  }

  const snapshot = exportSnapshot();
  const archive = createStoredZip(zipApi);
  let warningCount = 0;
  setExportBusy(true);
  try {
    for (let outputIndex = 0; outputIndex < snapshot.plan.length; outputIndex += 1) {
      setStatus(`Splitting page ${outputIndex + 1} / ${snapshot.plan.length}…`);
      const plan = [{ ...snapshot.plan[outputIndex] }];
      const outline = remapOutlineToPagePlan(snapshot.outline, snapshot.plan, plan).outline;
      const result = await buildPdfOutput(snapshot, plan, outline);
      archive.add(pageFilename(snapshot, outputIndex), result.bytes);
      warningCount += result.warnings.length;
    }
    const zipBytes = await archive.finish();
    downloadBytes(zipBytes, `${outputBaseName(snapshot)}-split.zip`, "application/zip");
    const warningText = warningCount ? ` · ${warningCount} qpdf warning(s)` : "";
    setStatus(`Split ${snapshot.plan.length} pages · ${formatPdfSize(zipBytes.byteLength)} ZIP${warningText}`);
  } catch (error) {
    showError(error);
  } finally {
    setExportBusy(false);
  }
}

$("#pdf-open-button").addEventListener("click", () => pdfInput.click());
$("#pdf-add-button").addEventListener("click", () => addPdfInput.click());
pdfInput.addEventListener("change", async () => {
  try { await openFiles(pdfInput.files || [], false); } catch (error) { showError(error); }
  pdfInput.value = "";
});
addPdfInput.addEventListener("change", async () => {
  try { await openFiles(addPdfInput.files || [], true); } catch (error) { showError(error); }
  addPdfInput.value = "";
});
leftButton.addEventListener("click", () => movePage(state.selectedIndex, state.selectedIndex - 1));
rightButton.addEventListener("click", () => movePage(state.selectedIndex, state.selectedIndex + 1));
removeButton.addEventListener("click", removeSelectedPage);
extractButton.addEventListener("click", extractSelectedPage);
splitButton.addEventListener("click", splitAllPages);
saveButton.addEventListener("click", savePdf);
attachmentAdd.addEventListener("click", () => attachmentInput.click());
attachmentInput.addEventListener("change", async () => {
  try { await addAttachmentFiles(attachmentInput.files || []); } catch (error) { showError(error); }
  attachmentInput.value = "";
});
for (const { key, input, date } of metadataBindings) {
  input.addEventListener(date ? "change" : "input", () => {
    if (!state.metadata || state.exporting) return;
    state.metadata[key] = date ? localDateTimeToIso(input.value) : input.value;
    updateMetadataStatus();
  });
}
metadataReset.addEventListener("click", () => {
  if (!state.metadataOriginal || state.exporting) return;
  state.metadata = { ...state.metadataOriginal };
  renderMetadataEditor();
});

lossyImagesToggle.addEventListener("change", updateCompressionControls);
imageQuality.addEventListener("input", updateCompressionControls);
bookmarkEditor.addEventListener("submit", (event) => event.preventDefault());
bookmarkAddRoot.addEventListener("click", addRootBookmark);
bookmarkAddSibling.addEventListener("click", addSiblingBookmark);
bookmarkAddChild.addEventListener("click", addChildBookmark);
bookmarkUp.addEventListener("click", () => moveBookmark(-1));
bookmarkDown.addEventListener("click", () => moveBookmark(1));
bookmarkIndent.addEventListener("click", indentBookmark);
bookmarkOutdent.addEventListener("click", outdentBookmark);
bookmarkDelete.addEventListener("click", deleteBookmark);
bookmarkTitle.addEventListener("input", () => {
  mutateSelectedBookmark((bookmark) => { bookmark.title = bookmarkTitle.value; }, false);
  renderOutline();
});
bookmarkTargetType.addEventListener("change", () => setBookmarkTargetType(bookmarkTargetType.value));
bookmarkPage.addEventListener("change", () => {
  mutateSelectedBookmark((bookmark) => {
    const pageIndex = Number(bookmarkPage.value);
    if (!Number.isInteger(pageIndex) || !state.plan[pageIndex]) return;
    const view = bookmark.target?.kind === "page"
      ? bookmark.target.view
      : { type: "Fit", args: [] };
    bookmark.target = { kind: "page", pageIndex, view };
    state.selectedIndex = pageIndex;
  }, false);
  refreshPdfUi();
});
bookmarkUrl.addEventListener("input", () => {
  mutateSelectedBookmark((bookmark) => {
    bookmark.target = {
      kind: "url",
      url: bookmarkUrl.value,
      newWindow: bookmark.target?.kind === "url" && Boolean(bookmark.target.newWindow),
    };
  }, false);
});
bookmarkNamed.addEventListener("input", () => {
  mutateSelectedBookmark((bookmark) => {
    bookmark.target = { kind: "named", action: bookmarkNamed.value };
  }, false);
});
bookmarkBold.addEventListener("change", () => {
  mutateSelectedBookmark((bookmark) => { bookmark.bold = bookmarkBold.checked; });
});
bookmarkItalic.addEventListener("change", () => {
  mutateSelectedBookmark((bookmark) => { bookmark.italic = bookmarkItalic.checked; });
});
bookmarkOpen.addEventListener("change", () => {
  mutateSelectedBookmark((bookmark) => { bookmark.open = bookmarkOpen.checked; });
});
window.addEventListener("beforeunload", () => state.qpdfRunner?.destroy?.());

updateCompressionControls();
renderMetadataEditor();
refreshPdfUi();
