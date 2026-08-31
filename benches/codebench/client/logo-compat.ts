"use strict";

(() => {
  const originalQrOptions = window.qrOptions;
  const originalRenderQR = window.renderQR;
  const fileInput = document.querySelector("#qLogo");
  const removeButton = document.querySelector("#qLogoRemove");
  if (typeof originalQrOptions !== "function" || typeof originalRenderQR !== "function" || !fileInput) return;

  // Icon paths are from Lucide Icons (ISC). See benches/codebench/THIRD_PARTY_NOTICES.md.
  const icons = {
    link: {
      label: "Link",
      content: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
        + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    },
    type: {
      label: "Text",
      content: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    },
    wifi: {
      label: "Wi-Fi",
      content: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/>'
        + '<path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
    },
    briefcase: {
      label: "vCard",
      content: '<rect width="20" height="14" x="2" y="6" rx="2"/>'
        + '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
        + '<path d="M2 13a18.15 18.15 0 0 0 20 0"/><path d="M12 12h.01"/>',
    },
    contact: {
      label: "Contact",
      content: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    },
    mail: {
      label: "Email",
      content: '<rect width="20" height="16" x="2" y="4" rx="2"/>'
        + '<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    },
    message: {
      label: "SMS",
      content: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    },
    phone: {
      label: "Phone",
      content: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07'
        + ' 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3'
        + 'a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91'
        + 'a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69'
        + 'A2 2 0 0 1 22 16.92Z"/>',
    },
    location: {
      label: "Location",
      content: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/>'
        + '<circle cx="12" cy="10" r="3"/>',
    },
    calendar: {
      label: "Event",
      content: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/>'
        + '<path d="M3 10h18"/>',
    },
    heart: {
      label: "Heart",
      content: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06'
        + 'a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/>',
    },
  };
  const templateIcons = {
    url: "link",
    text: "type",
    wifi: "wifi",
    vcard: "briefcase",
    email: "mail",
    sms: "message",
    tel: "phone",
    geo: "location",
    event: "calendar",
  };

  let remoteLogoData = null;
  let presetMode = "auto";
  let requestGeneration = 0;

  const presetField = document.createElement("div");
  presetField.className = "f";
  presetField.style.marginTop = "12px";
  presetField.innerHTML = '<span>Built-in icon</span><div class="chips" id="qLogoPresets" style="margin-bottom:0"></div>'
    + '<p class="hint" style="margin:6px 0 0">Standard picks an icon for the selected content type.</p>';
  fileInput.insertAdjacentElement("afterend", presetField);

  const field = document.createElement("label");
  field.className = "f";
  field.style.marginTop = "12px";
  field.innerHTML = '<span>Logo URL <small>(HTTPS, CORS required)</small></span>'
    + '<div class="btn-row"><input type="url" id="qLogoUrl" placeholder="https://example.com/logo.png" style="flex:1;min-width:0">'
    + '<button type="button" class="btn ghost" id="qLogoUrlLoad">Load URL</button></div>'
    + '<p class="hint" id="qLogoUrlStatus" style="margin:6px 0 0">Fetched directly by your browser.</p>';
  presetField.insertAdjacentElement("afterend", field);

  const presetHost = document.querySelector("#qLogoPresets");
  const urlInput = document.querySelector("#qLogoUrl");
  const loadButton = document.querySelector("#qLogoUrlLoad");
  const status = document.querySelector("#qLogoUrlStatus");
  const originalRemove = removeButton?.onclick;
  const defaultStatus = "Fetched directly by your browser.";

  function currentTemplate() {
    return document.querySelector("#qrChips .chip[aria-pressed='true']")?.dataset.t || "url";
  }

  function iconSvg(name) {
    const icon = icons[name];
    if (!icon) return "";
    const foreground = document.querySelector("#qFg")?.value || "#16150f";
    const background = document.querySelector("#qTransparent")?.checked
      ? "#ffffff"
      : (document.querySelector("#qBg")?.value || "#ffffff");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
      + `<rect x="1.5" y="1.5" width="61" height="61" rx="15" fill="${background}" stroke="${foreground}" stroke-width="3"/>`
      + `<g transform="translate(12 12) scale(1.6667)" fill="none" stroke="${foreground}" stroke-width="2.3"`
      + ` stroke-linecap="round" stroke-linejoin="round">${icon.content}</g></svg>`;
  }

  function iconDataUrl(name) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(iconSvg(name));
  }

  function buttonIcon(name) {
    return `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"`
      + ` stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
      + icons[name].content + "</svg>";
  }

  function activePreset() {
    if (presetMode === "none") return null;
    if (presetMode === "auto") return templateIcons[currentTemplate()] || null;
    return icons[presetMode] ? presetMode : null;
  }

  function syncPresetButtons() {
    presetHost.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.preset === presetMode));
    });
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.className = error ? "err" : "hint";
    status.style.margin = "6px 0 0";
  }

  function clearRemote(clearInput = true) {
    requestGeneration += 1;
    remoteLogoData = null;
    loadButton.disabled = false;
    if (clearInput) urlInput.value = "";
    setStatus(defaultStatus);
  }

  function clearUploadedLogo() {
    if (typeof originalRemove === "function") originalRemove.call(removeButton);
  }

  function selectPreset(mode) {
    presetMode = mode;
    clearRemote();
    clearUploadedLogo();
    syncPresetButtons();
    if (removeButton) removeButton.style.display = activePreset() ? "" : "none";
    originalRenderQR();
  }

  const presetButtons = [
    ["auto", "Standard", ""],
    ["none", "None", ""],
    ...Object.entries(icons).map(([name, icon]) => [name, icon.label, buttonIcon(name)]),
  ];
  presetButtons.forEach(([name, label, icon]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.preset = name;
    button.setAttribute("aria-pressed", "false");
    button.title = label;
    button.innerHTML = icon ? `${icon}<span>${label}</span>` : label;
    button.addEventListener("click", () => selectPreset(name));
    presetHost.appendChild(button);
  });
  syncPresetButtons();

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read the image."));
      reader.readAsDataURL(blob);
    });
  }

  function normalizeImageBlob(blob, url) {
    if (blob.size > 10 * 1024 * 1024) throw new Error("The image is over 10 MB.");
    if (blob.type.startsWith("image/")) return blob;
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
    const mime = {
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
    }[extension];
    if (!mime) throw new Error("The URL didn't return a supported image.");
    return blob.slice(0, blob.size, mime);
  }

  async function loadRemoteLogo() {
    const value = urlInput.value.trim();
    if (!value) {
      clearRemote(false);
      originalRenderQR();
      if (removeButton && !fileInput.files.length && !activePreset()) removeButton.style.display = "none";
      return;
    }

    let url;
    try {
      url = new URL(value);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      setStatus("Enter a valid HTTPS image URL.", true);
      return;
    }

    presetMode = "none";
    syncPresetButtons();
    remoteLogoData = null;
    clearUploadedLogo();
    const generation = ++requestGeneration;
    loadButton.disabled = true;
    setStatus("Loading image…");

    try {
      const response = await fetch(url.href, {
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`Image server returned ${response.status}.`);
      const blob = normalizeImageBlob(await response.blob(), url.href);
      const dataUrl = await blobToDataUrl(blob);
      if (generation !== requestGeneration) return;
      remoteLogoData = dataUrl;
      if (removeButton) removeButton.style.display = "";
      setStatus("Remote logo loaded.");
      originalRenderQR();
    } catch (error) {
      if (generation !== requestGeneration) return;
      remoteLogoData = null;
      if (removeButton) removeButton.style.display = "none";
      setStatus(`${error.message || "Couldn't load the image."} Remote images must allow CORS.`, true);
      originalRenderQR();
    } finally {
      if (generation === requestGeneration) loadButton.disabled = false;
    }
  }

  window.qrOptions = function logoQrOptions(...args) {
    const options = originalQrOptions(...args);
    const preset = activePreset();
    if (preset) {
      options.image = iconDataUrl(preset);
      options.imageOptions = {
        margin: 4,
        imageSize: Number(document.querySelector("#qLogoSize")?.value) || 0.3,
        hideBackgroundDots: Boolean(document.querySelector("#qLogoClear")?.checked),
        saveAsBlob: false,
      };
    } else if (remoteLogoData) {
      options.image = remoteLogoData;
      options.imageOptions = {
        margin: 4,
        imageSize: Number(document.querySelector("#qLogoSize")?.value) || 0.3,
        hideBackgroundDots: Boolean(document.querySelector("#qLogoClear")?.checked),
        saveAsBlob: false,
      };
    } else if (typeof options.image === "string" && options.image.startsWith("data:") && options.imageOptions) {
      options.imageOptions.saveAsBlob = false;
      delete options.imageOptions.crossOrigin;
    }
    return options;
  };

  loadButton.addEventListener("click", loadRemoteLogo);
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadRemoteLogo();
    }
  });
  fileInput.addEventListener("change", () => {
    presetMode = "none";
    syncPresetButtons();
    clearRemote();
  });

  if (removeButton) {
    removeButton.onclick = (event) => {
      if (typeof originalRemove === "function") originalRemove.call(removeButton, event);
      presetMode = "none";
      syncPresetButtons();
      clearRemote();
      originalRenderQR();
    };
    removeButton.style.display = "";
  }

  originalRenderQR();
})();
