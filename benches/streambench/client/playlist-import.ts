const fileInput = document.querySelector("#playlistFile");
const parseButton = document.querySelector("#parsePlaylist");
const playlistText = document.querySelector("#playlistText");
const providerLoad = document.querySelector("#loadProvider");
const entries = document.querySelector("#playlistEntries");
const libraryEntries = document.querySelector("#libraryEntries");
const shell = document.querySelector(".media-shell");
const audio = document.querySelector("#audioPlayer");

let localItems = [];
let selectedItem = null;
let decorationPending = false;

const style = document.createElement("style");
style.textContent = `
  .player-tabs{min-width:0}
  .player-tablist{display:flex;gap:7px;margin-bottom:10px}
  .player-tablist button{min-height:36px;padding:0 12px;background:#171c22;color:var(--muted);font-size:.76rem}
  .player-tablist button[aria-selected="true"]{border-color:#55e6a580;background:#55e6a514;color:var(--accent)}
  .player-tabs[data-view="metadata"] .media-shell{display:none}
  .player-metadata{display:none;min-height:360px;padding:18px;border:1px solid #252d35;border-radius:14px;background:#090c10}
  .player-tabs[data-view="metadata"] .player-metadata{display:block}
  .player-metadata-empty{min-height:320px;display:grid;place-items:center;margin:0;color:var(--muted);text-align:center}
  .player-metadata-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:14px}
  .player-metadata-head h3{margin:3px 0 0;font-size:1.05rem}
  .player-metadata-kind{padding:5px 8px;border:1px solid #ffffff1f;border-radius:99px;color:var(--accent);font-size:.68rem;font-weight:750}
  .player-metadata-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
  .player-metadata-tags span{padding:4px 8px;border:1px solid #55e6a533;border-radius:99px;background:#55e6a50d;color:#bdc7d0;font-size:.7rem}
  .player-metadata-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}
  .player-metadata-grid>div{min-width:0;padding:10px;border:1px solid #ffffff12;border-radius:10px;background:#0d1115}
  .player-metadata-grid>div.wide{grid-column:1/-1}
  .player-metadata-grid dt{color:var(--muted);font-size:.65rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .player-metadata-grid dd{overflow-wrap:anywhere;margin:5px 0 0;font-size:.78rem;line-height:1.4}
  .media-shell[data-mode="audio"]{grid-template-rows:minmax(0,1fr) auto;padding:20px}
  .radio-now-playing{display:none;width:100%;align-self:stretch;place-items:center;gap:12px;padding:12px 16px 2px;text-align:center}
  .media-shell[data-mode="audio"] .radio-now-playing{display:grid}
  .radio-now-playing img,.radio-artwork-fallback{width:min(220px,55vw);aspect-ratio:1;object-fit:contain;border:1px solid #ffffff1a;border-radius:22px;background:#090b0e}
  .radio-artwork-fallback{display:grid;place-items:center;color:var(--accent);font-size:4rem}
  .radio-artwork-copy{min-width:0;max-width:100%}
  .radio-artwork-copy strong,.radio-artwork-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .radio-artwork-copy span{margin-top:4px;color:var(--muted);font-size:.76rem}
  .media-shell[data-mode="audio"] audio{align-self:end}
  @media(max-width:620px){.player-metadata{min-height:220px}.player-metadata-empty{min-height:180px}.player-metadata-grid{grid-template-columns:1fr}.player-metadata-grid>div.wide{grid-column:auto}.radio-now-playing img,.radio-artwork-fallback{width:min(150px,48vw)}.radio-now-playing{padding-top:4px}}
`;
document.head.append(style);

const artworkStage = document.createElement("div");
artworkStage.className = "radio-now-playing";
artworkStage.setAttribute("aria-live", "polite");
const artworkImage = document.createElement("img");
artworkImage.alt = "";
artworkImage.referrerPolicy = "no-referrer";
const artworkFallback = document.createElement("span");
artworkFallback.className = "radio-artwork-fallback";
artworkFallback.textContent = "♫";
const artworkCopy = document.createElement("div");
artworkCopy.className = "radio-artwork-copy";
const artworkTitle = document.createElement("strong");
artworkTitle.textContent = "Radio";
const artworkMeta = document.createElement("span");
artworkMeta.textContent = "Stream audio";
artworkCopy.append(artworkTitle, artworkMeta);
artworkStage.append(artworkImage, artworkFallback, artworkCopy);
audio.before(artworkStage);

const playerTabs = document.createElement("div");
playerTabs.className = "player-tabs";
playerTabs.dataset.view = "player";
const tabList = document.createElement("div");
tabList.className = "player-tablist";
tabList.setAttribute("role", "tablist");
tabList.setAttribute("aria-label", "Widok odtwarzacza");
const playerTab = document.createElement("button");
playerTab.type = "button";
playerTab.setAttribute("role", "tab");
playerTab.setAttribute("aria-selected", "true");
playerTab.textContent = "Odtwarzacz";
const metadataTab = document.createElement("button");
metadataTab.type = "button";
metadataTab.setAttribute("role", "tab");
metadataTab.setAttribute("aria-selected", "false");
metadataTab.textContent = "Metadane";
tabList.append(playerTab, metadataTab);

