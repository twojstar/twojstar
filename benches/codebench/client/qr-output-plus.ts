"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const row = $("#qrPng")?.closest(".btn-row");
  if (!row || $("#qrWebp")) return;

  const style = document.createElement("style");
  style.textContent = `
    .qr-terminal-box{margin-top:10px;border:1px solid var(--line);background:var(--panel);padding:10px}
    .qr-terminal-box pre{margin:0 0 9px;max-height:300px;overflow:auto;white-space:pre;background:var(--paper);border:1px solid var(--line);padding:10px;font:10px/1 "Space Mono",monospace}
    @media(max-width:560px){.qr-terminal-box pre{font-size:8px}}
  `;
  document.head.appendChild(style);

  const button = (id, text) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "btn ghost";
    element.id = id;
    element.textContent = text;
    return element;
  };
  const webp = button("qrWebp", "WebP");
  const jpeg = button("qrJpeg", "JPEG");
  const terminal = button("qrTerminal", "Terminal");
  row.append(webp, jpeg, terminal);

  const box = document.createElement("div");
  box.id = "qrTerminalBox";
  box.className = "qr-terminal-box";
  box.hidden = true;
  box.innerHTML = '<pre id="qrTerminalText" aria-label="Compact Unicode QR"></pre><div class="btn-row"><button class="btn ghost" id="qrTerminalCopy" type="button">Copy text</button><button class="btn ghost" id="qrTerminalSave" type="button">Download TXT</button></div>';
  row.insertAdjacentElement("afterend", box);

  const name = (extension) => `qr-${$("#qrChips .chip[aria-pressed='true']")?.dataset.t || "qr"}.${extension}`;
  const notify = (message) => { if (typeof toast === "function") toast(message); };
  const save = (blob, fileName) => {
    if (typeof download === "function") return download(blob, fileName);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  async function currentSvg() {
    if (typeof window.codebenchCurrentQrSvg === "function") return window.codebenchCurrentQrSvg();
    const bare = await window.qrBareSVG();
    if (!bare) throw new Error("QR render is empty.");
    if (!$("#qFrame")?.checked || typeof window.frameSVG !== "function" || typeof window.frameOpts !== "function") return bare;
    return window.frameSVG(bare, window.frameOpts());
  }

  async function raster(type) {
    const svg = await currentSvg();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    const width = Number.parseFloat(root.getAttribute("width") || "") || viewBox?.[2] || 600;
    const height = Number.parseFloat(root.getAttribute("height") || "") || viewBox?.[3] || 600;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * 2));
    canvas.height = Math.max(1, Math.round(height * 2));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    if (type === "image/jpeg") {
      context.fillStyle = $("#qBg")?.value || "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Image encoding failed.")),
        type,
        type === "image/jpeg" ? .92 : undefined,
      ));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const number = (element, attribute) => Number.parseFloat(element.getAttribute(attribute) || "0");
  async function terminalMatrix() {
    if (typeof QRCodeStyling !== "function") throw new Error("QR renderer is unavailable.");
    const renderer = new QRCodeStyling({
      width: 600, height: 600, type: "svg", margin: 0,
      data: typeof buildContent === "function" ? (buildContent() || " ") : " ",
      qrOptions: { errorCorrectionLevel: $("#qEc")?.value || "Q" },
      dotsOptions: { type: "square", color: "#000", roundSize: false },
      cornersSquareOptions: { color: "#000" },
      cornersDotOptions: { color: "#000" },
      backgroundOptions: { color: "#fff" },
    });
    const raw = await renderer.getRawData("svg");
    const svg = typeof raw === "string" ? raw : await raw.text();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const rects = Array.from(doc.querySelectorAll(
      'clipPath[id^="clip-path-dot-color-"] rect,clipPath[id^="clip-path-corners-square-color-"] rect,clipPath[id^="clip-path-corners-dot-color-"] rect',
    )).map((rect) => ({ x: number(rect, "x"), y: number(rect, "y"), w: number(rect, "width"), h: number(rect, "height") }));
    const unit = Math.min(...rects.flatMap((rect) => [rect.w, rect.h]).filter((value) => value > 0));
    const modules = rects.filter((rect) => Math.abs(rect.w - unit) < unit * .2 && Math.abs(rect.h - unit) < unit * .2);
    if (!modules.length) throw new Error("Could not read QR modules.");
    const minX = Math.min(...modules.map((rect) => rect.x));
    const minY = Math.min(...modules.map((rect) => rect.y));
    const maxX = Math.max(...modules.map((rect) => rect.x));
    const maxY = Math.max(...modules.map((rect) => rect.y));
    const width = Math.round((maxX - minX) / unit) + 1;
    const height = Math.round((maxY - minY) / unit) + 1;
    const matrix = Array.from({ length: height }, () => Array(width).fill(false));
    modules.forEach((rect) => {
      const column = Math.round((rect.x - minX) / unit);
      const rowIndex = Math.round((rect.y - minY) / unit);
      if (matrix[rowIndex]?.[column] !== undefined) matrix[rowIndex][column] = true;
    });
    return matrix;
  }

  function compactUnicode(matrix) {
    const border = 2;
    const height = matrix.length;
    const width = matrix[0]?.length || 0;
    const get = (rowIndex, column) => rowIndex >= 0 && column >= 0 && rowIndex < height && column < width && matrix[rowIndex][column];
    const lines = [];
    for (let rowIndex = -border; rowIndex < height + border; rowIndex += 2) {
      let line = "";
      for (let column = -border; column < width + border; column += 1) {
        const top = get(rowIndex, column);
        const bottom = get(rowIndex + 1, column);
        line += top ? (bottom ? "█" : "▀") : (bottom ? "▄" : " ");
      }
      lines.push(line);
    }
    return lines.join("\n");
  }
  const terminalText = async () => compactUnicode(await terminalMatrix());

  webp.onclick = async () => {
    webp.disabled = true;
    try { save(await raster("image/webp"), name("webp")); }
    catch (error) { console.error(error); notify("Couldn't render WebP"); }
    finally { webp.disabled = false; }
  };
  jpeg.onclick = async () => {
    jpeg.disabled = true;
    try { save(await raster("image/jpeg"), name("jpg")); }
    catch (error) { console.error(error); notify("Couldn't render JPEG"); }
    finally { jpeg.disabled = false; }
  };
  terminal.onclick = async () => {
    terminal.disabled = true;
    try {
      $("#qrTerminalText").textContent = await terminalText();
      box.hidden = !box.hidden;
    } catch (error) { console.error(error); notify("Couldn't build terminal QR"); }
    finally { terminal.disabled = false; }
  };
  $("#qrTerminalCopy").onclick = async () => {
    try {
      const text = $("#qrTerminalText").textContent || await terminalText();
      await navigator.clipboard.writeText(text);
      notify("Terminal QR copied");
    } catch { notify("Clipboard text copy isn't available"); }
  };
  $("#qrTerminalSave").onclick = async () => {
    const text = $("#qrTerminalText").textContent || await terminalText();
    save(new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }), name("txt"));
  };
})();
