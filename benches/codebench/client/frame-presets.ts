"use strict";

(() => {
  const optionsHost = document.querySelector("#qFrameOpts");
  const originalFrameOpts = window.frameOpts;
  const originalFrameSVG = window.frameSVG;
  if (!optionsHost || typeof originalFrameOpts !== "function" || typeof originalFrameSVG !== "function") return;

  const presets = [
    ["classic", "Classic"],
    ["top-tab", "Top tab"],
    ["bottom-tab", "Bottom tab"],
    ["speech", "Speech"],
    ["phone", "Phone"],
  ];
  let framePreset = "classic";

  const field = document.createElement("div");
  field.className = "f";
  field.style.marginBottom = "12px";
  field.innerHTML = '<span>Frame preset</span><div class="qr-frame-preset-grid" role="group" aria-label="Frame preset"></div>';
  optionsHost.insertAdjacentElement("afterbegin", field);

  const style = document.createElement("style");
  style.textContent = `
    .qr-frame-preset-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-top: 7px;
    }
    .qr-frame-preset-grid .qr-style-choice { padding-inline: 4px; }
    .qr-frame-preset-grid .qr-style-choice svg { max-width: 64px; }
    @media (max-width: 700px) {
      .qr-frame-preset-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
  `;
  document.head.appendChild(style);

  function preview(name) {
    const qr = '<rect x="18" y="18" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3"/>'
      + '<path d="M22 22h9v9h-9zm17 0h9v9h-9zM22 39h9v9h-9zm14-2h4v4h-4zm7 5h5v5h-5z" fill="currentColor"/>';
    if (name === "top-tab") {
      return `<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="8" y="13" width="56" height="51" rx="7" fill="none" stroke="currentColor" stroke-width="3"/><rect x="19" y="7" width="34" height="13" rx="5" fill="currentColor"/>${qr}</svg>`;
    }
    if (name === "bottom-tab") {
      return `<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="8" y="8" width="56" height="51" rx="7" fill="none" stroke="currentColor" stroke-width="3"/><rect x="19" y="52" width="34" height="13" rx="5" fill="currentColor"/>${qr}</svg>`;
    }
    if (name === "speech") {
      return `<svg viewBox="0 0 72 72" aria-hidden="true"><path d="M8 8h56v49H27L16 66v-9H8z" fill="currentColor" opacity=".2"/><path d="M8 8h56v49H27L16 66v-9H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>${qr}</svg>`;
    }
    if (name === "phone") {
      return `<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="12" y="3" width="48" height="66" rx="9" fill="none" stroke="currentColor" stroke-width="4"/><path d="M30 9h12M33 63h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>${qr}</svg>`;
    }
    return `<svg viewBox="0 0 72 72" aria-hidden="true"><rect x="7" y="7" width="58" height="58" rx="5" fill="currentColor" opacity=".16"/><rect x="7" y="7" width="58" height="58" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>${qr}</svg>`;
  }

  const grid = field.querySelector(".qr-frame-preset-grid");

  function syncButtons() {
    grid.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.preset === framePreset));
    });
  }

  presets.forEach(([name, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qr-style-choice";
    button.dataset.preset = name;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = preview(name) + `<span>${label}</span>`;
    button.addEventListener("click", () => {
      framePreset = name;
      syncButtons();
      if (document.querySelector("#qFrame")?.checked && typeof window.updateFramed === "function") {
        window.updateFramed();
      }
    });
    grid.appendChild(button);
  });
  syncButtons();

  function escapeXML(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function svgSize(svg) {
    const viewBox = /viewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/i.exec(svg);
    if (viewBox) return Math.min(Number(viewBox[1]), Number(viewBox[2]));
    const width = /\bwidth="([\d.]+)"/i.exec(svg);
    return width ? Number(width[1]) : 600;
  }

  function frameSafeBare(bare) {
    if (!document.querySelector("#qTransparent")?.checked) return bare;
    const fill = document.querySelector("#qBg")?.value || "#ffffff";
    return bare.replace(
      /^(\s*(?:<\?xml[^>]*>\s*)?<svg\b[^>]*>)/i,
      `$1<rect x="0" y="0" width="100%" height="100%" fill="${fill}"/>`,
    );
  }

  function innerSVG(bare, x, y, size, sourceSize) {
    return bare.replace(
      /^\s*(?:<\?xml[^>]*>\s*)?<svg\b[^>]*>/i,
      `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${sourceSize} ${sourceSize}" preserveAspectRatio="xMidYMid meet">`,
    );
  }

  function textElement(text, x, y, fontSize, fill, maxWidth) {
    const clean = escapeXML(text.trim());
    if (!clean) return "";
    const fit = text.trim().length * fontSize * 0.6 > maxWidth
      ? ` textLength="${Math.round(maxWidth)}" lengthAdjust="spacingAndGlyphs"`
      : "";
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"`
      + ` font-family="'Space Grotesk',system-ui,sans-serif" font-weight="700" font-size="${fontSize}"`
      + `${fit} fill="${fill}">${clean}</text>`;
  }

  function tabFrame(bare, options, position) {
    const size = svgSize(bare);
    const stroke = Math.max(3, Math.round(size * options.thick / 100));
    const radius = Math.round(size * options.round / 100);
    const tabHeight = Math.max(48, Math.round(size * 0.16));
    const tabWidth = Math.round(size * 0.66);
    const overlap = Math.round(tabHeight * 0.42);
    const width = size + stroke * 4;
    const height = size + stroke * 4 + tabHeight - overlap;
    const bodyY = position === "top" ? tabHeight - overlap : 0;
    const qrX = stroke * 2;
    const qrY = bodyY + stroke * 2;
    const tabX = (width - tabWidth) / 2;
    const tabY = position === "top" ? 0 : height - tabHeight;
    const bodyHeight = size + stroke * 4;
    const body = `<rect x="${stroke / 2}" y="${bodyY + stroke / 2}" width="${width - stroke}" height="${bodyHeight - stroke}"`
      + ` rx="${radius}" ry="${radius}" fill="none" stroke="${options.color}" stroke-width="${stroke}"/>`;
    const tab = `<rect x="${tabX}" y="${tabY}" width="${tabWidth}" height="${tabHeight}" rx="${Math.min(radius, tabHeight / 2)}" fill="${options.color}"/>`;
    const label = textElement(options.text, width / 2, tabY + tabHeight / 2, Math.round(tabHeight * 0.36), options.textColor, tabWidth * 0.84);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `${body}${tab}${label}${innerSVG(bare, qrX, qrY, size, size)}</svg>`;
  }

  function speechFrame(bare, options) {
    const size = svgSize(bare);
    const border = Math.max(4, Math.round(size * options.thick / 100));
    const radius = Math.max(border, Math.round(size * options.round / 100));
    const band = options.text.trim() ? Math.max(48, Math.round(size * 0.15)) : border * 2;
    const tail = Math.max(28, Math.round(size * 0.09));
    const width = size + border * 4;
    const bodyHeight = size + border * 4 + band;
    const height = bodyHeight + tail;
    const tailX = Math.round(width * 0.24);
    const bubble = `<rect x="0" y="0" width="${width}" height="${bodyHeight}" rx="${radius}" fill="${options.color}"/>`
      + `<path d="M${tailX} ${bodyHeight - 1}h${tail * 1.35}L${tailX} ${height}Z" fill="${options.color}"/>`;
    const label = textElement(options.text, width / 2, band / 2, Math.round(band * 0.36), options.textColor, width * 0.84);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `${bubble}${label}${innerSVG(bare, border * 2, band + border * 2, size, size)}</svg>`;
  }

  function phoneFrame(bare, options) {
    const size = svgSize(bare);
    const bezel = Math.max(18, Math.round(size * 0.055));
    const top = Math.max(52, Math.round(size * 0.14));
    const bottom = Math.max(42, Math.round(size * 0.11));
    const width = size + bezel * 2;
    const height = size + top + bottom;
    const radius = Math.max(18, Math.round(size * options.round / 100));
    const speakerWidth = Math.round(width * 0.17);
    const shell = `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${options.color}"/>`;
    const speaker = `<rect x="${(width - speakerWidth) / 2}" y="${Math.round(top * 0.22)}" width="${speakerWidth}" height="${Math.max(5, Math.round(top * 0.07))}" rx="4" fill="${options.textColor}"/>`;
    const home = `<circle cx="${width / 2}" cy="${height - bottom / 2}" r="${Math.round(bottom * 0.18)}" fill="none" stroke="${options.textColor}" stroke-width="${Math.max(3, Math.round(bottom * 0.08))}"/>`;
    const label = textElement(options.text, width / 2, top * 0.64, Math.round(top * 0.24), options.textColor, width * 0.72);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `${shell}${speaker}${label}${innerSVG(bare, bezel, top, size, size)}${home}</svg>`;
  }

  window.frameOpts = function framePresetOptions() {
    return { ...originalFrameOpts(), preset: framePreset };
  };

  window.frameSVG = function framePresetSVG(bare, options) {
    const preset = options?.preset || framePreset;
    const source = frameSafeBare(bare);
    if (preset === "top-tab") return tabFrame(source, options, "top");
    if (preset === "bottom-tab") return tabFrame(source, options, "bottom");
    if (preset === "speech") return speechFrame(source, options);
    if (preset === "phone") return phoneFrame(source, options);
    return originalFrameSVG(source, options);
  };
})();
