"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const dotSelect = $("#qDot");
  if (!dotSelect || typeof window.qrOptions !== "function" || typeof window.qrBareSVG !== "function") return;

  const cornerSquare = $("#qCornerSq");
  const cornerDot = $("#qCornerDot");
  const legacyShapes = new Set(["heart", "star", "diamond", "plus"]);
  const extraShapes = new Set(["soft", "vertical-line", "horizontal-line", "small-square", "tiny-square"]);
  const previousOptions = window.qrOptions;
  const previousBareSVG = window.qrBareSVG;
  const previousRender = window.renderQR;
  const previousCurrentSVG = window.currentSVG;
  let previewGeneration = 0;

  const style = document.createElement("style");
  style.textContent = `
    .qr-palette-plus{margin-top:12px}.qr-palette-plus .f{margin-bottom:10px}
    .qr-palette-plus .row{align-items:end}.qr-palette-note{margin:5px 0 0;color:var(--muted);font:400 10px/1.45 "Space Mono",monospace}
    .qr-palette-value{float:right;color:var(--muted);font:400 10px "Space Mono",monospace}
    #qrPalettePreview{width:100%;line-height:0}#qrPalettePreview>svg{display:block;width:100%;height:auto}
  `;
  document.head.appendChild(style);

  const extraChoices = [
    ["soft", "Soft"],
    ["vertical-line", "Vertical"],
    ["horizontal-line", "Horizontal"],
    ["small-square", "Small"],
    ["tiny-square", "Tiny"],
  ];

  function previewIcon(value) {
    const pattern = [[0,0],[1,0],[3,0],[4,0],[0,1],[2,1],[3,1],[1,2],[2,2],[4,2],[0,3],[2,3],[3,3],[0,4],[1,4],[3,4],[4,4]];
    const cells = pattern.map(([column, row]) => {
      const x = 5 + column * 10;
      const y = 5 + row * 10;
      if (value === "vertical-line") return `<rect x="${x + 2.2}" y="${y + .5}" width="3.6" height="7" rx="1.5"/>`;
      if (value === "horizontal-line") return `<rect x="${x + .5}" y="${y + 2.2}" width="7" height="3.6" rx="1.5"/>`;
      if (value === "small-square") return `<rect x="${x + 1.25}" y="${y + 1.25}" width="5.5" height="5.5" rx=".8"/>`;
      if (value === "tiny-square") return `<rect x="${x + 2}" y="${y + 2}" width="4" height="4" rx=".6"/>`;
      return `<rect x="${x + .35}" y="${y + .35}" width="7.3" height="7.3" rx="2.8"/>`;
    }).join("");
    return `<svg viewBox="0 0 60 60" aria-hidden="true"><g fill="currentColor">${cells}</g></svg>`;
  }

  function extendStylePicker() {
    extraChoices.forEach(([value, label]) => {
      if (!dotSelect.querySelector(`option[value="${value}"]`)) dotSelect.add(new Option(label, value));
    });
    const grid = dotSelect.parentElement?.querySelector(".qr-style-grid") || dotSelect.nextElementSibling;
    if (!grid?.classList.contains("qr-style-grid")) return;
    extraChoices.forEach(([value, label]) => {
      if (grid.querySelector(`[data-value="${value}"]`)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "qr-style-choice";
      button.dataset.value = value;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = previewIcon(value) + `<span>${label}</span>`;
      button.onclick = () => {
        dotSelect.value = value;
        dotSelect.dispatchEvent(new Event("input", { bubbles: true }));
        dotSelect.dispatchEvent(new Event("change", { bubbles: true }));
        grid.querySelectorAll("button").forEach((choice) => choice.setAttribute("aria-pressed", String(choice.dataset.value === value)));
      };
      grid.appendChild(button);
    });
  }

  function addControls() {
    const grad = $("#qGrad");
    const gradLabel = grad?.closest("label");
    if (gradLabel && !$("#qGradientPlus")) {
      const host = document.createElement("div");
      host.id = "qGradientPlus";
      host.className = "qr-palette-plus row";
      host.style.display = grad.checked ? "grid" : "none";
      host.innerHTML = `
        <label class="f"><span>Gradient type</span><select id="qGradType"><option value="linear">Linear</option><option value="radial">Radial</option></select></label>
        <label class="f"><span>Angle <output id="qGradAngleOut" class="qr-palette-value">45°</output></span><input id="qGradAngle" type="range" min="0" max="360" step="5" value="45"></label>`;
      gradLabel.insertAdjacentElement("afterend", host);
      grad.onchange = ((previous) => (event) => {
        if (typeof previous === "function") previous.call(grad, event);
        host.style.display = grad.checked ? "grid" : "none";
      })(grad.onchange);
    }

    const panel = dotSelect.closest(".panel-b");
    if (panel && !$("#qShapeWrap")) {
      const host = document.createElement("div");
      host.id = "qShapeWrap";
      host.className = "qr-palette-plus";
      host.innerHTML = `
        <div class="row">
          <label class="f"><span>QR silhouette</span><select id="qShape"><option value="square">Square</option><option value="circle">Circle</option></select></label>
          <label class="f" id="qSoftRadiusWrap" style="display:none"><span>Soft radius <output id="qSoftRadiusOut" class="qr-palette-value">35%</output></span><input id="qSoftRadius" type="range" min="0" max="50" step="1" value="35"></label>
        </div>
        <p class="qr-palette-note">Circle and decorative modules trade some scan tolerance for style. Use Test QR before print.</p>`;
      const divider = panel.querySelector(".divider");
      if (divider) divider.insertAdjacentElement("beforebegin", host);
      else panel.appendChild(host);
    }

    const colorRow = $("#qFg")?.closest(".row-3");
    if (colorRow && !$("#qFinderColors")) {
      const host = document.createElement("div");
      host.className = "qr-palette-plus";
      host.innerHTML = `
        <label class="toggle"><input type="checkbox" id="qFinderColors"> Separate finder colors</label>
        <div class="row" id="qFinderColorsWrap" style="display:none">
          <label class="f"><span>Finder frame</span><input type="color" id="qFinderOuter" value="#16150f"></label>
          <label class="f"><span>Finder center</span><input type="color" id="qFinderInner" value="#da2b1f"></label>
        </div>`;
      colorRow.insertAdjacentElement("afterend", host);
      $("#qFinderColors").onchange = (event) => { $("#qFinderColorsWrap").style.display = event.target.checked ? "grid" : "none"; };
    }

    $("#qGradAngle")?.addEventListener("input", (event) => { $("#qGradAngleOut").value = `${event.target.value}°`; });
    $("#qSoftRadius")?.addEventListener("input", (event) => { $("#qSoftRadiusOut").value = `${event.target.value}%`; });
  }

  extendStylePicker();
  addControls();

  const currentExtra = () => extraShapes.has(dotSelect.value) ? dotSelect.value : null;
  const syncRadius = () => { const wrap = $("#qSoftRadiusWrap"); if (wrap) wrap.style.display = dotSelect.value === "soft" ? "block" : "none"; };
  dotSelect.addEventListener("input", syncRadius);
  dotSelect.addEventListener("change", syncRadius);
  syncRadius();

  window.qrOptions = function paletteQrOptions(...args) {
    const options = previousOptions(...args);
    if ($("#qShape")?.value) options.shape = $("#qShape").value;
    if (options.dotsOptions?.gradient) {
      options.dotsOptions.gradient.type = $("#qGradType")?.value || "linear";
      options.dotsOptions.gradient.rotation = (Number($("#qGradAngle")?.value) || 0) * Math.PI / 180;
    }
    if ($("#qFinderColors")?.checked) {
      options.cornersSquareOptions = { ...(options.cornersSquareOptions || {}), color: $("#qFinderOuter").value };
      options.cornersDotOptions = { ...(options.cornersDotOptions || {}), color: $("#qFinderInner").value };
      delete options.cornersSquareOptions.gradient;
      delete options.cornersDotOptions.gradient;
    }
    if (currentExtra()) options.dotsOptions.type = "square";
    return options;
  };

  const num = (element, name) => Number.parseFloat(element.getAttribute(name) || "0");
  function roundedBoxPath(x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const right = x + width;
    const bottom = y + height;
    return `M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}`
      + `Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}`
      + `V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  }
  function modulePath(shape, x, y, size) {
    if (shape === "soft") {
      const inset = size * .04;
      const side = size * .92;
      return roundedBoxPath(x + inset, y + inset, side, side, side * (Number($("#qSoftRadius")?.value) || 35) / 100);
    }
    if (shape === "vertical-line") return roundedBoxPath(x + size * .28, y + size * .06, size * .44, size * .88, size * .12);
    if (shape === "horizontal-line") return roundedBoxPath(x + size * .06, y + size * .28, size * .88, size * .44, size * .12);
    if (shape === "small-square") return roundedBoxPath(x + size * .16, y + size * .16, size * .68, size * .68, size * .08);
    return roundedBoxPath(x + size * .27, y + size * .27, size * .46, size * .46, size * .06);
  }
  function replaceModules(doc, selector, shape) {
    doc.querySelectorAll(selector).forEach((clip) => {
      Array.from(clip.children).forEach((element) => {
        if (element.localName !== "rect") return;
        const width = num(element, "width");
        const height = num(element, "height");
        const size = Math.min(width, height);
        if (!(size > 0)) return;
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", modulePath(shape, num(element, "x") + (width - size) / 2, num(element, "y") + (height - size) / 2, size));
        element.replaceWith(path);
      });
    });
  }
  function transform(svg, shape = currentExtra()) {
    if (!svg || !shape) return svg;
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (doc.querySelector("parsererror")) return svg;
    replaceModules(doc, 'clipPath[id^="clip-path-dot-color-"]', shape);
    if (!cornerSquare?.value) replaceModules(doc, 'clipPath[id^="clip-path-corners-square-color-"]', shape);
    if (!cornerDot?.value) replaceModules(doc, 'clipPath[id^="clip-path-corners-dot-color-"]', shape);
    doc.documentElement.setAttribute("data-codebench-palette", shape);
    return new XMLSerializer().serializeToString(doc.documentElement);
  }

  window.qrBareSVG = async function paletteBareSVG(...args) {
    const svg = await previousBareSVG.apply(this, args);
    return currentExtra() ? transform(svg) : svg;
  };

  function previewHost() {
    let host = $("#qrPalettePreview");
    if (!host) {
      host = document.createElement("div");
      host.id = "qrPalettePreview";
      $("#qrHost")?.appendChild(host);
    }
    return host;
  }
  async function updatePreview() {
    const generation = ++previewGeneration;
    const shape = currentExtra();
    const preview = $("#qrPalettePreview");
    const framed = Boolean($("#qFrame")?.checked);
    const canvas = $("#qrHost canvas");
    if (!shape) {
      if (preview) preview.style.display = "none";
      if (!legacyShapes.has(dotSelect.value) && !framed && canvas) canvas.style.display = "";
      return;
    }
    if (framed) {
      if (preview) preview.style.display = "none";
      if (typeof window.updateFramed === "function") await window.updateFramed();
      return;
    }
    const svg = await window.qrBareSVG();
    if (generation !== previewGeneration || currentExtra() !== shape || !svg) return;
    const host = previewHost();
    host.innerHTML = svg;
    host.style.display = "";
    const rendered = host.querySelector("svg");
    if (rendered) { rendered.removeAttribute("width"); rendered.removeAttribute("height"); rendered.style.width = "100%"; rendered.style.height = "auto"; }
    if (canvas) canvas.style.display = "none";
    if ($("#qrDecorativePreview")) $("#qrDecorativePreview").style.display = "none";
    if ($("#qrFramed")) $("#qrFramed").style.display = "none";
  }

  if (typeof previousRender === "function") {
    window.renderQR = function paletteRenderQR(...args) {
      const result = previousRender.apply(this, args);
      Promise.resolve().then(updatePreview);
      return result;
    };
  }
  if (typeof previousCurrentSVG === "function") {
    window.currentSVG = async function paletteCurrentSVG(...args) {
      const svg = await previousCurrentSVG.apply(this, args);
      return currentExtra() && /clip-path-dot-color-/i.test(svg || "") ? transform(svg) : svg;
    };
  }

  ["qShape", "qGradType", "qGradAngle", "qFinderColors", "qFinderOuter", "qFinderInner", "qSoftRadius"].forEach((id) => {
    const element = $(`#${id}`);
    if (!element) return;
    const rerender = () => { if (typeof window.renderQR === "function") window.renderQR(); };
    element.addEventListener("input", rerender);
    element.addEventListener("change", rerender);
  });

  const svgButton = $("#qrSvg");
  const previousSvgClick = svgButton?.onclick;
  if (svgButton) {
    svgButton.onclick = async function paletteSvgDownload(event) {
      if (!currentExtra()) return previousSvgClick?.call(this, event);
      try {
        const svg = typeof window.codebenchCurrentQrSvg === "function" ? await window.codebenchCurrentQrSvg() : await window.qrBareSVG();
        download(new Blob([svg], { type: "image/svg+xml" }), `qr-${$("#qrChips .chip[aria-pressed='true']")?.dataset.t || "qr"}.svg`);
      } catch (error) {
        console.error(error);
        if (typeof toast === "function") toast("Couldn't render SVG");
      }
    };
  }

  Promise.resolve().then(updatePreview);
})();
