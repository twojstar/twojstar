"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);

  // Never export a stale barcode after bwip-js rejected the new payload.
  const barcodeActions = ["#bPng", "#bSvg", "#bCopy", "#bPrint"]
    .map($).filter(Boolean);
  function syncBarcodeValidity() {
    const error = $("#bErr");
    const invalid = Boolean(error && !error.classList.contains("hidden"));
    barcodeActions.forEach((button) => { button.disabled = invalid; });
    if (invalid) {
      const canvas = $("#bCanvas");
      const context = canvas?.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      if ($("#bStat")) $("#bStat").textContent = "Invalid data";
    }
  }
  ["#bType", "#bData", "#bText", "#bScale", "#bHeight", "#bFg", "#bBg", "#bTransparent"]
    .map($).filter(Boolean)
    .forEach((input) => {
      input.addEventListener("input", () => queueMicrotask(syncBarcodeValidity));
      input.addEventListener("change", () => queueMicrotask(syncBarcodeValidity));
    });
  const barcodeError = $("#bErr");
  if (barcodeError) new MutationObserver(syncBarcodeValidity)
    .observe(barcodeError, { attributes: true, childList: true, subtree: true });
  syncBarcodeValidity();

  // One standards-safe source of truth for vCard and iCalendar payloads.
  const originalBuildContent = window.buildContent;
  const value = (key) => {
    const element = $("#f_" + key);
    return element ? (element.type === "checkbox" ? element.checked : element.value) : "";
  };
  const escapeStructuredText = (input) => String(input ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
  const escapeSingleLine = (input) => String(input ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "");
  const formatLocalDateTime = (input) => {
    if (!input) return "";
    const compact = input.replace(/[-:]/g, "");
    return compact.length === 13 ? compact + "00" : compact;
  };
  const formatUtcDateTime = (date) => date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const hash = (input) => {
    let result = 2166136261;
    for (const character of input) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16);
  };
  const buildVCard = ({ fn = "", org = "", title = "", phone = "", email = "", url = "", adr = "" } = {}) => [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeStructuredText(fn)}`,
    org && `ORG:${escapeStructuredText(org)}`,
    title && `TITLE:${escapeStructuredText(title)}`,
    phone && `TEL:${escapeSingleLine(phone)}`,
    email && `EMAIL:${escapeSingleLine(email)}`,
    url && `URL:${escapeSingleLine(url)}`,
    adr && `ADR:;;${escapeStructuredText(adr)};;;;`,
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
  const buildCalendarEvent = ({ title = "", loc = "", start = "", end = "" } = {}) => {
    const identity = [title, loc, start, end].join("|");
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Code Bench//QR & Barcode Studio//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:codebench-${hash(identity)}@local`,
      `DTSTAMP:${formatUtcDateTime(new Date())}`,
      `SUMMARY:${escapeStructuredText(title)}`,
      loc && `LOCATION:${escapeStructuredText(loc)}`,
      start && `DTSTART:${formatLocalDateTime(start)}`,
      end && `DTEND:${formatLocalDateTime(end)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean).join("\r\n");
  };

  window.codebenchStructuredPayloads = {
    escapeStructuredText,
    escapeSingleLine,
    formatLocalDateTime,
    buildVCard,
    buildCalendarEvent,
  };

  if (typeof originalBuildContent === "function") {
    window.buildContent = function hardenedBuildContent() {
      const template = $("#qrChips .chip[aria-pressed='true']")?.dataset.t;
      if (template === "vcard") {
        return buildVCard({
          fn: value("fn"), org: value("org"), title: value("title"), phone: value("phone"),
          email: value("email"), url: value("url"), adr: value("adr"),
        });
      }
      if (template === "event") {
        return buildCalendarEvent({
          title: value("title"), loc: value("loc"), start: value("start"), end: value("end"),
        });
      }
      return originalBuildContent();
    };
  }

  // Ignore stale async frame renders when controls are changed rapidly.
  if (typeof window.qrBareSVG === "function" && typeof window.frameSVG === "function") {
    let frameGeneration = 0;
    window.updateFramed = async function hardenedUpdateFramed() {
      const generation = ++frameGeneration;
      const enabled = $("#qFrame")?.checked;
      const canvas = $("#qrHost canvas");
      let host = $("#qrFramed");
      if (!enabled) {
        if (host) host.style.display = "none";
        if (canvas) canvas.style.display = "";
        return;
      }
      if (canvas) canvas.style.display = "none";
      if (!host) {
        host = document.createElement("div");
        host.id = "qrFramed";
        $("#qrHost")?.appendChild(host);
      }
      host.style.display = "";
      const bare = await window.qrBareSVG();
      if (generation !== frameGeneration) return;
      host.innerHTML = bare ? window.frameSVG(bare, window.frameOpts()) : "";
    };
  }

  // Bound image work before allocating giant canvases or WASM buffers.
  const originalDecodeFile = window.decodeFile;
  if (typeof originalDecodeFile === "function") {
    window.decodeFile = async function boundedDecodeFile(file) {
      const error = $("#fileErr");
      const fail = (message) => {
        if (error) {
          error.textContent = message;
          error.classList.remove("hidden");
        }
      };
      if (file.size > 20 * 1024 * 1024) {
        fail("That image is over 20 MB. Resize or crop it before scanning.");
        return;
      }
      if (file.type !== "image/svg+xml" && "createImageBitmap" in window) {
        try {
          const bitmap = await createImageBitmap(file);
          const pixels = bitmap.width * bitmap.height;
          const tooLarge = bitmap.width > 12000 || bitmap.height > 12000 || pixels > 40_000_000;
          bitmap.close();
          if (tooLarge) {
            fail("That image is too large to decode safely. Keep it below 40 megapixels.");
            return;
          }
        } catch {
          // The original decoder will provide the user-facing format error.
        }
      }
      return originalDecodeFile(file);
    };
  }

  // Print only inside the usable page area and report the real tile count.
  const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], "Label 100×150": [100, 150] };
  function printPageDimensions() {
    let width;
    let height;
    const selected = $("#pPage")?.value;
    if (selected === "custom") {
      width = Number($("#pPw")?.value) || 100;
      height = Number($("#pPh")?.value) || 150;
    } else {
      [width, height] = PAGE_SIZES[selected] || PAGE_SIZES.A4;
    }
    if ($("#pOrient")?.value === "landscape") [width, height] = [height, width];
    return [width, height];
  }
  function svgRatio(svg) {
    const viewBox = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/i.exec(svg);
    if (viewBox) return Number(viewBox[1]) / Number(viewBox[2]);
    const width = /\bwidth="([\d.]+)/i.exec(svg);
    const height = /\bheight="([\d.]+)/i.exec(svg);
    return width && height ? Number(width[1]) / Number(height[1]) : 1;
  }
  const svgDataUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

  window.buildSheet = function safeBuildSheet(svg) {
    const [pageWidth, pageHeight] = printPageDimensions();
    const tiled = $("#pLayout")?.value === "tile";
    const margin = Number($(tiled ? "#pTileMargin" : "#pMargin")?.value) || 0;
    const gap = tiled ? Number($("#pGap")?.value) || 0 : 0;
    const usableWidth = Math.max(0, pageWidth - 2 * margin);
    const usableHeight = Math.max(0, pageHeight - 2 * margin);
    const ratio = Math.max(0.0001, svgRatio(svg));
    const requestedWidth = Math.max(1, Number($("#pW")?.value) || 40);
    const codeWidth = Math.max(1, Math.min(requestedWidth, usableWidth, usableHeight * ratio));
    const codeHeight = codeWidth / ratio;
    const image = `<img class="code" src="${svgDataUrl(svg)}" style="width:${codeWidth}mm;height:${codeHeight}mm">`;
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.style.width = pageWidth + "mm";
    sheet.style.height = pageHeight + "mm";

    const fits = usableWidth >= 1 && usableHeight >= 1 && codeHeight <= usableHeight;
    const printButton = $("#printGo");
    if (printButton) printButton.disabled = !fits;
    if (!fits) {
      sheet.innerHTML = '<p class="stage-empty">The code does not fit inside the selected page margins.</p>';
      const info = $("#pTileInfo");
      if (info) info.textContent = "Code does not fit";
      return sheet;
    }

    if (tiled) {
      const columns = Math.floor((usableWidth + gap) / (codeWidth + gap));
      const rows = Math.floor((usableHeight + gap) / (codeHeight + gap));
      const total = Math.max(0, columns * rows);
      const rendered = Math.min(total, 600);
      sheet.style.cssText += `;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:${gap}mm;padding:${margin}mm`;
      sheet.innerHTML = image.repeat(rendered);
      const info = $("#pTileInfo");
      if (info) info.textContent = `${columns} × ${rows} = ${rendered} per sheet${total > rendered ? " (600 limit)" : ""}`;
    } else {
      const alignment = $("#pAlign")?.value || "cc";
      const vertical = { t: "flex-start", c: "center", b: "flex-end" }[alignment[0]] || "center";
      const horizontal = { l: "flex-start", c: "center", r: "flex-end" }[alignment[1]] || "center";
      sheet.style.cssText += `;display:flex;align-items:${vertical};justify-content:${horizontal};padding:${margin}mm`;
      sheet.innerHTML = image;
    }
    return sheet;
  };

  // A failed camera switch must not leave controls pretending a stream exists.
  const cameraError = $("#camErr");
  if (cameraError) {
    new MutationObserver(() => {
      const visible = !cameraError.classList.contains("hidden") && cameraError.textContent.trim();
      const video = $("#video");
      if (visible && !video?.srcObject) {
        if ($("#camStart")) $("#camStart").disabled = false;
        if ($("#camStop")) $("#camStop").disabled = true;
        if ($("#camSwitch")) $("#camSwitch").disabled = true;
        if (video) video.style.display = "none";
      }
    }).observe(cameraError, { attributes: true, childList: true, subtree: true });
  }
})();
