"use strict";

(() => {

  const context = document.modelContext;
  if (!context?.registerTool) return;

  const lifecycle = new AbortController();
  const register = (tool) => {
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal }))
        .catch((error) => console.warn("Docbench WebMCP registration failed", error));
    } catch (error) {
      console.warn("Docbench WebMCP registration failed", error);
    }
  };

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) lifecycle.abort();
  });

  const editor = document.querySelector("#editor");
  const formatSelect = document.querySelector("#format-select");
  const eolSelect = document.querySelector("#eol-select");
  const statusBadge = document.querySelector("#status-badge");
  const preview = document.querySelector("#preview");
  const filenameLabel = document.querySelector("#filename-label");

  if (!editor || !formatSelect || !eolSelect || !statusBadge || !preview) return;

  const snapshot = ({ includeText = false } = {}) => {
    const value = editor.value;
    const result = {
      filename: filenameLabel?.textContent || "",
      format: formatSelect.value,
      lineEndings: eolSelect.value,
      status: statusBadge.textContent || "",
      preview: (preview.textContent || "").slice(0, 5000),
      lines: value.split("\n").length,
      characters: value.length,
    };
    if (includeText) {
      result.text = value.slice(0, 50000);
      result.textTruncated = value.length > 50000;
    }
    return result;
  };

  register({
    name: "read_document",
    title: "Read Docbench document",
    description: "Read the current Docbench document state and optionally its text without changing it.",
    inputSchema: {
      type: "object",
      properties: { includeText: { type: "boolean", default: false } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute({ includeText = false } = {}) {
      return snapshot({ includeText });
    },
  });

  register({
    name: "set_document_text",
    title: "Set Docbench document text",
    description: "Replace the document editor text and optionally select its format using the existing Docbench UI state.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: 500000 },
        format: { type: "string", enum: ["txt", "md", "json", "yaml", "xml"] },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute({ text, format } = {}) {
      if (typeof text !== "string" || text.length > 500000) {
        return { ok: false, error: "text must be a string of at most 500000 characters." };
      }
      const allowedFormats = new Set(["txt", "md", "json", "yaml", "xml"]);
      if (format !== undefined && !allowedFormats.has(format)) {
        return { ok: false, error: "format must be txt, md, json, yaml or xml." };
      }
      editor.value = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      if (format) {
        formatSelect.value = format;
        formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      eolSelect.dispatchEvent(new Event("change", { bubbles: true }));
      globalThis.DocBenchDocumentUi?.validate({ revealError: true });
      return { ok: true, ...snapshot({ includeText: true }) };
    },
  });

  register({
    name: "validate_document",
    title: "Validate Docbench document",
    description: "Validate the current TXT, Markdown, JSON, YAML or XML document and update the visible result.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const validator = globalThis.DocBenchDocumentUi?.validate;
      if (typeof validator !== "function") return { ok: false, error: "Document validator is not ready." };
      const validation = validator({ revealError: true });
      return { ok: validation?.ok !== false, ...snapshot() };
    },
  });

  register({
    name: "format_document",
    title: "Format Docbench document",
    description: "Auto-format the current document with Docbench's existing formatter and return the resulting text and status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      const before = editor.value;
      document.querySelector("#format-button")?.click();
      const result = snapshot({ includeText: true });
      const failed = result.status === "Format failed" || result.status.startsWith("Invalid");
      return { ok: !failed, changed: editor.value !== before, ...result };
    },
  });

  register({
    name: "inspect_document",
    title: "Inspect Docbench document",
    description: "Read Docbench's local text-safety inspection for hidden characters, markers and prompt-injection-like patterns without changing the document.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const inspector = globalThis.DocBenchTextInspector;
      if (!inspector?.scanText || !inspector?.summarizeFindings) {
        return { ok: false, error: "Text inspector is not ready." };
      }
      const findings = inspector.scanText(editor.value);
      return {
        ok: true,
        count: findings.length,
        truncated: Boolean(findings.truncated || findings.length > 100),
        summary: inspector.summarizeFindings(findings),
        findings: findings.slice(0, 100).map((finding) => ({
          severity: finding.severity,
          label: finding.label,
          detail: finding.detail,
          line: finding.line,
          column: finding.column,
          offset: finding.offset,
          length: finding.length,
        })),
      };
    },
  });
})();
