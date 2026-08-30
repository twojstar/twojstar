"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const originalDecodeFile = window.decodeFile;

  const MIME_BY_EXTENSION = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
  };
  const GENERATION_ONLY = new Set([
    "msi",
    "pharmacode",
    "code11",
    "postnet",
    "onecode",
    "royalmail",
    "kix",
    "auspost",
    "japanpost",
  ]);

  function extension(file) {
    return file.name?.split(".").pop()?.toLowerCase() || "";
  }

  function normalizeImageType(file) {
    const type = MIME_BY_EXTENSION[extension(file)];
    if (!type || file.type === type) return file;
    try {
      return new File([file], file.name || `code.${extension(file)}`, {
        type,
        lastModified: file.lastModified,
      });
    } catch {
      return new Blob([file], { type });
    }
  }

  async function normalizeGeneratedPng(file) {
    if (file.size > 20 * 1024 * 1024
      || !/^\s*(qr|barcode)-.+\.png$/i.test(file.name || "")
      || !("createImageBitmap" in window)) {
      return file;
    }

    const bitmap = await createImageBitmap(file);
    try {
      const pixels = bitmap.width * bitmap.height;
      if (bitmap.width > 12000 || bitmap.height > 12000 || pixels > 40_000_000) return file;

      const border = Math.max(16, Math.ceil(Math.max(bitmap.width, bitmap.height) * 0.04));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width + border * 2;
      canvas.height = bitmap.height + border * 2;
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, border, border);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return file;
      return new File([blob], file.name, { type: "image/png", lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  }

  if (typeof originalDecodeFile === "function") {
    window.decodeFile = async function compatibleDecodeFile(input) {
      let file = normalizeImageType(input);
      try {
        file = await normalizeGeneratedPng(file);
      } catch {
        // Fall back to the original image when browser rasterization is unavailable.
      }
      return originalDecodeFile(file);
    };
  }

  const fileInput = $("#fileInput");
  if (fileInput) fileInput.accept = "image/*,.svg,.png,.jpg,.jpeg,.webp,.gif,.bmp";

  const dropHelp = $("#drop span");
  if (dropHelp) dropHelp.textContent = "PNG · JPG · WebP · GIF · SVG — QR, DataMatrix, Aztec, PDF417, and supported 1D barcodes";

  function updateReaderSupportHint() {
    const type = $("#bType")?.value;
    const hint = $("#bHint");
    if (!type || !hint) return;
    hint.textContent = hint.textContent
      .replace(/\s+Reader: generation only\.$/, "")
      .replace(/\s+Reader: needs a monochrome, unrotated symbol with a white border\.$/, "");
    if (GENERATION_ONLY.has(type)) hint.textContent += " Reader: generation only.";
    else if (type === "maxicode") hint.textContent += " Reader: needs a monochrome, unrotated symbol with a white border.";
  }

  const barcodeType = $("#bType");
  barcodeType?.addEventListener("change", () => queueMicrotask(updateReaderSupportHint));
  updateReaderSupportHint();
})();
