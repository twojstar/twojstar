"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const raw = $("#resVal");
  const resultBody = raw?.parentElement;
  const buttons = raw?.nextElementSibling;
  const reader = window.ZXingWASM;
  if (!raw || !resultBody || typeof window.showResult !== "function") return;

  const style = document.createElement("style");
  style.textContent = `
    .scan-label{font:700 10px/1 "Space Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 7px}
    .scan-meaning{border:1px solid var(--line);background:var(--panel-2);padding:11px;margin:0 0 12px}
    .scan-meaning strong{display:block;margin-bottom:7px}.scan-meaning dl,.scan-tech dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;margin:0}
    .scan-meaning dt,.scan-tech dt{font:600 10px/1.4 "Space Mono",monospace;color:var(--muted)}
    .scan-meaning dd,.scan-tech dd{margin:0;font:400 11px/1.4 "Space Mono",monospace;word-break:break-word}
    .scan-tech{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}.scan-tech summary{cursor:pointer;font:600 11px "Space Mono",monospace;color:var(--muted)}
    .scan-tech dl{margin-top:9px}.scan-bytes{white-space:pre-wrap;word-break:break-all}
  `;
  document.head.appendChild(style);

  const meaning = document.createElement("div");
  meaning.id = "scanMeaning";
  meaning.className = "scan-meaning hidden";
  const rawLabel = document.createElement("div");
  rawLabel.className = "scan-label";
  rawLabel.textContent = "Raw payload";
  resultBody.insertBefore(meaning, raw);
  resultBody.insertBefore(rawLabel, raw);

  const details = document.createElement("details");
  details.id = "scanDetails";
  details.className = "scan-tech";
  const summary = document.createElement("summary");
  summary.textContent = "Technical details";
  const detailList = document.createElement("dl");
  details.append(summary, detailList);
  if (buttons) buttons.insertAdjacentElement("afterend", details);
  else resultBody.appendChild(details);

  function addRow(list, label, value, className = "") {
    if (value === undefined || value === null || value === "") return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    if (className) dd.className = className;
    list.append(dt, dd);
  }

  function decodeEscaped(input) {
    return String(input || "")
      .replace(/\\n/gi, "\n")
      .replace(/\\([\\;,:"])/g, "$1");
  }

  function safeDecodeURIComponent(input) {
    try {
      return decodeURIComponent(input);
    } catch {
      return input;
    }
  }

  function splitEscaped(input, delimiter) {
    const parts = [];
    let current = "";
    let escaped = false;
    for (const char of input) {
      if (escaped) {
        current += `\\${char}`;
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === delimiter) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    if (escaped) current += "\\";
    parts.push(current);
    return parts;
  }

  function parseWifi(text) {
    if (!/^WIFI:/i.test(text)) return null;
    const fields = {};
    splitEscaped(text.slice(5), ";").forEach((part) => {
      const separator = part.indexOf(":");
      if (separator < 1) return;
      fields[part.slice(0, separator).toUpperCase()] = decodeEscaped(part.slice(separator + 1));
    });
    const security = fields.T === "nopass" ? "Open" : fields.T;
    return {
      title: "Wi-Fi network",
      rows: [["SSID", fields.S], ["Security", security], ["Password", fields.P], ["Hidden", fields.H === "true" ? "Yes" : fields.H === "false" ? "No" : ""]],
    };
  }

  function structuredLines(text) {
    const map = new Map();
    text.split(/\r?\n/).forEach((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return;
      const key = line.slice(0, separator).split(";", 1)[0].toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(decodeEscaped(line.slice(separator + 1)));
    });
    return map;
  }

  function parseVcard(text) {
    if (!/^BEGIN:VCARD\b/im.test(text)) return null;
    const fields = structuredLines(text);
    return {
      title: "Contact / vCard",
      rows: [
        ["Name", fields.get("FN")?.[0]], ["Organization", fields.get("ORG")?.[0]],
        ["Phone", fields.get("TEL")?.join(", ")], ["Email", fields.get("EMAIL")?.join(", ")],
        ["Website", fields.get("URL")?.[0]],
      ],
    };
  }

  function parseEvent(text) {
    if (!/^BEGIN:(?:VCALENDAR|VEVENT)\b/im.test(text)) return null;
    const fields = structuredLines(text);
    return {
      title: "Calendar event",
      rows: [
        ["Title", fields.get("SUMMARY")?.[0]], ["Starts", fields.get("DTSTART")?.[0]],
        ["Ends", fields.get("DTEND")?.[0]], ["Location", fields.get("LOCATION")?.[0]],
      ],
    };
  }

  function parseMail(text) {
    if (!/^mailto:/i.test(text)) return null;
    const body = text.slice(7);
    const separator = body.indexOf("?");
    const address = separator < 0 ? body : body.slice(0, separator);
    const params = new URLSearchParams(separator < 0 ? "" : body.slice(separator + 1));
    return { title: "Email", rows: [["To", safeDecodeURIComponent(address)], ["Subject", params.get("subject")], ["Message", params.get("body")]] };
  }

  function parseSms(text) {
    if (/^SMSTO:/i.test(text)) {
      const body = text.slice(6);
      const separator = body.indexOf(":");
      return { title: "SMS", rows: [["Number", separator < 0 ? body : body.slice(0, separator)], ["Message", separator < 0 ? "" : body.slice(separator + 1)]] };
    }
    if (/^sms:/i.test(text)) return { title: "SMS", rows: [["Number / payload", text.slice(4)]] };
    return null;
  }

  function parseSemantic(text) {
    const trimmed = text.trim();
    const wifi = parseWifi(trimmed);
    if (wifi) return wifi;
    const vcard = parseVcard(trimmed);
    if (vcard) return vcard;
    const event = parseEvent(trimmed);
    if (event) return event;
    const mail = parseMail(trimmed);
    if (mail) return mail;
    const sms = parseSms(trimmed);
    if (sms) return sms;
    if (/^tel:/i.test(trimmed)) return { title: "Phone number", rows: [["Number", trimmed.slice(4)]] };
    if (/^geo:/i.test(trimmed)) return { title: "Location", rows: [["Coordinates", trimmed.slice(4)]] };
    if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) return { title: "Web address", rows: [["URL", trimmed]] };
    return null;
  }

  function renderMeaning(text) {
    const parsed = parseSemantic(text);
    meaning.replaceChildren();
    if (!parsed) {
      meaning.classList.add("hidden");
      return;
    }
    meaning.classList.remove("hidden");
    const title = document.createElement("strong");
    title.textContent = parsed.title;
    const list = document.createElement("dl");
    parsed.rows.forEach(([label, value]) => addRow(list, label, value));
    meaning.append(title, list);
  }

  function parseExtra(result) {
    if (!result?.extra) return {};
    try {
      const parsed = JSON.parse(result.extra);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function bytesHex(bytes) {
    if (!bytes || typeof bytes.length !== "number") return "";
    const limit = Math.min(bytes.length, 96);
    const text = Array.from(bytes.slice ? bytes.slice(0, limit) : Array.from(bytes).slice(0, limit), (value) => Number(value).toString(16).padStart(2, "0")).join(" ");
    return bytes.length > limit ? `${text} … (+${bytes.length - limit} bytes)` : text;
  }

  function renderDetails(result, fallbackFormat) {
    detailList.replaceChildren();
    const extra = parseExtra(result);
    addRow(detailList, "Format", result?.format || fallbackFormat);
    addRow(detailList, "Symbology", result?.symbology);
    addRow(detailList, "Content", result?.contentType);
    addRow(detailList, "EC level", extra.ECLevel ?? result?.ecLevel);
    addRow(detailList, "Version / size", extra.Version ?? result?.version);
    addRow(detailList, "Data mask", extra.DataMask);
    addRow(detailList, "Orientation", Number.isFinite(result?.orientation) ? `${result.orientation}°` : "");
    addRow(detailList, "Mirrored", result?.isMirrored ? "Yes" : "");
    addRow(detailList, "Inverted", result?.isInverted ? "Yes" : "");
    addRow(detailList, "Symbology ID", result?.symbologyIdentifier);
    addRow(detailList, "EC margin", extra.UEC);
    addRow(detailList, "Reader init", extra.ReaderInit || result?.readerInit ? "Yes" : "");
    if (result?.sequenceSize > 0) addRow(detailList, "Sequence", `${result.sequenceIndex + 1} / ${result.sequenceSize}${result.sequenceId ? ` · ${result.sequenceId}` : ""}`);
    addRow(detailList, "Raw bytes", bytesHex(result?.bytes), "scan-bytes");
    if (result?.hasECI) addRow(detailList, "ECI bytes", bytesHex(result.bytesECI), "scan-bytes");
    details.hidden = detailList.children.length === 0;
  }

  let lastResults = [];
  if (reader?.readBarcodes && !reader.__codebenchInspectorWrapped) {
    const originalReadBarcodes = reader.readBarcodes.bind(reader);
    reader.readBarcodes = async (...args) => {
      const results = await originalReadBarcodes(...args);
      lastResults = Array.isArray(results) ? results : [];
      return results;
    };
    Object.defineProperty(reader, "__codebenchInspectorWrapped", { value: true });
  }

  const originalShowResult = window.showResult;
  window.showResult = function inspectedShowResult(text, format) {
    originalShowResult(text, format);
    const result = lastResults.find((entry) => entry?.isValid && entry.text === text && entry.format === format)
      || lastResults.find((entry) => entry?.isValid && entry.text === text)
      || null;
    renderMeaning(text);
    renderDetails(result, format);
  };
})();
