"use strict";

(() => {
  const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

  function normalizeSvg(svg) {
    const source = String(svg || "");
    if (!/\bxlink:href\s*=/.test(source) || /\bxmlns:xlink\s*=/.test(source)) return source;
    return source.replace(/<svg\b/i, `<svg xmlns:xlink="${XLINK_NAMESPACE}"`);
  }

  const originalBareSvg = window.qrBareSVG;
  if (typeof originalBareSvg === "function") {
    window.qrBareSVG = async function compatibleBareSvg(...args) {
      return normalizeSvg(await originalBareSvg.apply(this, args));
    };
  }

  const originalFrameSvg = window.frameSVG;
  if (typeof originalFrameSvg === "function") {
    window.frameSVG = function compatibleFrameSvg(bare, options) {
      return normalizeSvg(originalFrameSvg(normalizeSvg(bare), options));
    };
  }

  const originalCurrentSvg = window.currentSVG;
  if (typeof originalCurrentSvg === "function") {
    window.currentSVG = async function compatibleCurrentSvg(...args) {
      return normalizeSvg(await originalCurrentSvg.apply(this, args));
    };
  }

  const svgButton = document.querySelector("#qrSvg");
  if (svgButton) {
    svgButton.onclick = async () => {
      try {
        const bare = await window.qrBareSVG?.();
        if (!bare) throw new Error("QR render is empty.");
        const framed = document.querySelector("#qFrame")?.checked;
        const svg = framed && typeof window.frameSVG === "function" && typeof window.frameOpts === "function"
          ? window.frameSVG(bare, window.frameOpts())
          : bare;
        const type = document.querySelector("#qrChips .chip[aria-pressed='true']")?.dataset.t || "qr";
        const blob = new Blob([normalizeSvg(svg)], { type: "image/svg+xml;charset=utf-8" });
        if (typeof window.download !== "function") throw new Error("Download is unavailable.");
        window.download(blob, `qr-${type}.svg`);
      } catch (error) {
        console.error("QR SVG export failed", error);
        if (typeof window.toast === "function") window.toast("Couldn't render SVG");
      }
    };
  }

  window.codebenchNormalizeSvg = normalizeSvg;
})();
