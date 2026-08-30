"use strict";

(() => {
const { scanText, summarizeFindings } = globalThis.DocBenchTextInspector;

const select = (selector) => document.querySelector(selector);
const editor = select("#editor");
const preview = select("#preview");
const previewTitle = select("#preview-title");
const statusBadge = select("#status-badge");
const inspectButton = select("#inspect-button");

function setStatus(kind, text) {
  statusBadge.className = `status ${kind}`;
  statusBadge.textContent = text;
  statusBadge.removeAttribute("title");
}

function revealFinding(finding) {
  const start = Math.max(0, Math.min(editor.value.length, finding.offset));
  const end = Math.max(start, Math.min(editor.value.length, start + finding.length));
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, end);
}

function severityLabel(severity) {
  if (severity === "high") return "High";
  if (severity === "medium") return "Review";
  return "Info";
}

function findingRow(finding) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `inspect-finding severity-${finding.severity}`;
  button.addEventListener("click", () => revealFinding(finding));

  const heading = document.createElement("span");
  heading.className = "inspect-finding-heading";
  const severity = document.createElement("span");
  severity.className = `inspect-severity severity-${finding.severity}`;
  severity.textContent = severityLabel(finding.severity);
  const title = document.createElement("strong");
  title.textContent = finding.label;
  const position = document.createElement("span");
  position.className = "inspect-position";
  position.textContent = `line ${finding.line}:${finding.column}`;
  heading.append(severity, title, position);

  const detail = document.createElement("span");
  detail.className = "inspect-detail";
  detail.textContent = finding.detail;
  button.append(heading, detail);
  return button;
}

function cleanResult() {
  const box = document.createElement("div");
  box.className = "inspect-clean";
  const title = document.createElement("strong");
  title.textContent = "No suspicious text patterns found";
  const note = document.createElement("span");
  note.textContent = "This is a local heuristic scan, not proof that a document is safe.";
  box.append(title, note);
  return box;
}

function summaryRow(summary, truncated) {
  const row = document.createElement("div");
  row.className = "inspect-summary";
  for (const [severity, count] of Object.entries(summary)) {
    const chip = document.createElement("span");
    chip.className = `inspect-summary-chip severity-${severity}`;
    chip.textContent = `${severityLabel(severity)} ${count}`;
    row.append(chip);
  }
  const note = document.createElement("span");
  note.className = "inspect-summary-note";
  note.textContent = truncated
    ? "Showing the retained findings in source order; additional matches were truncated. Click a finding to jump to source."
    : "Prompt-injection and marker findings are heuristic; click any finding to jump to source.";
  row.append(note);
  return row;
}

function inspectDocument() {
  document.dispatchEvent(new Event("docbench:inspect-start"));
  const findings = scanText(editor.value);
  const summary = summarizeFindings(findings);
  preview.className = "preview-inspector";
  previewTitle.textContent = "Text safety inspection";
  if (!findings.length) {
    preview.replaceChildren(cleanResult());
    setStatus("good", "Inspect · clean");
    return;
  }
  const list = document.createElement("div");
  list.className = "inspect-findings";
  for (const finding of findings) list.append(findingRow(finding));
  preview.replaceChildren(summaryRow(summary, findings.truncated), list);
  setStatus(summary.high ? "bad" : "neutral", `Inspect · ${findings.length}${findings.truncated ? "+" : ""}`);
}

function enableInspectionAfterInitialPreview() {
  setTimeout(() => {
    inspectButton.disabled = false;
  }, 0);
}

inspectButton.disabled = true;
inspectButton.addEventListener("click", inspectDocument);
if (document.readyState === "complete") enableInspectionAfterInitialPreview();
else window.addEventListener("load", enableInspectionAfterInitialPreview, { once: true });
})();

import("./token-counter.mjs").catch((error) => {
  console.warn("DocBench token counter failed to initialize", error);
});
