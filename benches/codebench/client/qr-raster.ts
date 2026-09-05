"use strict";

(() => {
  const pngButton = document.querySelector("#qrPng");
  const copyButton = document.querySelector("#qrCopy");
  if (!pngButton) return;

  function dimensions(svg) {
    const documentNode = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (documentNode.querySelector("parsererror")) throw new Error("The QR SVG is invalid.");

    const root = documentNode.documentElement;
    const width = Number.parseFloat(root.getAttribute("width") || "");
    const height = Number.parseFloat(root.getAttribute("height") || "");
    if (width > 0 && height > 0) return [width, height];

    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return [viewBox[2], viewBox[3]];
    return [600, 600];
  }

  async function svgToPngBlob(svg, options = {}) {
    const [sourceWidth, sourceHeight] = dimensions(svg);
    const largestSide = Math.max(sourceWidth, sourceHeight);
    const scale = options.maxSide
      ? Math.min(2, Math.max(0.5, Number(options.maxSide) / largestSide))
      : Math.max(0.1, Number(options.scale) || 1);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const source = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(source);

    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Could not rasterize the QR."));
        image.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable.");

      if (options.background) {
        context.fillStyle = options.background;
        context.fillRect(0, 0, width, height);
      }
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

  async function currentQrSvg() {
    if (typeof window.qrBareSVG !== "function") throw new Error("QR renderer is unavailable.");
    const bare = await window.qrBareSVG();
    if (!bare) throw new Error("QR render is empty.");

    const frameEnabled = Boolean(document.querySelector("#qFrame")?.checked);
    if (!frameEnabled || typeof window.frameSVG !== "function" || typeof window.frameOpts !== "function") {
      return bare;
    }
    return window.frameSVG(bare, window.frameOpts());
  }

  async function currentQrPngBlob(options = {}) {
    return svgToPngBlob(await currentQrSvg(), options);
  }

  function fileName() {
    const type = document.querySelector("#qrChips .chip[aria-pressed='true']")?.dataset.t || "qr";
    return `qr-${type}.png`;
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function notify(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  window.codebenchSvgToPngBlob = svgToPngBlob;
  window.codebenchCurrentQrSvg = currentQrSvg;
  window.codebenchCurrentQrPngBlob = currentQrPngBlob;

  pngButton.onclick = async () => {
    pngButton.disabled = true;
    try {
      saveBlob(await currentQrPngBlob(), fileName());
    } catch (error) {
      console.error("QR PNG export failed", error);
      notify("Couldn't render PNG");
    } finally {
      pngButton.disabled = false;
    }
  };

  if (copyButton) {
    copyButton.onclick = async () => {
      copyButton.disabled = true;
      try {
        const blob = await currentQrPngBlob();
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
          throw new Error("Clipboard image writing is unavailable.");
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        notify("PNG copied to clipboard");
      } catch (error) {
        console.error("QR PNG copy failed", error);
        notify("Copy not supported here — use Download");
      } finally {
        copyButton.disabled = false;
      }
    };
  }
})();
