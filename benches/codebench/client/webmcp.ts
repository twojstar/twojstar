"use strict";

(() => {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const ui = globalThis.CodeBenchUi;
  if (!ui) return;

  const lifecycle = new AbortController();
  const register = (tool) => {
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal }))
        .catch((error) => console.warn("Codebench WebMCP registration failed", error));
    } catch (error) {
      console.warn("Codebench WebMCP registration failed", error);
    }
  };

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) lifecycle.abort();
  });

  const byId = (id) => document.getElementById(id);
  const text = (value) => String(value ?? "");
  const colors = /^#[0-9a-f]{6}$/i;
  const qrTemplates = new Set([
    "url", "text", "wifi", "vcard", "email", "sms", "tel", "geo", "event",
  ]);
  const qrFieldNames = new Set([
    "url", "text", "ssid", "pass", "enc", "hidden", "fn", "org", "title",
    "phone", "email", "adr", "to", "subject", "body", "num", "msg", "lat",
    "lng", "loc", "start", "end",
  ]);
  const stringField = { type: "string", maxLength: 10000 };
  const colorField = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
  const responseFieldLimit = 10000;
  const qrRenderTimeoutMs = 3000;

  const activeWorkspace = () =>
    document.querySelector('.tab[aria-selected="true"]')?.dataset.tab || "scan";

  function readQrFields() {
    const result = {};
    document.querySelectorAll('#qrFields [id^="f_"]').forEach((element) => {
      const key = element.id.slice(2);
      result[key] = element.type === "checkbox" ? element.checked : element.value;
    });
    return result;
  }

  function boundedQrFields(fields) {
    const values = {};
    const truncatedFields = [];
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") {
        values[key] = value.slice(0, responseFieldLimit);
        if (value.length > responseFieldLimit) truncatedFields.push(key);
      } else {
        values[key] = value;
      }
    }
    return { values, truncatedFields };
  }

  function snapshot(includePayload = false) {
    const barcodeType = byId("bType");
    const barcodeError = byId("bErr");
    const barcodeData = text(byId("bData")?.value);
    const scanResult = byId("result");
    const scanText = text(byId("resVal")?.textContent);
    const qrFields = readQrFields();
    const qrContent = text(ui.getContent());
    const result = {
      workspace: activeWorkspace(),
      qr: {
        template: ui.getQrTemplate(),
        status: text(byId("qrStat")?.textContent),
        fields: Object.keys(qrFields),
        characters: qrContent.length,
        style: {
          errorCorrection: byId("qEc")?.value || "",
          size: Number(byId("qSize")?.value || 0),
          margin: Number(byId("qMargin")?.value || 0),
          foreground: byId("qFg")?.value || "",
          background: byId("qBg")?.value || "",
          transparent: Boolean(byId("qTransparent")?.checked),
        },
      },
      barcode: {
        format: barcodeType?.value || "",
        formatLabel: barcodeType?.selectedOptions?.[0]?.textContent || "",
        status: text(byId("bStat")?.textContent),
        valid: Boolean(barcodeError?.classList.contains("hidden")),
        error: barcodeError?.classList.contains("hidden") ? "" : text(barcodeError?.textContent),
        characters: barcodeData.length,
        scale: Number(byId("bScale")?.value || 0),
        height: Number(byId("bHeight")?.value || 0),
        showText: Boolean(byId("bText")?.checked),
        transparent: Boolean(byId("bTransparent")?.checked),
      },
      scan: scanResult?.classList.contains("show") ? {
        format: text(byId("resFmt")?.textContent),
        characters: scanText.length,
      } : null,
    };
    if (includePayload) {
      result.qr.content = qrContent.slice(0, 50000);
      result.qr.contentTruncated = qrContent.length > 50000;
      const boundedFields = boundedQrFields(qrFields);
      result.qr.fieldValues = boundedFields.values;
      result.qr.truncatedFields = boundedFields.truncatedFields;
      result.barcode.data = barcodeData.slice(0, 50000);
      result.barcode.dataTruncated = barcodeData.length > 50000;
      if (result.scan) {
        result.scan.text = scanText.slice(0, 50000);
        result.scan.textTruncated = scanText.length > 50000;
      }
    }
    return result;
  }

  function colorError(name, value) {
    if (value !== undefined && (typeof value !== "string" || !colors.test(value))) {
      return `${name} must be a #RRGGBB color.`;
    }
    return "";
  }

  function currentQrStyle() {
    return {
      errorCorrection: byId("qEc")?.value || "Q",
      size: Number(byId("qSize")?.value || 600),
      margin: Number(byId("qMargin")?.value || 0),
      foreground: byId("qFg")?.value || "#000000",
      background: byId("qBg")?.value || "#ffffff",
      transparent: Boolean(byId("qTransparent")?.checked),
    };
  }

  function applyQrFields(fields) {
    const ignored = [];
    for (const [key, value] of Object.entries(fields)) {
      const element = byId(`f_${key}`);
      if (!element) ignored.push(key);
      else if (element.type === "checkbox") element.checked = value;
      else element.value = value;
    }
    return ignored;
  }

  function applyQrStyle(style) {
    const ec = byId("qEc");
    const size = byId("qSize");
    const margin = byId("qMargin");
    const foreground = byId("qFg");
    const background = byId("qBg");
    const transparent = byId("qTransparent");
    if (style.errorCorrection !== undefined && ec) ec.value = style.errorCorrection;
    if (style.size !== undefined && size) size.value = String(style.size);
    if (style.margin !== undefined && margin) margin.value = String(style.margin);
    if (style.foreground !== undefined && foreground) foreground.value = style.foreground;
    if (style.background !== undefined && background) background.value = style.background;
    if (style.transparent !== undefined && transparent) {
      transparent.checked = style.transparent;
      if (background) background.disabled = style.transparent;
    }
  }

  function missingControls(ids) {
    return ids.filter((id) => !byId(id));
  }

  async function waitForQrRendered() {
    let timer;
    try {
      await Promise.race([
        Promise.resolve(ui.ensureQrRendered()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("QR rendering timed out.")), qrRenderTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function restoreQr(previous) {
    ui.pickTemplate(previous.template, false);
    applyQrFields(previous.fields);
    applyQrStyle(previous.style);
    try {
      ui.renderQR(previous.content || ui.buildContent() || " ");
      await waitForQrRendered();
    } finally {
      ui.goTab(previous.workspace);
    }
  }

  register({
    name: "read_code_state",
    title: "Read Codebench state",
    description: "Read the current QR, barcode and latest scanner state without changing the Codebench UI.",
    inputSchema: {
      type: "object",
      properties: { includePayload: { type: "boolean", default: false } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute({ includePayload = false } = {}) {
      if (typeof includePayload !== "boolean") {
        return { ok: false, error: "includePayload must be a boolean." };
      }
      return { ok: true, ...snapshot(includePayload) };
    },
  });

  const qrFieldSchema = Object.fromEntries([...qrFieldNames].map((key) => [key, stringField]));
  qrFieldSchema.hidden = { type: "boolean" };
  qrFieldSchema.enc = { type: "string", enum: ["WPA", "WEP", "nopass"] };

  register({
    name: "set_qr_code",
    title: "Set Codebench QR code",
    description: "Fill a QR template and optionally adjust basic styling through the visible Codebench UI.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", enum: [...qrTemplates] },
        fields: { type: "object", properties: qrFieldSchema, additionalProperties: false },
        style: {
          type: "object",
          properties: {
            errorCorrection: { type: "string", enum: ["L", "M", "Q", "H"] },
            size: { type: "integer", minimum: 120, maximum: 2000 },
            margin: { type: "integer", minimum: 0, maximum: 80 },
            foreground: colorField,
            background: colorField,
            transparent: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["template"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute({ template, fields = {}, style = {} } = {}) {
      if (!qrTemplates.has(template)) return { ok: false, error: "Unsupported QR template." };
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        return { ok: false, error: "fields must be an object." };
      }
      if (!style || typeof style !== "object" || Array.isArray(style)) {
        return { ok: false, error: "style must be an object." };
      }
      for (const [key, value] of Object.entries(fields)) {
        if (!qrFieldNames.has(key)) return { ok: false, error: `Unsupported QR field: ${key}.` };
        if (key === "hidden") {
          if (typeof value !== "boolean") return { ok: false, error: "hidden must be a boolean." };
        } else if (typeof value !== "string" || value.length > 10000) {
          return { ok: false, error: `${key} must be a string of at most 10000 characters.` };
        }
      }
      if (fields.enc !== undefined && !["WPA", "WEP", "nopass"].includes(fields.enc)) {
        return { ok: false, error: "enc must be WPA, WEP or nopass." };
      }
      if (style.errorCorrection !== undefined && !["L", "M", "Q", "H"].includes(style.errorCorrection)) {
        return { ok: false, error: "errorCorrection must be L, M, Q or H." };
      }
      if (style.size !== undefined && (!Number.isInteger(style.size) || style.size < 120 || style.size > 2000)) {
        return { ok: false, error: "size must be an integer from 120 to 2000." };
      }
      if (style.margin !== undefined && (!Number.isInteger(style.margin) || style.margin < 0 || style.margin > 80)) {
        return { ok: false, error: "margin must be an integer from 0 to 80." };
      }
      const invalidColor = colorError("foreground", style.foreground)
        || colorError("background", style.background);
      if (invalidColor) return { ok: false, error: invalidColor };
      if (style.transparent !== undefined && typeof style.transparent !== "boolean") {
        return { ok: false, error: "transparent must be a boolean." };
      }

      const missingQrControls = missingControls(["qEc", "qSize", "qMargin", "qFg", "qBg", "qTransparent"]);
      if (missingQrControls.length) {
        return { ok: false, error: `Codebench QR controls are unavailable: ${missingQrControls.join(", ")}.` };
      }

      const previous = {
        workspace: activeWorkspace(),
        template: ui.getQrTemplate(),
        fields: readQrFields(),
        style: currentQrStyle(),
        content: text(ui.getContent()),
      };
      ui.pickTemplate(template, false);
      const ignoredFields = applyQrFields(fields);
      applyQrStyle(style);
      const content = text(ui.buildContent()) || " ";
      ui.goTab("qr");
      try {
        ui.renderQR(content);
        await waitForQrRendered();
      } catch (error) {
        try {
          await restoreQr(previous);
        } catch (restoreError) {
          return {
            ok: false,
            error: `QR render failed: ${error?.message || error}. Restore also failed: ${restoreError?.message || restoreError}.`,
          };
        }
        return { ok: false, error: `QR render failed: ${error?.message || error}.` };
      }
      const state = snapshot(false);
      return { ok: true, ignoredFields, workspace: state.workspace, qr: state.qr };
    },
  });

  register({
    name: "set_barcode",
    title: "Set Codebench barcode",
    description: "Set a barcode or 2D payload and optional rendering controls through the visible Codebench UI.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", maxLength: 64 },
        data: stringField,
        showText: { type: "boolean" },
        scale: { type: "integer", minimum: 1, maximum: 8 },
        height: { type: "integer", minimum: 5, maximum: 40 },
        foreground: colorField,
        background: colorField,
        transparent: { type: "boolean" },
      },
      required: ["format", "data"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute({ format, data, showText, scale, height, foreground, background, transparent } = {}) {
      const missingBarcodeControls = missingControls([
        "bType", "bData", "bText", "bScale", "bHeight", "bFg", "bBg", "bTransparent", "bErr",
      ]);
      if (missingBarcodeControls.length) {
        return { ok: false, error: `Codebench barcode controls are unavailable: ${missingBarcodeControls.join(", ")}.` };
      }
      const formatSelect = byId("bType");
      const formats = new Set(Array.from(formatSelect.options, (option) => option.value));
      if (typeof format !== "string" || !formats.has(format)) {
        return { ok: false, error: "Unsupported barcode format." };
      }
      if (typeof data !== "string" || data.length > 10000) {
        return { ok: false, error: "data must be a string of at most 10000 characters." };
      }
      if (showText !== undefined && typeof showText !== "boolean") {
        return { ok: false, error: "showText must be a boolean." };
      }
      if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 8)) {
        return { ok: false, error: "scale must be an integer from 1 to 8." };
      }
      if (height !== undefined && (!Number.isInteger(height) || height < 5 || height > 40)) {
        return { ok: false, error: "height must be an integer from 5 to 40." };
      }
      const invalidColor = colorError("foreground", foreground) || colorError("background", background);
      if (invalidColor) return { ok: false, error: invalidColor };
      if (transparent !== undefined && typeof transparent !== "boolean") {
        return { ok: false, error: "transparent must be a boolean." };
      }
      const previous = {
        workspace: activeWorkspace(),
        format: formatSelect.value,
        data: byId("bData").value,
        showText: byId("bText").checked,
        scale: byId("bScale").value,
        height: byId("bHeight").value,
        foreground: byId("bFg").value,
        background: byId("bBg").value,
        transparent: byId("bTransparent").checked,
      };
      if (showText !== undefined) byId("bText").checked = showText;
      if (scale !== undefined) byId("bScale").value = String(scale);
      if (height !== undefined) byId("bHeight").value = String(height);
      if (foreground !== undefined) byId("bFg").value = foreground;
      if (background !== undefined) byId("bBg").value = background;
      if (transparent !== undefined) byId("bTransparent").checked = transparent;
      formatSelect.value = format;
      formatSelect.dataset.codebenchToolWrite = "true";
      try {
        formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
      } finally {
        delete formatSelect.dataset.codebenchToolWrite;
      }
      byId("bData").value = data;
      byId("bData").dispatchEvent(new Event("input", { bubbles: true }));
      ui.goTab("bar");

      const barcodeError = byId("bErr");
      const ok = Boolean(barcodeError?.classList.contains("hidden"));
      if (!ok) {
        const error = text(barcodeError?.textContent);
        byId("bData").value = previous.data;
        byId("bText").checked = previous.showText;
        byId("bScale").value = previous.scale;
        byId("bHeight").value = previous.height;
        byId("bFg").value = previous.foreground;
        byId("bBg").value = previous.background;
        byId("bTransparent").checked = previous.transparent;
        formatSelect.value = previous.format;
        formatSelect.dataset.codebenchToolWrite = "true";
        try {
          formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
        } finally {
          delete formatSelect.dataset.codebenchToolWrite;
        }
        byId("bData").value = previous.data;
        byId("bData").dispatchEvent(new Event("input", { bubbles: true }));
        ui.goTab(previous.workspace);
        const restored = snapshot(false);
        return { ok: false, error, workspace: restored.workspace, barcode: restored.barcode };
      }
      const state = snapshot(false);
      return { ok: true, error: "", workspace: state.workspace, barcode: state.barcode };
    },
  });

  register({
    name: "export_code",
    title: "Export Codebench code",
    description: "Start a PNG or SVG download for the current QR code or barcode using Codebench's existing controls.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["qr", "barcode"] },
        format: { type: "string", enum: ["png", "svg"] },
      },
      required: ["kind", "format"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute({ kind, format } = {}) {
      if (!["qr", "barcode"].includes(kind)) return { ok: false, error: "kind must be qr or barcode." };
      if (!["png", "svg"].includes(format)) return { ok: false, error: "format must be png or svg." };
      if (kind === "barcode" && !byId("bErr")?.classList.contains("hidden")) {
        return { ok: false, error: text(byId("bErr")?.textContent) || "Fix the barcode data first." };
      }
      if (kind === "qr") {
        if (!ui.hasQr()) return { ok: false, error: "Render a QR code first." };
        try {
          await waitForQrRendered();
        } catch (error) {
          return { ok: false, error: `QR export is not ready: ${error?.message || error}.` };
        }
      }
      const buttonId = kind === "qr"
        ? (format === "png" ? "qrPng" : "qrSvg")
        : (format === "png" ? "bPng" : "bSvg");
      const button = byId(buttonId);
      if (!button) return { ok: false, error: "Export control is not ready." };
      ui.goTab(kind === "qr" ? "qr" : "bar");
      button.click();
      return { ok: true, started: true };
    },
  });
})();