const metadataPanel = document.createElement("section");
metadataPanel.className = "player-metadata";
metadataPanel.setAttribute("role", "tabpanel");
const metadataEmpty = document.createElement("p");
metadataEmpty.className = "player-metadata-empty";
metadataEmpty.textContent = "Wybierz pozycję z playlisty, aby zobaczyć tagi i metadane.";
const metadataContent = document.createElement("div");
metadataContent.hidden = true;
const metadataHead = document.createElement("div");
metadataHead.className = "player-metadata-head";
const metadataHeadingCopy = document.createElement("div");
const metadataEyebrow = document.createElement("p");
metadataEyebrow.className = "eyebrow";
metadataEyebrow.textContent = "Wybrana pozycja";
const metadataTitle = document.createElement("h3");
metadataHeadingCopy.append(metadataEyebrow, metadataTitle);
const metadataKind = document.createElement("span");
metadataKind.className = "player-metadata-kind";
metadataHead.append(metadataHeadingCopy, metadataKind);
const metadataTags = document.createElement("div");
metadataTags.className = "player-metadata-tags";
const metadataGrid = document.createElement("dl");
metadataGrid.className = "player-metadata-grid";
metadataContent.append(metadataHead, metadataTags, metadataGrid);
metadataPanel.append(metadataEmpty, metadataContent);

shell.before(playerTabs);
playerTabs.append(tabList, shell, metadataPanel);

function selectPlayerTab(view) {
  playerTabs.dataset.view = view;
  playerTab.setAttribute("aria-selected", String(view === "player"));
  metadataTab.setAttribute("aria-selected", String(view === "metadata"));
}

playerTab.addEventListener("click", () => selectPlayerTab("player"));
metadataTab.addEventListener("click", () => selectPlayerTab("metadata"));

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parseAttributes(line) {
  const attributes = {};
  for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function extinfTitle(line) {
  let quoted = false;
  for (let index = "#EXTINF:".length; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== "\\") quoted = !quoted;
    if (character === "," && !quoted) return line.slice(index + 1).trim();
  }
  return "";
}

