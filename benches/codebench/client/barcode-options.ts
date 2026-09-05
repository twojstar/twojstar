"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const type = $("#bType");
  const textToggle = $("#bText");
  if (!type || !textToggle || typeof bwipjs === "undefined") return;

  const defaults = {
    qrcode: { ec: "M", version: "" },
    microqrcode: { ec: "L", version: "" },
    rectangularmicroqrcode: { ec: "M" },
    azteccode: { ec: "23", layers: "" },
    azteccodecompact: { ec: "23", layers: "" },
    pdf417: { ec: "", columns: "", rows: "" },
    pdf417compact: { ec: "", columns: "", rows: "" },
  };
  const state = {};
  const matrixFixed = new Set([
    "datamatrix", "datamatrixrectangular", "datamatrixrectangularextension",
    "gs1datamatrix", "gs1dldatamatrix",
  ]);

  const style = document.createElement("style");
  style.textContent = `
    #bAdvanced{margin:10px 0 14px}#bAdvanced[hidden]{display:none}
    #bAdvancedFields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #bAdvancedFields .wide{grid-column:1/-1}
    #bAdvancedNote{margin:7px 0 0;font:400 10px/1.45 "Space Mono",monospace;color:var(--muted)}
    @media(max-width:560px){#bAdvancedFields{grid-template-columns:1fr}#bAdvancedFields .wide{grid-column:auto}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement("fieldset");
  panel.id = "bAdvanced";
  panel.hidden = true;
  panel.innerHTML = '<legend>Format controls</legend><div id="bAdvancedFields"></div><p id="bAdvancedNote"></p>';
  textToggle.closest("label")?.insertAdjacentElement("afterend", panel);
  const fields = $("#bAdvancedFields");
  const note = $("#bAdvancedNote");

  function valuesFor(format) {
    if (!state[format] && defaults[format]) state[format] = { ...defaults[format] };
    return state[format] || {};
  }

  function renderBarcode() {
    queueMicrotask(() => {
      if (typeof window.renderBar === "function") window.renderBar();
    });
  }

  function makeSelect(key, label, options, value, wide = false) {
    const wrap = document.createElement("label");
    wrap.className = `f${wide ? " wide" : ""}`;
    const title = document.createElement("span");
    title.textContent = label;
    const select = document.createElement("select");
    select.dataset.advancedKey = key;
    options.forEach(([optionValue, optionLabel]) => select.add(new Option(optionLabel, optionValue)));
    select.value = value;
    wrap.append(title, select);
    return wrap;
  }

  function makeNumber(key, label, value, min, max, wide = false) {
    const wrap = document.createElement("label");
    wrap.className = `f${wide ? " wide" : ""}`;
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = value;
    input.dataset.advancedKey = key;
    wrap.append(title, input);
    return wrap;
  }

  function rebuild() {
    const format = type.value;
    fields.replaceChildren();
    note.textContent = "";

    if (matrixFixed.has(format)) {
      panel.hidden = false;
      note.textContent = "Data Matrix uses ECC200 automatically. Error correction is tied to the selected symbol size; the encoder chooses the smallest fitting size.";
      return;
    }

    if (!defaults[format]) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    const values = valuesFor(format);
    if (format === "qrcode") {
      fields.append(
        makeSelect("ec", "Error correction", [["L", "L — 7%"], ["M", "M — 15%"], ["Q", "Q — 25%"], ["H", "H — 30%"]], values.ec),
        makeNumber("version", "Version · blank = auto", values.version, 1, 40),
      );
      note.textContent = "Plain QR only. The styled QR tab has its own visual controls.";
    } else if (format === "microqrcode") {
      fields.append(
        makeSelect("ec", "Error correction", [["L", "L"], ["M", "M"], ["Q", "Q"]], values.ec),
        makeSelect("version", "Version", [["", "Auto"], ["M1", "M1"], ["M2", "M2"], ["M3", "M3"], ["M4", "M4"]], values.version),
      );
      note.textContent = "Micro QR capacity and available EC levels depend on the chosen version; invalid combinations are reported by the encoder.";
    } else if (format === "rectangularmicroqrcode") {
      fields.append(makeSelect("ec", "Error correction", [["M", "M"], ["H", "H"]], values.ec, true));
      note.textContent = "rMQR supports M and H error correction. Symbol dimensions stay automatic so the payload can choose the smallest fitting rectangle.";
    } else if (format === "azteccode" || format === "azteccodecompact") {
      const maxLayers = format === "azteccodecompact" ? 4 : 32;
      fields.append(
        makeNumber("ec", "Error correction %", values.ec, 5, 95),
        makeNumber("layers", "Layers · blank = auto", values.layers, 1, maxLayers),
      );
      note.textContent = `Aztec error correction accepts 5–95%. ${format === "azteccodecompact" ? "Compact Aztec has 1–4 layers." : "Full Aztec has up to 32 layers."}`;
    } else if (format === "pdf417" || format === "pdf417compact") {
      fields.append(
        makeSelect("ec", "Error correction", [["", "Auto"], ...Array.from({ length: 9 }, (_, index) => [String(index), `Level ${index}`])], values.ec),
        makeNumber("columns", "Columns · blank = auto", values.columns, 1, 30),
        makeNumber("rows", "Rows · blank = auto", values.rows, 3, 90),
      );
      note.textContent = "PDF417 supports EC levels 0–8, 1–30 columns and 3–90 rows. Leave dimensions blank for automatic layout.";
    }

    fields.querySelectorAll("input,select").forEach((control) => {
      const update = () => {
        values[control.dataset.advancedKey] = control.value;
        renderBarcode();
      };
      control.addEventListener("input", update);
      control.addEventListener("change", update);
    });
  }

  function advancedOptions(options) {
    const next = { ...options };
    const format = options?.bcid;
    const values = valuesFor(format);
    if (format === "qrcode") {
      next.eclevel = values.ec;
      next.fixedeclevel = true;
      if (values.version) next.version = values.version;
    } else if (format === "microqrcode") {
      next.eclevel = values.ec;
      next.fixedeclevel = true;
      if (values.version) next.version = values.version;
    } else if (format === "rectangularmicroqrcode") {
      next.eclevel = values.ec;
      next.fixedeclevel = true;
    } else if (format === "azteccode" || format === "azteccodecompact") {
      next.eclevel = Number(values.ec || 23);
      if (values.layers) next.layers = Number(values.layers);
    } else if (format === "pdf417" || format === "pdf417compact") {
      if (values.ec !== "") {
        next.eclevel = Number(values.ec);
        next.fixedeclevel = true;
      }
      if (values.columns) next.columns = Number(values.columns);
      if (values.rows) next.rows = Number(values.rows);
    }
    return next;
  }

  const originalToCanvas = bwipjs.toCanvas;
  const originalToSVG = bwipjs.toSVG;
  bwipjs.toCanvas = function codebenchToCanvas(canvas, options) {
    return originalToCanvas.call(this, canvas, advancedOptions(options));
  };
  bwipjs.toSVG = function codebenchToSVG(options) {
    return originalToSVG.call(this, advancedOptions(options));
  };

  type.addEventListener("change", () => {
    rebuild();
    renderBarcode();
  });
  rebuild();
})();
