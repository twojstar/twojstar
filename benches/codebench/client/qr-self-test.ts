"use strict";

(() => {
  const qrHost = document.querySelector("#qrHost");
  const printButton = document.querySelector("#qrPrint");
  const zxing = window.ZXingWASM;
  if (!qrHost || !printButton || !zxing?.readBarcodes) return;

  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "btn ghost";
  testButton.id = "qrTest";
  testButton.textContent = "Test QR";
  printButton.insertAdjacentElement("beforebegin", testButton);

  const status = document.createElement("div");
  status.id = "qrTestStatus";
  status.className = "qr-test-status";
  status.dataset.state = "idle";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.innerHTML = "<b>Not tested</b><span>Checks the current rendered QR locally.</span>";
  printButton.closest(".btn-row")?.insertAdjacentElement("afterend", status);

  const style = document.createElement("style");
  style.textContent = `
    .qr-test-status {
      display: flex;
      gap: 8px;
      align-items: baseline;
      min-height: 20px;
      margin-top: 9px;
      font-size: 12px;
    }
    .qr-test-status b { white-space: nowrap; }
    .qr-test-status span { color: var(--muted, #68655b); }
    .qr-test-status[data-state="success"] b { color: #187243; }
    .qr-test-status[data-state="warning"] b { color: #9a5a00; }
    .qr-test-status[data-state="failure"] b { color: #b3261e; }
    @media (max-width: 560px) {
      .qr-test-status { display: block; }
      .qr-test-status span { display: block; margin-top: 2px; }
    }
  `;
  document.head.appendChild(style);

  let testing = false;
  let testedSignature = "";
  let renderGeneration = 0;

  function setStatus(state, title, detail) {
    status.dataset.state = state;
    status.replaceChildren();
    const heading = document.createElement("b");
    heading.textContent = title;
    const message = document.createElement("span");
    message.textContent = detail;
    status.append(heading, message);
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function dimensions(svg) {
    const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = documentNode.documentElement;
    const width = Number.parseFloat(root.getAttribute("width") || "");
    const height = Number.parseFloat(root.getAttribute("height") || "");
    if (width > 0 && height > 0) return [width, height];

    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return [viewBox[2], viewBox[3]];
    return [600, 600];
  }

  async function currentRenderedSVG() {
    if (typeof window.codebenchCurrentQrSvg === "function") return window.codebenchCurrentQrSvg();
    if (typeof window.qrBareSVG !== "function") throw new Error("QR renderer is unavailable.");
    const bare = await window.qrBareSVG();
    if (!bare) throw new Error("QR render is empty.");
    if (!document.querySelector("#qFrame")?.checked) return bare;
    if (typeof window.frameSVG !== "function" || typeof window.frameOpts !== "function") return bare;
    return window.frameSVG(bare, window.frameOpts());
  }

  async function rasterize(svg, background) {
    if (typeof window.codebenchSvgToPngBlob === "function") {
      return window.codebenchSvgToPngBlob(svg, { background, maxSide: 1200 });
    }

    const [sourceWidth, sourceHeight] = dimensions(svg);
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const scale = Math.min(2, Math.max(0.5, 1200 / largestSide));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Could not rasterize the QR."));
        image.src = url;
      });
      context.drawImage(image, 0, 0, width, height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The browser did not produce a PNG."));
        }, "image/png");
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function decode(svg) {
    const transparent = Boolean(document.querySelector("#qTransparent")?.checked);
    const backgrounds = transparent
      ? [["#ffffff", "white"], ["#111111", "dark"]]
      : [["#ffffff", "rendered"]];

    for (const [background, label] of backgrounds) {
      const png = await rasterize(svg, background);
      const results = await zxing.readBarcodes(png, {
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        tryDownscale: true,
        maxNumberOfSymbols: 1,
      });
      const result = results?.find((entry) => entry.isValid && typeof entry.text === "string");
      if (result) return { text: result.text, background: label };
    }
    return null;
  }

  function currentSignature(svg, expected) {
    let hash = 2166136261;
    const input = `${expected}\u0000${svg}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  async function prepareDecoder() {
    if (typeof window.zxReady === "function") {
      await window.zxReady();
      return;
    }
    if (typeof zxing.prepareZXingModule === "function") {
      await zxing.prepareZXingModule({ fireImmediately: true });
    }
  }

  function markTestStale(detail = "The QR changed since the last test.") {
    testedSignature = "";
    setStatus("idle", "Not tested", detail);
  }

  async function runTest() {
    if (testing) return;
    testing = true;
    testButton.disabled = true;
    setStatus("idle", "Testing…", "Decoding the current render in this browser.");

    try {
      await prepareDecoder();
      const generation = renderGeneration;
      const svg = await currentRenderedSVG();
      const expected = typeof window.buildContent === "function" ? (window.buildContent() || " ") : "";
      if (generation !== renderGeneration) {
        markTestStale("The QR changed during the test.");
        return;
      }

      const signature = currentSignature(svg, expected);
      const result = await decode(svg);
      if (generation !== renderGeneration) {
        markTestStale("The QR changed during the test.");
        return;
      }

      if (!result) {
        testedSignature = signature;
        setStatus(
          "failure",
          "Could not decode",
          "Try more quiet zone, higher error correction, a smaller logo, or simpler modules.",
        );
        return;
      }

      testedSignature = signature;
      if (normalizeText(result.text) !== normalizeText(expected)) {
        setStatus("warning", "Content differs", "The QR is readable, but the decoded value is not an exact match.");
        return;
      }

      const backgroundNote = result.background === "white"
        ? " Readable on a white background."
        : result.background === "dark"
          ? " Readable on a dark background."
          : "";
      setStatus("success", "Readable", `Decoded value matches exactly.${backgroundNote}`);
    } catch (error) {
      console.error("QR self-test failed", error);
      testedSignature = "";
      setStatus("failure", "Test failed", "The local decoder could not test this render.");
    } finally {
      testing = false;
      testButton.disabled = false;
    }
  }

  function markChanged() {
    renderGeneration += 1;
    if (testing || !testedSignature) return;
    markTestStale();
  }

  testButton.addEventListener("click", runTest);
  new MutationObserver(markChanged).observe(qrHost, {
    attributes: true,
    childList: true,
    subtree: true,
  });
})();
