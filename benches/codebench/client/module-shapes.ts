"use strict";

(() => {
  const customShapes = new Set(["heart", "star", "diamond", "plus"]);
  const dotSelect = document.querySelector("#qDot");
  const cornerSquareSelect = document.querySelector("#qCornerSq");
  const cornerDotSelect = document.querySelector("#qCornerDot");
  const originalQrOptions = window.qrOptions;
  const originalRenderQR = window.renderQR;
  const originalBareSVG = window.qrBareSVG;
  const originalCurrentSVG = window.currentSVG;
  const originalOpenPrint = window.openPrint;

  if (!dotSelect || typeof originalQrOptions !== "function" || typeof originalBareSVG !== "function") return;

  [
    ["heart", "Heart"],
    ["star", "Star"],
    ["diamond", "Diamond"],
    ["plus", "Plus"],
  ].forEach(([value, label]) => {
    if (!dotSelect.querySelector(`option[value="${value}"]`)) dotSelect.add(new Option(label, value));
  });

  const hint = document.createElement("p");
  hint.id = "qDecorativeShapeHint";
  hint.className = "hint";
  hint.style.margin = "7px 0 0";
  hint.style.display = "none";
  hint.textContent = "Decorative modules reduce scan tolerance; finder layout stays standard. Test before printing.";
  dotSelect.insertAdjacentElement("afterend", hint);

  let printSource = null;
  let previewGeneration = 0;

  function currentShape() {
    return dotSelect.value;
  }

  function isCustomShape() {
    return customShapes.has(currentShape());
  }

  function numberAttribute(element, name) {
    return Number.parseFloat(element.getAttribute(name) || "0");
  }

  function starPath(x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const outer = size * 0.46;
    const inner = size * 0.21;
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
    }
    return `M${points.join("L")}Z`;
  }

  function shapePath(shape, x, y, size) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const inset = size * 0.08;

    if (shape === "diamond") {
      return `M${cx} ${y + inset}L${x + size - inset} ${cy}L${cx} ${y + size - inset}L${x + inset} ${cy}Z`;
    }

    if (shape === "plus") {
      const a = size * 0.34;
      const b = size * 0.66;
      return `M${x + a} ${y + inset}H${x + b}V${y + a}H${x + size - inset}V${y + b}`
        + `H${x + b}V${y + size - inset}H${x + a}V${y + b}H${x + inset}V${y + a}H${x + a}Z`;
    }

    if (shape === "star") return starPath(x, y, size);

    return `M${cx} ${y + size * 0.92}`
      + `C${x + size * 0.2} ${y + size * 0.72},${x + size * 0.05} ${y + size * 0.52},${x + size * 0.08} ${y + size * 0.3}`
      + `C${x + size * 0.11} ${y + size * 0.1},${x + size * 0.36} ${y + size * 0.08},${cx} ${y + size * 0.3}`
      + `C${x + size * 0.64} ${y + size * 0.08},${x + size * 0.89} ${y + size * 0.1},${x + size * 0.92} ${y + size * 0.3}`
      + `C${x + size * 0.95} ${y + size * 0.52},${x + size * 0.8} ${y + size * 0.72},${cx} ${y + size * 0.92}Z`;
  }

  function replaceRectModules(documentNode, selector, shape) {
    documentNode.querySelectorAll(selector).forEach((clipPath) => {
      Array.from(clipPath.children).forEach((element) => {
        if (element.localName !== "rect") return;
        const x = numberAttribute(element, "x");
        const y = numberAttribute(element, "y");
        const width = numberAttribute(element, "width");
        const height = numberAttribute(element, "height");
        const size = Math.min(width, height);
        if (!(size > 0)) return;

        const path = documentNode.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", shapePath(shape, x + (width - size) / 2, y + (height - size) / 2, size));
        element.replaceWith(path);
      });
    });
  }

  function transformSVG(svg, shape) {
    if (!svg || !customShapes.has(shape)) return svg;
    const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (documentNode.querySelector("parsererror")) return svg;

    replaceRectModules(documentNode, 'clipPath[id^="clip-path-dot-color-"]', shape);
    if (!cornerSquareSelect?.value) {
      replaceRectModules(documentNode, 'clipPath[id^="clip-path-corners-square-color-"]', shape);
    }
    if (!cornerDotSelect?.value) {
      replaceRectModules(documentNode, 'clipPath[id^="clip-path-corners-dot-color-"]', shape);
    }

    documentNode.documentElement.setAttribute("data-codebench-modules", shape);
    return new XMLSerializer().serializeToString(documentNode.documentElement);
  }

  window.qrOptions = function decorativeModuleQrOptions() {
    const options = originalQrOptions();
    if (isCustomShape()) options.dotsOptions.type = "square";
    return options;
  };

  async function decorativeBareSVG() {
    const svg = await originalBareSVG();
    return isCustomShape() ? transformSVG(svg, currentShape()) : svg;
  }
  window.qrBareSVG = decorativeBareSVG;

  function customPreviewHost() {
    let host = document.querySelector("#qrDecorativePreview");
    if (!host) {
      host = document.createElement("div");
      host.id = "qrDecorativePreview";
      host.style.width = "100%";
      host.style.lineHeight = "0";
      document.querySelector("#qrHost")?.appendChild(host);
    }
    return host;
  }

  async function updateDecorativePreview() {
    const generation = ++previewGeneration;
    hint.style.display = isCustomShape() ? "" : "none";

    const canvas = document.querySelector("#qrHost canvas");
    const preview = document.querySelector("#qrDecorativePreview");
    const frameEnabled = Boolean(document.querySelector("#qFrame")?.checked);

    if (!isCustomShape()) {
      if (preview) preview.style.display = "none";
      if (!frameEnabled && canvas) canvas.style.display = "";
      return;
    }

    if (frameEnabled) {
      if (preview) preview.style.display = "none";
      if (typeof window.updateFramed === "function") await window.updateFramed();
      return;
    }

    const svg = await decorativeBareSVG();
    if (generation !== previewGeneration || !isCustomShape() || !svg) return;

    const host = customPreviewHost();
    host.innerHTML = svg;
    host.style.display = "";
    const rendered = host.querySelector("svg");
    if (rendered) {
      rendered.removeAttribute("width");
      rendered.removeAttribute("height");
      rendered.style.width = "100%";
      rendered.style.height = "auto";
    }
    if (canvas) canvas.style.display = "none";
    const framed = document.querySelector("#qrFramed");
    if (framed) framed.style.display = "none";
  }

  if (typeof originalRenderQR === "function") {
    window.renderQR = function decorativeModuleRenderQR(...args) {
      const result = originalRenderQR.apply(this, args);
      Promise.resolve().then(updateDecorativePreview);
      return result;
    };
  }

  if (typeof originalOpenPrint === "function") {
    window.openPrint = function decorativeModuleOpenPrint(source) {
      printSource = source;
      return originalOpenPrint(source);
    };
  }

  if (typeof originalCurrentSVG === "function") {
    window.currentSVG = async function decorativeModuleCurrentSVG() {
      if (printSource !== "qr" || !isCustomShape()) return originalCurrentSVG();
      const bare = await decorativeBareSVG();
      if (!bare) return null;
      return document.querySelector("#qFrame")?.checked && typeof window.frameSVG === "function"
        ? window.frameSVG(bare, window.frameOpts())
        : bare;
    };
  }

  function svgDimensions(svg) {
    const width = /\bwidth="([\d.]+)"/i.exec(svg);
    const height = /\bheight="([\d.]+)"/i.exec(svg);
    if (width && height) return [Number(width[1]), Number(height[1])];
    const viewBox = /viewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/i.exec(svg);
    return viewBox ? [Number(viewBox[1]), Number(viewBox[2])] : [600, 600];
  }

  async function svgToPngBlob(svg) {
    const [width, height] = svgDimensions(svg);
    const scale = 2;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(image, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function notify(message) {
    if (typeof toast === "function") toast(message);
  }

  function saveFile(blob, name) {
    if (typeof download === "function") download(blob, name);
  }

  function currentFileName(extension) {
    const template = document.querySelector("#qrChips .chip[aria-pressed='true']")?.dataset.t || "qr";
    return `qr-${template}.${extension}`;
  }

  async function exportSVG() {
    const bare = await decorativeBareSVG();
    if (!bare) return null;
    return document.querySelector("#qFrame")?.checked && typeof window.frameSVG === "function"
      ? window.frameSVG(bare, window.frameOpts())
      : bare;
  }

  const pngButton = document.querySelector("#qrPng");
  const svgButton = document.querySelector("#qrSvg");
  const copyButton = document.querySelector("#qrCopy");
  const originalPngClick = pngButton?.onclick;
  const originalSvgClick = svgButton?.onclick;
  const originalCopyClick = copyButton?.onclick;

  if (pngButton) {
    pngButton.onclick = async function decorativePngDownload(event) {
      if (!isCustomShape()) return originalPngClick?.call(this, event);
      const svg = await exportSVG();
      const blob = svg ? await svgToPngBlob(svg) : null;
      if (blob) saveFile(blob, currentFileName("png"));
      else notify("Couldn't render PNG");
    };
  }

  if (svgButton) {
    svgButton.onclick = async function decorativeSvgDownload(event) {
      if (!isCustomShape()) return originalSvgClick?.call(this, event);
      const svg = await exportSVG();
      if (svg) saveFile(new Blob([svg], { type: "image/svg+xml" }), currentFileName("svg"));
      else notify("Couldn't render SVG");
    };
  }

  if (copyButton) {
    copyButton.onclick = async function decorativePngCopy(event) {
      if (!isCustomShape()) return originalCopyClick?.call(this, event);
      const svg = await exportSVG();
      const blob = svg ? await svgToPngBlob(svg) : null;
      if (!blob) {
        notify("Couldn't render PNG");
        return;
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notify("PNG copied to clipboard");
      } catch {
        notify("Copy not supported here — use Download");
      }
    };
  }

  [
    "qDot", "qCornerSq", "qCornerDot", "qEc", "qFg", "qFg2", "qBg", "qSize", "qMargin",
    "qLogo", "qLogoSize", "qLogoClear", "qGrad", "qTransparent", "qFrame", "qFrameText",
    "qFrameSide", "qFrameThick", "qFrameRound", "qFrameColor", "qFrameTextColor",
  ].forEach((id) => {
    const element = document.querySelector(`#${id}`);
    element?.addEventListener("input", () => Promise.resolve().then(updateDecorativePreview));
    element?.addEventListener("change", () => Promise.resolve().then(updateDecorativePreview));
  });

  document.querySelector("#qLogoRemove")?.addEventListener("click", () => Promise.resolve().then(updateDecorativePreview));
  document.querySelector("#qLogoPresets")?.addEventListener("click", () => Promise.resolve().then(updateDecorativePreview));

  const remoteStatus = document.querySelector("#qLogoUrlStatus");
  if (remoteStatus) {
    new MutationObserver(() => Promise.resolve().then(updateDecorativePreview))
      .observe(remoteStatus, { childList: true, subtree: true, characterData: true });
  }

  updateDecorativePreview();
})();