function parseLocalPlaylist(source, defaultRadio = false) {
  const items = [];
  let pending = null;
  for (const rawLine of String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const attributes = parseAttributes(line);
      pending = {
        id: attributes["tvg-id"] || "",
        title: extinfTitle(line) || attributes["tvg-name"] || "",
        group: attributes["group-title"] || "",
        logo: safeUrl(attributes["tvg-logo"]),
        country: attributes["tvg-country"] || "",
        language: attributes["tvg-language"] || "",
        tags: attributes["tvg-tags"] || "",
        codec: attributes["tvg-codec"] || "",
        bitrate: attributes["tvg-bitrate"] || "",
        quality: attributes["tvg-quality"] || attributes.quality || attributes.resolution || "",
        radio: attributes.radio === "true" || attributes.type === "radio",
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    const url = safeUrl(line);
    if (!url) {
      pending = null;
      continue;
    }
    items.push({
      ...pending,
      title: pending?.title || new URL(url).hostname,
      group: pending?.group || "Bez grupy",
      radio: pending?.radio || defaultRadio || /\.(mp3|aac|m4a|ogg|opus|flac)(?:$|[?#])/i.test(url),
      url,
    });
    pending = null;
  }
  return items;
}

function itemMeta(item) {
  return [item.group, item.tags, item.codec, item.bitrate, item.quality].filter(Boolean).join(" · ");
}

function metadataField(label, value, wide = false) {
  if (!value) return null;
  const field = document.createElement("div");
  if (wide) field.className = "wide";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  field.append(term, description);
  return field;
}

function renderMetadata(item) {
  metadataEmpty.hidden = Boolean(item);
  metadataContent.hidden = !item;
  if (!item) return;

  metadataTitle.textContent = item.title || "Bez nazwy";
  metadataKind.textContent = item.radio ? "RADIO" : "STREAM";
  const tags = String(item.tags || "").split(/[,;]+/).map((tag) => tag.trim()).filter(Boolean);
  metadataTags.replaceChildren(...tags.map((tag) => {
    const chip = document.createElement("span");
    chip.textContent = tag;
    return chip;
  }));
  metadataTags.hidden = tags.length === 0;

  const fields = [
    metadataField("Grupa", item.group),
    metadataField("tvg-id", item.id),
    metadataField("Kraj", item.country),
    metadataField("Język", item.language),
    metadataField("Kodek", item.codec),
    metadataField("Bitrate", item.bitrate),
    metadataField("Jakość", item.quality),
    metadataField("Logo", item.logo, true),
    metadataField("Adres źródła", item.url, true),
  ].filter(Boolean);
  metadataGrid.replaceChildren(...fields);
}

function fallbackArtwork(radio = false) {
  const fallback = document.createElement("span");
  fallback.className = "channel-fallback";
  fallback.textContent = radio ? "♫" : "▶";
  return fallback;
}

function setRowArtwork(row, item) {
  const action = row.querySelector(".entry-action");
  if (!action) return;
  const current = action.querySelector(".channel-logo,.channel-fallback");
  if (!item.logo) return;
  if (current?.classList.contains("channel-logo") && current.src === item.logo) return;

  const logo = document.createElement("img");
  logo.className = "channel-logo";
  logo.src = item.logo;
  logo.alt = "";
  logo.loading = "lazy";
  logo.referrerPolicy = "no-referrer";
  logo.addEventListener("error", () => logo.replaceWith(fallbackArtwork(item.radio)), { once: true });
  current?.replaceWith(logo);
}

function decorateRows() {
  decorationPending = false;
  if (!localItems.length) return;
  const used = new Set();
  for (const row of entries.querySelectorAll(".playlist-entry")) {
    const action = row.querySelector(".entry-action");
    const title = row.querySelector(".channel-name")?.textContent?.trim() || "";
    const meta = row.querySelector(".channel-meta")?.textContent || "";
    let index = localItems.findIndex((item, itemIndex) => !used.has(itemIndex)
      && item.title === title
      && (!item.group || item.group === "Bez grupy" || meta.includes(item.group)));
    if (index < 0) index = localItems.findIndex((item, itemIndex) => !used.has(itemIndex) && item.title === title);
    if (index < 0 || !action) continue;
    used.add(index);
    action.dataset.localPlaylistIndex = String(index);
    setRowArtwork(row, localItems[index]);
  }
}

function scheduleDecoration() {
  if (decorationPending) return;
  decorationPending = true;
  requestAnimationFrame(() => requestAnimationFrame(decorateRows));
}

function renderArtwork(item) {
  if (!item) return;
  selectedItem = item;
  artworkTitle.textContent = item.title || "Radio";
  artworkMeta.textContent = itemMeta(item) || "Stream audio";
  artworkImage.hidden = !item.logo;
  artworkFallback.hidden = Boolean(item.logo);
  artworkImage.removeAttribute("src");
  if (item.logo) artworkImage.src = item.logo;
  renderMetadata(item);
}

artworkImage.addEventListener("error", () => {
  artworkImage.hidden = true;
  artworkFallback.hidden = false;
});

function itemFromAction(action) {
  const index = Number(action?.dataset.localPlaylistIndex);
  if (Number.isInteger(index) && localItems[index]) return localItems[index];
  const row = action?.closest(".playlist-entry,.library-entry");
  const title = row?.querySelector(".channel-name,strong")?.textContent?.trim() || "";
  const logo = row?.querySelector(".channel-logo")?.src || "";
  const meta = row?.querySelector(".channel-meta,span")?.textContent?.trim() || "";
  const radio = row?.querySelector(".channel-fallback")?.textContent === "♫"
    || [...(row?.querySelectorAll(".channel-badge") || [])].some((badge) => /audio|radio/i.test(badge.textContent));
  if (!title) return null;
  return { title, logo, group: meta, radio };
}

entries.addEventListener("click", (event) => {
  const action = event.target.closest(".entry-action");
  const item = itemFromAction(action);
  if (item) renderArtwork(item);
}, true);

libraryEntries?.addEventListener("click", (event) => {
  const action = event.target.closest(".library-play");
  if (!action) return;
  const title = action.querySelector("strong")?.textContent?.trim() || "";
  const item = localItems.find((entry) => entry.title === title);
  if (item) renderArtwork(item);
}, true);

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  const readText = file.text.bind(file);
  const sourcePromise = readText();
  try {
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => sourcePromise,
    });
  } catch {
    // Keep the native reader when the file object is not extensible.
  }

  sourcePromise.then((source) => {
    localItems = parseLocalPlaylist(source, /radio/i.test(file.name));
    selectedItem = null;
    renderMetadata(null);
    scheduleDecoration();
  }).catch(() => {});
}, true);

parseButton.addEventListener("click", () => {
  localItems = parseLocalPlaylist(playlistText.value);
  selectedItem = null;
  renderMetadata(null);
  scheduleDecoration();
}, true);

providerLoad.addEventListener("click", () => {
  localItems = [];
  selectedItem = null;
  renderMetadata(null);
}, true);

new MutationObserver(scheduleDecoration).observe(entries, { childList: true, subtree: true });
window.addEventListener("streambench:channel", (event) => {
  if (!event.detail?.title) return;
  if (selectedItem?.title === event.detail.title) renderArtwork(selectedItem);
});