"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const type = $("#bType");
  const data = $("#bData");
  const hint = $("#bHint");
  const error = $("#bErr");
  const structured = window.codebenchStructuredPayloads;
  if (!type || !data || !hint) return;

  const freeTextFormats = new Set([
    "qrcode", "microqrcode", "rectangularmicroqrcode",
    "datamatrix", "datamatrixrectangular", "datamatrixrectangularextension",
    "azteccode", "azteccodecompact", "pdf417", "pdf417compact", "micropdf417",
    "dotcode", "hanxin", "codablockf", "code16k",
  ]);

  const formatInfo = {
    code128: ["Arbitrary text; broad ASCII/UTF-8 support.", "CODE-BENCH-128"],
    ean13: ["12 or 13 digits. With 13 digits, the last digit must be the correct check digit.", "5901234123457", /^\d{12,13}$/],
    ean8: ["7 or 8 digits. With 8 digits, the last digit must be the correct check digit.", "96385074", /^\d{7,8}$/],
    upca: ["11 or 12 digits. With 12 digits, the last digit must be the correct check digit.", "036000291452", /^\d{11,12}$/],
    upce: ["7 or 8 digits, number system 0 or 1. Some UPC-A values can also be compressed to UPC-E.", "04252614", /^[01]\d{6,7}$/],
    code39: ["Uppercase A-Z, digits, space and - . $ / + %.", "CODE-39", /^[0-9A-Z .$/+%-]+$/],
    itf14: ["13 or 14 digits. A 13-digit value gets its check digit added automatically.", "1001234500001", /^\d{13,14}$/],
    interleaved2of5: ["Digits only, with an even number of digits.", "12345678", (value) => /^\d+$/.test(value) && value.length % 2 === 0],
    codabar: ["Digits and - $ : / . +, normally wrapped in A-D start/stop characters.", "A123456A", /^[A-D][0-9$:+./-]+[A-D]$/],
    code93: ["Uppercase alphanumeric plus Code 93 punctuation.", "CODE93"],
    msi: ["Digits only.", "123456", /^\d+$/],
    pharmacode: ["Integer from 3 to 131070.", "12345", (value) => /^\d+$/.test(value) && +value >= 3 && +value <= 131070],
    "gs1-128": ["GS1 Application Identifier syntax, for example (01)…(17)… .", "(01)09521234543213(17)260101"],
    code11: ["Digits and hyphens.", "12345-67", /^[0-9-]+$/],
    isbn: ["ISBN-10 or ISBN-13; hyphenated forms are accepted.", "978-1-56581-231-4"],
    pzn: ["German pharmaceutical PZN. The encoder validates length and check digit.", ""],
    telepen: ["ASCII text.", "CODEBENCH"],
    datamatrix: ["Arbitrary text or bytes. Good general-purpose compact 2D carrier.", "Hello Data Matrix"],
    datamatrixrectangular: ["Arbitrary text; rectangular Data Matrix sizes.", "Hello rectangular DM"],
    datamatrixrectangularextension: ["Arbitrary text; extended rectangular Data Matrix sizes (DMRE).", "Hello DMRE"],
    azteccode: ["Arbitrary text or bytes. No traditional quiet zone required.", "Hello Aztec"],
    azteccodecompact: ["Arbitrary short payloads in compact Aztec form.", "Compact Aztec"],
    aztecrune: ["A single integer from 0 to 255.", "42", (value) => /^\d+$/.test(value) && +value <= 255],
    pdf417: ["Arbitrary text or bytes; high-capacity stacked 2D code.", "Hello PDF417"],
    pdf417compact: ["Arbitrary text; compact PDF417 row indicators.", "Compact PDF417"],
    micropdf417: ["Arbitrary short payloads; compact stacked 2D code.", "MicroPDF417"],
    microqrcode: ["Short payloads only; capacity depends strongly on version and error correction.", "micro"],
    rectangularmicroqrcode: ["Short payloads; rectangular Micro QR (rMQR).", "rMQR"],
    maxicode: ["Fixed-size MaxiCode. Plain text is supported; structured carrier modes have additional rules.", "MaxiCode"],
    dotcode: ["Arbitrary data; dotted 2D symbology suited to high-speed printing.", "DotCode"],
    hanxin: ["Arbitrary text; Han Xin 2D matrix.", "Han Xin"],
    codablockf: ["Text encoded as stacked Code 128.", "Codablock F"],
    code16k: ["Text encoded in 2-16 stacked rows.", "Code 16K"],
    gs1datamatrix: ["GS1 Application Identifier syntax, for example (01)… .", "(01)09521234543213"],
    gs1dlqrcode: ["A GS1 Digital Link URI, usually https://…/01/<GTIN>… .", "https://id.gs1.org/01/09521234543213"],
    gs1dldatamatrix: ["A GS1 Digital Link URI encoded as Data Matrix.", "https://id.gs1.org/01/09521234543213"],
    databaromni: ["GS1 DataBar Omnidirectional. GTIN data; encoder checks length/check digit.", ""],
    databarlimited: ["GS1 DataBar Limited. Restricted GTIN range; encoder checks the value.", ""],
    databarexpanded: ["GS1 Application Identifier data; variable length.", "(01)09521234543213(17)260101"],
    postnet: ["US ZIP: 5, 9 or 11 digits.", "12345"],
    onecode: ["USPS Intelligent Mail: tracking code plus optional routing code.", ""],
    royalmail: ["Royal Mail RM4SCC alphanumeric customer code.", "SN34RD1A"],
    kix: ["PostNL KIX alphanumeric customer code.", "1231FZ13XHS"],
    auspost: ["Australia Post customer barcode. Format depends on FCC and customer data.", ""],
    japanpost: ["Japan Post customer barcode: postal code plus address data.", ""],
  };

  const style = document.createElement("style");
  style.textContent = `
    .barcode-assist{margin:0 0 14px;padding:12px;border:1px solid var(--line);background:var(--paper)}
    .barcode-assist .row{align-items:end}.barcode-assist-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .barcode-assist-fields .wide{grid-column:1/-1}.barcode-assist-note{margin:7px 0 0;font:400 10px/1.45 "Space Mono",monospace;color:var(--muted)}
    .barcode-requirement{margin:-6px 0 14px;padding:9px 10px;border-left:3px solid var(--line);background:var(--panel-2);font:400 11px/1.45 "Space Mono",monospace;color:var(--muted)}
    .barcode-requirement b{color:var(--ink)}.barcode-requirement.bad{border-left-color:var(--accent);color:var(--accent-ink)}
    .encoder-error{margin-top:5px}
    @media(max-width:560px){.barcode-assist-fields{grid-template-columns:1fr}.barcode-assist-fields .wide{grid-column:auto}}
  `;
  document.head.appendChild(style);

  const dataLabel = data.closest("label");
  const assist = document.createElement("div");
  assist.className = "barcode-assist";
  assist.innerHTML = `
    <label class="f"><span>Payload</span>
      <select id="bPayloadType">
        <option value="raw">Raw data</option>
        <option value="url">URL</option>
        <option value="wifi">Wi-Fi</option>
        <option value="vcard">Contact / vCard</option>
        <option value="event">Calendar event</option>
        <option value="email">Email</option>
        <option value="sms">SMS</option>
        <option value="tel">Phone</option>
        <option value="geo">Location</option>
      </select>
    </label>
    <div id="bPayloadFields" class="barcode-assist-fields"></div>
    <p id="bPayloadNote" class="barcode-assist-note"></p>`;
  dataLabel?.insertAdjacentElement("beforebegin", assist);

  const requirement = document.createElement("div");
  requirement.id = "bRequirement";
  requirement.className = "barcode-requirement";
  const requirementBody = document.createElement("div");
  const encoderError = document.createElement("div");
  encoderError.className = "encoder-error";
  encoderError.hidden = true;
  requirement.append(requirementBody, encoderError);
  hint.insertAdjacentElement("afterend", requirement);

  const payloadType = $("#bPayloadType");
  const fieldsHost = $("#bPayloadFields");
  const payloadNote = $("#bPayloadNote");

  const field = (key, label, options = {}) => {
    const wrap = document.createElement("label");
    wrap.className = `f${options.wide ? " wide" : ""}`;
    const input = document.createElement(options.area ? "textarea" : options.select ? "select" : "input");
    input.dataset.payloadKey = key;
    if (!options.area && !options.select) input.type = options.type || "text";
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.select) options.select.forEach(([value, text]) => input.add(new Option(text, value)));
    wrap.innerHTML = `<span>${label}</span>`;
    wrap.appendChild(input);
    return wrap;
  };

  const schemas = {
    url: () => [field("url", "URL", { wide: true, type: "url", placeholder: "https://example.com" })],
    wifi: () => [
      field("ssid", "Network name (SSID)", { placeholder: "MyNetwork" }),
      field("security", "Security", { select: [["WPA", "WPA / WPA2"], ["WEP", "WEP"], ["nopass", "Open / no password"]] }),
      field("password", "Password", { wide: true, type: "password" }),
      field("hidden", "Hidden network", { select: [["false", "No"], ["true", "Yes"]] }),
    ],
    vcard: () => [
      field("name", "Name", { wide: true }), field("org", "Organization"), field("phone", "Phone", { type: "tel" }),
      field("email", "Email", { type: "email" }), field("url", "URL", { type: "url" }),
    ],
    event: () => [
      field("title", "Title", { wide: true }), field("start", "Start", { type: "datetime-local" }), field("end", "End", { type: "datetime-local" }),
      field("location", "Location", { wide: true }),
    ],
    email: () => [
      field("to", "To", { wide: true, type: "email" }), field("subject", "Subject", { wide: true }), field("body", "Message", { wide: true, area: true }),
    ],
    sms: () => [field("number", "Number", { type: "tel" }), field("message", "Message", { wide: true, area: true })],
    tel: () => [field("number", "Number", { wide: true, type: "tel" })],
    geo: () => [field("lat", "Latitude", { placeholder: "52.23" }), field("lng", "Longitude", { placeholder: "21.01" })],
  };

  const escapeWifi = (value) => String(value || "").replace(/[\\;,\":]/g, (match) => `\\${match}`);

  function values() {
    return Object.fromEntries(Array.from(fieldsHost.querySelectorAll("[data-payload-key]")).map((element) => [element.dataset.payloadKey, element.value]));
  }

  function buildPayload() {
    const kind = payloadType.value;
    if (kind === "raw") return data.value;
    const v = values();
    if (kind === "url") return v.url || "";
    if (kind === "wifi") {
      const parts = [`T:${v.security || "WPA"}`, `S:${escapeWifi(v.ssid)}`];
      if (v.security !== "nopass") parts.push(`P:${escapeWifi(v.password)}`);
      if (v.hidden === "true") parts.push("H:true");
      return `WIFI:${parts.join(";")};;`;
    }
    if (kind === "vcard") {
      return structured?.buildVCard({
        fn: v.name, org: v.org, phone: v.phone, email: v.email, url: v.url,
      }) || "";
    }
    if (kind === "event") {
      return structured?.buildCalendarEvent({
        title: v.title, loc: v.location, start: v.start, end: v.end,
      }) || "";
    }
    if (kind === "email") {
      const params = [];
      if (v.subject) params.push(`subject=${encodeURIComponent(v.subject)}`);
      if (v.body) params.push(`body=${encodeURIComponent(v.body)}`);
      return `mailto:${v.to || ""}${params.length ? `?${params.join("&")}` : ""}`;
    }
    if (kind === "sms") return `SMSTO:${v.number || ""}:${v.message || ""}`;
    if (kind === "tel") return `tel:${v.number || ""}`;
    if (kind === "geo") return `geo:${v.lat || ""},${v.lng || ""}`;
    return data.value;
  }

  function updatePayloadData() {
    if (payloadType.value === "raw") return;
    data.value = buildPayload();
    data.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function rebuildPayloadFields() {
    const kind = payloadType.value;
    fieldsHost.replaceChildren();
    if (kind !== "raw") (schemas[kind]?.() || []).forEach((element) => fieldsHost.appendChild(element));
    data.readOnly = kind !== "raw";
    data.title = kind === "raw" ? "" : "Generated from the structured payload fields above";
    fieldsHost.querySelectorAll("input,textarea,select").forEach((element) => element.addEventListener("input", updatePayloadData));
    updatePayloadData();
    updateCompatibility();
  }

  function updateCompatibility() {
    const structuredPayload = payloadType.value !== "raw";
    const carrier = type.value;
    if (!structuredPayload) {
      payloadNote.textContent = "Structured payloads are just text conventions. Pick Wi-Fi, vCard, event, etc. to generate the raw payload for the selected symbol.";
      return;
    }
    if (!freeTextFormats.has(carrier)) {
      payloadNote.textContent = "This symbology does not accept arbitrary structured text. Choose QR, Data Matrix, Aztec, PDF417, rMQR or another free-text 2D/stacked format.";
      return;
    }
    payloadNote.textContent = carrier === "qrcode"
      ? "QR has the broadest native phone support for actions such as Join Wi-Fi or Add contact."
      : "The same payload is encoded here, but reader behavior varies. ZXing-style readers can interpret structured text after decoding; some stock phone cameras may only show the raw text outside QR.";
  }

  function validByRule(rule, value) {
    if (!rule || !value) return true;
    if (rule instanceof RegExp) return rule.test(value);
    if (typeof rule === "function") return rule(value);
    return true;
  }

  let ruleInvalid = false;
  let encoderInvalid = false;
  function syncRequirementState() {
    requirement.classList.toggle("bad", ruleInvalid || encoderInvalid);
  }

  let previousSample = "CODE-BENCH-128";
  function updateRequirement({ seed = false } = {}) {
    const [text = "The encoder validates this format.", sample = "", rule] = formatInfo[type.value] || [];
    if (seed && sample && (!data.value.trim() || data.value === previousSample) && payloadType.value === "raw") {
      data.value = sample;
      data.dispatchEvent(new Event("input", { bubbles: true }));
    }
    previousSample = sample;
    const valid = validByRule(rule, data.value.trim());
    ruleInvalid = !valid;
    requirementBody.innerHTML = `<b>Input:</b> ${text}${sample ? ` <span>Example: <code>${sample.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</code></span>` : ""}${valid ? "" : " <b>Current value does not match.</b>"}`;
    syncRequirementState();
    updateCompatibility();
  }

  function updateEncoderError() {
    encoderInvalid = Boolean(error && !error.classList.contains("hidden") && error.textContent.trim());
    encoderError.hidden = !encoderInvalid;
    encoderError.replaceChildren();
    if (encoderInvalid) {
      const label = document.createElement("b");
      label.textContent = "Encoder:";
      encoderError.append(label, document.createTextNode(` ${error.textContent.trim()}`));
    }
    syncRequirementState();
  }

  payloadType.addEventListener("change", rebuildPayloadFields);
  type.addEventListener("change", () => updateRequirement({ seed: true }));
  data.addEventListener("input", () => updateRequirement());

  if (error) {
    new MutationObserver(updateEncoderError)
      .observe(error, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    updateEncoderError();
  }

  rebuildPayloadFields();
  updateRequirement();
})();
