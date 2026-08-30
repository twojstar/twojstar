(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const editor = $("#editor");
  const preview = $("#preview");
  const formatSelect = $("#format-select");
  const eolSelect = $("#eol-select");
  const statusBadge = $("#status-badge");
  const detailStatus = $("#detail-status");
  const filenameLabel = $("#filename-label");
  const encodingLabel = $("#encoding-label");
  const fileInput = $("#file-input");
  const dropZone = $("#drop-zone");

  const state = { filename: "untitled.txt", bom: false, mixedEol: false };
  const extensionToFormat = {
    txt: "txt", md: "md", markdown: "md", json: "json",
    yml: "yaml", yaml: "yaml", xml: "xml",
  };
  const preferredExtension = { txt: "txt", md: "md", json: "json", yaml: "yml", xml: "xml" };

  function detectEol(raw) {
    const crlf = (raw.match(/\r\n/g) || []).length;
    const totalLf = (raw.match(/\n/g) || []).length;
    const lf = totalLf - crlf;
    const cr = (raw.match(/\r(?!\n)/g) || []).length;
    const present = [["CRLF", crlf], ["LF", lf], ["CR", cr]].filter(([, count]) => count > 0);
    if (!present.length) return { target: "LF", mixed: false };
    present.sort((a, b) => b[1] - a[1]);
    return { target: present[0][0], mixed: present.length > 1 };
  }

  function normalizeEol(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function applyEol(text, kind) {
    const normalized = normalizeEol(text);
    if (kind === "CRLF") return normalized.replace(/\n/g, "\r\n");
    if (kind === "CR") return normalized.replace(/\n/g, "\r");
    return normalized;
  }

  function positionFromOffset(text, offset) {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split("\n");
    return { line: lines.length, column: lines.at(-1).length + 1 };
  }

  function jsonError(error, text) {
    const match = String(error.message).match(/position\s+(\d+)/i);
    const position = match ? positionFromOffset(text, Number(match[1])) : null;
    return { message: error.message, position };
  }

  function nextNonWhitespace(text, index) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    return index;
  }

  function formatJsonLossless(text) {
    const source = text.trim();
    if (!source) return "";

    let output = "";
    let indent = 0;
    let inString = false;
    let escaped = false;
    const stack = [];
    const padding = () => "  ".repeat(indent);

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        output += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }

      if (char === "\"") {
        inString = true;
        output += char;
        continue;
      }
      if (/\s/.test(char)) continue;

      if (char === "{" || char === "[") {
        const close = char === "{" ? "}" : "]";
        const next = nextNonWhitespace(source, index + 1);
        const expanded = source[next] !== close;
        stack.push(expanded);
        output += char;
        if (expanded) {
          indent += 1;
          output += `\n${padding()}`;
        }
        continue;
      }

      if (char === "}" || char === "]") {
        const expanded = stack.pop();
        if (expanded) {
          indent -= 1;
          output += `\n${padding()}`;
        }
        output += char;
        continue;
      }

      if (char === ",") {
        output += `,\n${padding()}`;
        continue;
      }
      if (char === ":") {
        output += ": ";
        continue;
      }
      output += char;
    }

    return `${output}\n`;
  }

  function previewValue(value, ancestors = new WeakSet()) {
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    if (ancestors.has(value)) return "[Circular]";

    ancestors.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map((item) => previewValue(item, ancestors));
    } else {
      result = {};
      for (const [key, item] of Object.entries(value)) {
        result[key] = previewValue(item, ancestors);
      }
    }
    ancestors.delete(value);
    return result;
  }

  function stringifyPreview(value) {
    return JSON.stringify(previewValue(value), null, 2);
  }

  function containsYamlNumber(value, seen = new WeakSet()) {
    if (typeof value === "number") return true;
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => containsYamlNumber(item, seen));
    return Object.values(value).some((item) => containsYamlNumber(item, seen));
  }

  function xmlError(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const root = doc.documentElement;
    const parserNamespaces = new Set([
      "http://www.mozilla.org/newlayout/xml/parsererror.xml",
      "http://www.w3.org/1999/xhtml",
    ]);
    const error = root?.localName === "parsererror" && parserNamespaces.has(root.namespaceURI)
      ? root
      : null;
    if (!error) return null;
    const rawMessage = error.textContent.trim().replace(/\s+/g, " ");
    const lineMatch = rawMessage.match(/line(?: number)?\s*[: ]\s*(\d+).*?column(?: number)?\s*[: ]\s*(\d+)/i);
    const message = rawMessage
      .replace(/^This page contains the following errors:\s*/i, "")
      .replace(/^error on line \d+ at column \d+:\s*/i, "")
      .replace(/\s*Below is a rendering of the page up to the first error.*$/i, "")
      .trim() || "Malformed XML.";
    return {
      message,
      position: lineMatch ? { line: Number(lineMatch[1]), column: Number(lineMatch[2]) } : null,
    };
  }

  function revealErrorLine(position) {
    if (!position?.line) return;
    const lines = editor.value.split("\n");
    const lineIndex = Math.min(lines.length - 1, Math.max(0, position.line - 1));
    let start = 0;
    for (let index = 0; index < lineIndex; index += 1) start += lines[index].length + 1;
    const end = start + lines[lineIndex].length;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, end);
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, (lineIndex - 2) * lineHeight);
  }

  function parseCurrent() {
    const text = editor.value;
    switch (formatSelect.value) {
      case "json":
        try {
          JSON.parse(text);
          return { ok: true, value: text };
        } catch (error) {
          return { ok: false, error: jsonError(error, text) };
        }
      case "yaml":
        try {
          const docs = [];
          globalThis.jsyaml.loadAll(text, (doc) => docs.push(doc));
          return { ok: true, value: docs.length === 1 ? docs[0] : docs };
        } catch (error) {
          const mark = error.mark;
          return {
            ok: false,
            error: {
              message: error.reason || error.message,
              position: mark ? { line: mark.line + 1, column: mark.column + 1 } : null,
            },
          };
        }
      case "xml": {
        const error = xmlError(text);
        return error ? { ok: false, error } : { ok: true, value: text };
      }
      default:
        return { ok: true, value: text };
    }
  }

  function updateMeta() {
    const lines = editor.value.split("\n").length;
    const mixed = state.mixedEol ? `Mixed → ${eolSelect.value}` : eolSelect.value;
    const bom = state.bom ? "UTF-8 BOM" : "UTF-8";
    encodingLabel.textContent = `${bom} · ${mixed}`;
    detailStatus.textContent = `${bom} · ${mixed} · ${lines} line${lines === 1 ? "" : "s"}`;
  }

  function renderValidation({ revealError = false } = {}) {
    const result = parseCurrent();
    const format = formatSelect.value;
    if (["txt", "md"].includes(format)) {
      statusBadge.className = "status neutral";
      statusBadge.textContent = format === "md" ? "Markdown" : "Plain text";
      preview.textContent = editor.value;
      updateMeta();
      return result;
    }

    if (result.ok) {
      statusBadge.className = "status good";
      statusBadge.textContent = "Valid";
      if (format === "xml") preview.textContent = editor.value;
      else if (format === "json") preview.textContent = formatJsonLossless(editor.value);
      else if (containsYamlNumber(result.value)) {
        statusBadge.className = "status neutral";
        statusBadge.textContent = "Valid · numeric YAML";
        preview.textContent = editor.value;
      } else preview.textContent = stringifyPreview(result.value);
    } else {
      statusBadge.className = "status bad";
      const at = result.error.position ? ` · ${result.error.position.line}:${result.error.position.column}` : "";
      statusBadge.textContent = `Invalid${at}`;
      preview.textContent = result.error.message;
      if (revealError) revealErrorLine(result.error.position);
    }
    updateMeta();
    return result;
  }

  function formatXml(text) {
    const error = xmlError(text);
    if (error) throw new Error(error.message);

    const doc = new DOMParser().parseFromString(text, "application/xml");
    const serializer = new XMLSerializer();
    const declaration = text.match(/^\s*(<\?xml\s+[^?]*\?>)/i)?.[1] || "";

    function serializeNode(node, depth) {
      const indent = "  ".repeat(depth);
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) return "";
        return `${indent}${serializer.serializeToString(node)}`;
      }

      const children = Array.from(node.childNodes);
      const hasElementChild = children.some((child) => child.nodeType === Node.ELEMENT_NODE);
      if (!hasElementChild) return `${indent}${serializer.serializeToString(node)}`;

      const hasSensitiveText = children.some((child) => {
        if (child.nodeType === Node.CDATA_SECTION_NODE) return true;
        if (child.nodeType !== Node.TEXT_NODE) return false;
        const value = child.nodeValue || "";
        return value.trim() !== "" || !/[\r\n]/.test(value);
      });
      const preservesSpace = node.getAttributeNS?.(
        "http://www.w3.org/XML/1998/namespace",
        "space",
      ) === "preserve";

      if (hasSensitiveText || preservesSpace) {
        return `${indent}${serializer.serializeToString(node)}`;
      }

      const structuralChildren = children.filter((child) => {
        return child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim() !== "";
      });
      if (!structuralChildren.length) {
        return `${indent}${serializer.serializeToString(node)}`;
      }

      const shallow = node.cloneNode(false);
      let opening = serializer.serializeToString(shallow);
      if (opening.endsWith("/>")) opening = `${opening.slice(0, -2)}>`;

      const lines = [`${indent}${opening}`];
      for (const child of structuralChildren) {
        const serialized = serializeNode(child, depth + 1);
        if (serialized) lines.push(serialized);
      }
      lines.push(`${indent}</${node.nodeName}>`);
      return lines.join("\n");
    }

    const body = Array.from(doc.childNodes)
      .map((node) => serializeNode(node, 0))
      .filter(Boolean)
      .join("\n");
    return [declaration, body].filter(Boolean).join("\n");
  }

  function formatDocument() {
    const result = parseCurrent();
    if (!result.ok) return renderValidation({ revealError: true });
    try {
      if (formatSelect.value === "json") editor.value = formatJsonLossless(editor.value);
      if (formatSelect.value === "yaml") {
        const docs = [];
        globalThis.jsyaml.loadAll(editor.value, (doc) => docs.push(doc));
        if (docs.some((doc) => containsYamlNumber(doc))) {
          throw new Error("Formatting blocked: numeric YAML scalars are kept verbatim to avoid precision loss.");
        }
        editor.value = docs.map((doc) => globalThis.jsyaml.dump(doc)).join("---\n");
      }
      if (formatSelect.value === "xml") editor.value = `${formatXml(editor.value)}\n`;
      state.mixedEol = false;
      document.dispatchEvent(new Event("docbench:document-change"));
      renderValidation();
    } catch (error) {
      statusBadge.className = "status bad";
      statusBadge.textContent = "Format failed";
      preview.textContent = error.message;
    }
  }

  function setFormatFromFilename(name) {
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
    formatSelect.value = extensionToFormat[ext] || "txt";
  }

  async function openFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const contentBytes = hasBom ? bytes.slice(3) : bytes;
    if (contentBytes.includes(0)) throw new Error("Binary or UTF-16 input is not supported yet.");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    const eol = detectEol(raw);

    state.filename = file.name || "document.txt";
    state.bom = hasBom;
    state.mixedEol = eol.mixed;
    editor.value = normalizeEol(raw);
    eolSelect.value = eol.target;
    filenameLabel.textContent = state.filename;
    setFormatFromFilename(state.filename);
    document.dispatchEvent(new Event("docbench:document-change"));
    renderValidation();
  }

  function saveFile() {
    const raw = applyEol(editor.value, eolSelect.value);
    const data = new TextEncoder().encode(raw);
    const parts = state.bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), data] : [data];
    const blob = new Blob(parts, { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = state.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function newDocument() {
    state.filename = `untitled.${preferredExtension[formatSelect.value]}`;
    state.bom = false;
    state.mixedEol = false;
    eolSelect.value = "LF";
    editor.value = "";
    filenameLabel.textContent = state.filename;
    document.dispatchEvent(new Event("docbench:document-change"));
    renderValidation();
    editor.focus();
  }

  $("#open-button").addEventListener("click", () => fileInput.click());
  $("#new-button").addEventListener("click", newDocument);
  $("#validate-button").addEventListener("click", () => renderValidation({ revealError: true }));
  $("#format-button").addEventListener("click", formatDocument);
  $("#save-button").addEventListener("click", saveFile);
  $("#copy-button").addEventListener("click", async () => navigator.clipboard.writeText(editor.value));
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files?.[0]) return;
    try { await openFile(fileInput.files[0]); }
    catch (error) { preview.textContent = error.message; statusBadge.className = "status bad"; statusBadge.textContent = "Open failed"; }
    fileInput.value = "";
  });
  formatSelect.addEventListener("change", () => {
    if (state.filename.startsWith("untitled.")) {
      state.filename = `untitled.${preferredExtension[formatSelect.value]}`;
      filenameLabel.textContent = state.filename;
    }
    renderValidation();
  });
  eolSelect.addEventListener("change", () => { state.mixedEol = false; updateMeta(); });
  let validationTimer;
  editor.addEventListener("input", () => {
    clearTimeout(validationTimer);
    validationTimer = setTimeout(renderValidation, 120);
  });
  document.addEventListener("docbench:inspect-start", () => {
    clearTimeout(validationTimer);
    validationTimer = undefined;
  });

  for (const event of ["dragenter", "dragover"]) {
    dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add("drop-active"); });
  }
  for (const event of ["dragleave", "drop"]) {
    dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove("drop-active"); });
  }
  dropZone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try { await openFile(file); }
    catch (error) { preview.textContent = error.message; statusBadge.className = "status bad"; statusBadge.textContent = "Open failed"; }
  });

  const modeTabs = [...document.querySelectorAll(".mode-tab")];
  const documentWorkspace = $("#document-workspace");
  const pdfWorkspace = $("#pdf-workspace");

  function activateModeTab(tab, focus = false) {
    modeTabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
    });
    const pdf = tab.dataset.mode === "pdf";
    documentWorkspace.hidden = pdf;
    pdfWorkspace.hidden = !pdf;
    if (focus) tab.focus();
  }

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => activateModeTab(tab));
    tab.addEventListener("keydown", (event) => {
      const current = modeTabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = (current + 1) % modeTabs.length;
      if (event.key === "ArrowLeft") next = (current - 1 + modeTabs.length) % modeTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = modeTabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      activateModeTab(modeTabs[next], true);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (!documentWorkspace.hidden) {
      saveFile();
      return;
    }
    const pdfSave = $("#pdf-save-button");
    if (!pdfSave.disabled) pdfSave.click();
  });

  activateModeTab(modeTabs.find((tab) => tab.classList.contains("active")) || modeTabs[0]);
  renderValidation();
})();