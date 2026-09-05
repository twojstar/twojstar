"use strict";

(() => {
  const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

  function normalizeSvg(svg) {
    const source = String(svg || "");
    if (!/\bxlink:href\s*=/.test(source) || /\bxmlns:xlink\s*=/.test(source)) return source;
    return source.replace(/<svg\b/i, `<svg xmlns:xlink="${XLINK_NAMESPACE}"`);
  }

  window.codebenchNormalizeSvg = normalizeSvg;

  const originalBareSvg = window.qrBareSVG;
  if (typeof originalBareSvg === "function") {
    window.qrBareSVG = async function normalizedBareSvg(...args) {
      return normalizeSvg(await originalBareSvg.apply(this, args));
    };
  }
})();
