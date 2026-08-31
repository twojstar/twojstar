import { classifyChannel } from "./channel-meta.js";
import { createLocalState, itemKey } from "./local-state.js";
import { parseM3uWorkspace, serializeM3u } from "./playlist-format.js";
import { submitPlaybackForm } from "./playback-submission.js";

const originalFetch = window.fetch.bind(window);
let sourceGeneration = 0;
let pendingProviderSource = null;

function providerRequestMeta(input) {
  try {
    const rawUrl = input instanceof URL ? input.href : typeof input === "string" ? input : input?.url;
    const requestUrl = new URL(rawUrl, location.origin);
    if (requestUrl.pathname === "/api/playlist") {
      return { providerId: requestUrl.searchParams.get("provider") || "provider" };
    }
    const legacy = requestUrl.pathname.match(/^\/api\/providers\/([a-z0-9-]+)\/playlist$/);
    return legacy ? { providerId: legacy[1] } : null;
  } catch {
    return null;
  }
}

window.fetch = async (...args) => {
  const meta = providerRequestMeta(args[0]);
  const generation = meta ? ++sourceGeneration : sourceGeneration;
  const response = await originalFetch(...args);
  if (meta && response.ok) {
    const clone = response.clone();
    clone.text().then((source) => {
      if (generation !== sourceGeneration) return;
      pendingProviderSource?.(source, meta);
    }).catch(() => {});
  }
  return response;
};

const library = createLocalState();
const rowItems = new WeakMap();
const itemByKey = new Map();
let sourceItems = [];
let sourceLabel = "";
let sourceOptions = { providerId: "local", providerLabel: "Lokalna", defaultRadio: false };
let activeEditKey = "";
let creatingItem = null;
let pendingCaptureOptions = null;
let restoredProvider = false;
let observer = null;
let submittingWorkspaceItem = false;

const addCurrentButton = document.querySelector("#addCurrentStream") || (() => {
  const button = document.createElement("button");
  button.id = "addCurrentStream";
  button.type = "button";
  button.className = "secondary";
  button.textContent = "Dodaj bieżący stream do playlisty";
  document.querySelector("#streamForm .input-row")?.insertAdjacentElement("afterend", button);
  return button;
})();

const ui = {
  form: document.querySelector("#streamForm"),
  url: document.querySelector("#streamUrl"),
  mode: document.querySelector("#mediaMode"),
  shell: document.querySelector(".media-shell"),
  title: document.querySelector("#nowPlaying"),
  addCurrent: addCurrentButton,
  provider: document.querySelector("#providerName"),
  file: document.querySelector("#playlistFile"),
  text: document.querySelector("#playlistText"),
  parse: document.querySelector("#parsePlaylist"),
  search: document.querySelector("#playlistSearch"),
  entries: document.querySelector("#playlistEntries"),
  exportButton: document.querySelector("#exportPlaylist"),
  copyButton: document.querySelector("#copyPlaylist"),
  workspaceStatus: document.querySelector("#workspaceStatus"),
  dedupe: document.querySelector("#dedupeExport"),
  libraryView: document.querySelector("#libraryView"),
  libraryEntries: document.querySelector("#libraryEntries"),
  libraryEmpty: document.querySelector("#libraryEmpty"),
  libraryCount: document.querySelector("#libraryCount"),
  clearRecent: document.querySelector("#clearRecent"),
  dialog: document.querySelector("#editChannelDialog"),
  dialogTitle: document.querySelector("#editChannelDialog h2"),
  editForm: document.querySelector("#editChannelForm"),
  editTitle: document.querySelector("#editTitle"),
  editUrl: document.querySelector("#editUrl"),
  editGroup: document.querySelector("#editGroup"),
  editId: document.querySelector("#editId"),
  editLogo: document.querySelector("#editLogo"),
  editCountry: document.querySelector("#editCountry"),
  editLanguage: document.querySelector("#editLanguage"),
  editRadio: document.querySelector("#editRadio"),
  resetEdit: document.querySelector("#resetChannelEdit"),
  cancelEdit: document.querySelector("#cancelChannelEdit"),
};

function providerLabel(providerId) {
  const option = [...ui.provider.options].find((entry) => entry.value === providerId);
  return option?.textContent?.trim() || providerId;
}

function classifyItem(item) {
  const classified = classifyChannel(item.url, {
    title: item.title,
    radio: item.radio,
    quality: item.quality,
  });
  if (item.hls) classified.playback = "HLS";
  return { ...item, ...classified };
}

function effectiveItem(item) {
  return classifyItem(library.applyEdit(item));
}

function setWorkspaceStatus(message, state = "idle") {
  ui.workspaceStatus.textContent = message;
  ui.workspaceStatus.dataset.state = state;
}

function captureSource(source, {
  label = "Playlista",
  providerId = "local",
  providerLabel: labelOverride = "Lokalna",
  defaultRadio = false,
} = {}) {
  sourceLabel = label;
  sourceOptions = { providerId, providerLabel: labelOverride, defaultRadio };
  sourceItems = parseM3uWorkspace(source, {
    providerId,
    providerLabel: labelOverride,
    defaultRadio,
  }).map((item) => ({ ...item, stateKey: itemKey(item) }));
  setWorkspaceStatus(
    sourceItems.length ? `${label}: ${sourceItems.length} pozycji` : `${label}: brak pozycji`,
    sourceItems.length ? "idle" : "error",
  );
  scheduleEnhance();
}

pendingProviderSource = (source, meta) => {
  const label = providerLabel(meta.providerId);
  captureSource(source, {
    label,
    providerId: meta.providerId,
    providerLabel: label,
    defaultRadio: meta.providerId === "radio-browser",
  });
};

function channelMeta(item) {
  return [item.group, item.country, item.language].filter(Boolean).join(" · ");
}

function sourceSearch(item) {
  const classified = classifyChannel(item.url, {
    title: item.sourceTitle || item.title,
    radio: item.radio,
    quality: item.quality,
  });
  return [
    item.id,
    item.sourceTitle || item.title,
    channelMeta(item),
    item.providerLabel,
    classified.protocol,
    classified.playback,
    classified.quality,
  ].filter(Boolean).join(" ").toLocaleLowerCase("pl");
}

function visibleSourceItems() {
  const query = ui.search.value.trim().toLocaleLowerCase("pl");
  return query ? sourceItems.filter((item) => sourceSearch(item).includes(query)) : sourceItems;
}

function updateRowVisuals(row, item) {
  const name = row.querySelector(".channel-name");
  const meta = row.querySelector(".channel-meta");
  const logo = row.querySelector(".channel-logo");
  if (name) name.textContent = item.title;
  if (meta) meta.textContent = channelMeta(item);
  if (logo && item.logo && logo.src !== item.logo) logo.src = item.logo;
}

function createRowTools() {
  const tools = document.createElement("span");
  tools.className = "entry-tools";
  for (const [action, label, title] of [
    ["favorite", "☆", "Ulubione"],
    ["edit", "✎", "Edytuj"],
    ["hide", "×", "Ukryj"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.workspaceAction = action;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    tools.append(button);
  }
  return tools;
}

function enhanceRows() {
  if (!ui.entries || !observer) return;
  observer.disconnect();
  itemByKey.clear();
  const rows = [...ui.entries.querySelectorAll(".playlist-entry")];
  const visibleItems = visibleSourceItems();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const base = visibleItems[index];
    if (!base) continue;
    const item = effectiveItem(base);
    const key = itemKey(item);
    rowItems.set(row, item);
    itemByKey.set(key, item);
    row.dataset.workspaceKey = key;
    row.hidden = library.isHidden(item);
    updateRowVisuals(row, item);

    let tools = row.querySelector(":scope > .entry-tools");
    if (!tools) {
      tools = createRowTools();
      row.append(tools);
    }
    const favorite = tools.querySelector('[data-workspace-action="favorite"]');
    const hide = tools.querySelector('[data-workspace-action="hide"]');
    favorite.textContent = library.isFavorite(item) ? "★" : "☆";
    favorite.title = library.isFavorite(item) ? "Usuń z ulubionych" : "Dodaj do ulubionych";
    hide.textContent = library.isHidden(item) ? "↩" : "×";
    hide.title = library.isHidden(item) ? "Przywróć" : "Ukryj";
  }

  observer.observe(ui.entries, { childList: true, subtree: true });
  renderLibrary();
}

function scheduleEnhance() {
  requestAnimationFrame(() => requestAnimationFrame(enhanceRows));
}

function sourceIndexFor(item) {
  return sourceItems.findIndex((entry) => itemKey(effectiveItem(entry)) === itemKey(item));
}

function playItem(item, sourceIndex = sourceIndexFor(item), { preserveAttempt = false } = {}) {
  const active = ui.entries.querySelector('[aria-current="true"]');
  active?.removeAttribute("aria-current");
  const row = sourceIndex >= 0
    ? ui.entries.querySelector(`[data-playlist-index="${sourceIndex}"]`)?.closest(".playlist-entry")
    : [...ui.entries.querySelectorAll(".playlist-entry")]
      .find((entry) => entry.dataset.workspaceKey === itemKey(item));
  row?.querySelector(".entry-action")?.setAttribute("aria-current", "true");

  let targetUrl = item.url;
  if (item.hls && !/\.m3u8(?:$|[?#])/i.test(item.url)) {
    const marked = new URL(item.url);
    marked.hash = "streambench.m3u8";
    targetUrl = marked.href;
  }
  const previousMode = ui.mode.value;
  if (item.radio) ui.mode.value = "audio";
  ui.url.value = targetUrl;
  submittingWorkspaceItem = true;
  try {
    submitPlaybackForm(ui.form, {
      playlistIndex: sourceIndex,
      preserveSelection: sourceIndex >= 0,
      preserveAttempt,
    });
  } finally {
    submittingWorkspaceItem = false;
  }
  ui.mode.value = previousMode;
  ui.title.textContent = item.title;
  window.dispatchEvent(new CustomEvent("streambench:channel", {
    detail: { id: item.id || "", title: item.title || "" },
  }));
  library.addRecent(item);
  renderLibrary();
}

function fillEditor(item, creating = false) {
  creatingItem = creating ? item : null;
  activeEditKey = creating ? "" : itemKey(item);
  if (ui.dialogTitle) ui.dialogTitle.textContent = creating ? "Dodaj do playlisty" : "Edytuj pozycję";
  ui.resetEdit.hidden = creating;
  ui.editTitle.value = item.title || "";
  ui.editUrl.value = item.url || "";
  ui.editGroup.value = item.group === "Bez grupy" ? "" : item.group || "";
  ui.editId.value = item.id || "";
  ui.editLogo.value = item.logo || "";
  ui.editCountry.value = item.country || "";
  ui.editLanguage.value = item.language || "";
  ui.editRadio.checked = Boolean(item.radio);
  if (typeof ui.dialog.showModal === "function") ui.dialog.showModal();
  else ui.dialog.setAttribute("open", "");
}

function openEditor(item) {
  fillEditor(item);
}

function directItem() {
  let url;
  try {
    url = new URL(ui.url.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
  } catch {
    return null;
  }

  const title = url.hostname;
  return classifyItem({
    url: url.href,
    title,
    sourceTitle: title,
    group: "Własne",
    providerId: "local",
    providerLabel: "Własna",
    radio: ui.mode.value === "audio" || ui.shell?.dataset.mode === "audio",
    hls: /\.m3u8(?:$|[?#])/i.test(url.href),
  });
}

function openCreator() {
  const item = directItem();
  if (!item) {
    ui.url.setCustomValidity("Podaj poprawny adres HTTP lub HTTPS.");
    ui.url.reportValidity();
    ui.url.setCustomValidity("");
    return;
  }
  if (sourceItems.some((entry) => effectiveItem(entry).url === item.url)) {
    setWorkspaceStatus("Ten adres już jest na aktualnej playliście", "error");
    return;
  }
  fillEditor(item, true);
}

function closeEditor() {
  activeEditKey = "";
  creatingItem = null;
  ui.resetEdit.hidden = false;
  if (ui.dialogTitle) ui.dialogTitle.textContent = "Edytuj pozycję";
  if (typeof ui.dialog.close === "function") ui.dialog.close();
  else ui.dialog.removeAttribute("open");
}

function itemFromActiveEdit() {
  return itemByKey.get(activeEditKey)
    || sourceItems.map(effectiveItem).find((item) => itemKey(item) === activeEditKey)
    || ["favorites", "recent", "hidden"].flatMap((view) => library.items(view))
      .find((item) => itemKey(item) === activeEditKey)
    || null;
}

function libraryRow(item) {
  const row = document.createElement("li");
  row.className = "library-entry";
  row.dataset.libraryKey = itemKey(item);

  const play = document.createElement("button");
  play.type = "button";
  play.className = "library-play";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const meta = document.createElement("span");
  meta.textContent = [item.providerLabel, item.group, item.playback].filter(Boolean).join(" · ");
  play.append(title, meta);

  const actions = document.createElement("span");
  actions.className = "library-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.dataset.libraryAction = "edit";
  edit.textContent = "✎";
  edit.title = "Edytuj";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.dataset.libraryAction = ui.libraryView.value === "hidden" ? "unhide" : "favorite";
  toggle.textContent = ui.libraryView.value === "hidden" ? "↩" : library.isFavorite(item) ? "★" : "☆";
  toggle.title = ui.libraryView.value === "hidden" ? "Przywróć" : "Ulubione";
  actions.append(edit, toggle);

  row.append(play, actions);
  return row;
}

function renderLibrary() {
  const view = ui.libraryView.value;
  const items = library.items(view).map(classifyItem);
  ui.libraryEntries.replaceChildren(...items.map(libraryRow));
  ui.libraryEmpty.hidden = items.length > 0;
  ui.libraryCount.textContent = String(items.length);
  ui.clearRecent.hidden = view !== "recent" || items.length === 0;
}

function exportedItems() {
  return sourceItems
    .map(effectiveItem)
    .filter((item) => !library.isHidden(item));
}

function exportText() {
  return serializeM3u(exportedItems(), { dedupe: ui.dedupe.checked });
}

function exportFile() {
  const text = exportText();
  if (text === "#EXTM3U\n") {
    setWorkspaceStatus("Brak pozycji do eksportu", "error");
    return;
  }
  const blob = new Blob([text], { type: "audio/x-mpegurl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = sourceLabel.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, "-").replace(/^-|-$/g, "") || "streambench";
  link.href = url;
  link.download = `${slug}-edited.m3u8`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setWorkspaceStatus(`Wyeksportowano ${exportedItems().length} pozycji`);
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText());
    setWorkspaceStatus("M3U skopiowane do schowka");
  } catch {
    setWorkspaceStatus("Nie udało się skopiować M3U", "error");
  }
}

function workspaceEntries() {
  return sourceItems.map((entry, index) => {
    const item = effectiveItem(entry);
    return { index, item, hidden: library.isHidden(item) };
  });
}

function playSourceIndex(index) {
  const entry = sourceItems[index];
  if (!entry) return { ok: false, error: "Playlist entry does not exist." };
  const item = effectiveItem(entry);
  if (library.isHidden(item)) return { ok: false, error: "Playlist entry is hidden.", item };
  if (item.external) return { ok: false, error: "External entries cannot play inside Streambench.", item };
  playItem(item, index, { preserveAttempt: true });
  return { ok: true, item };
}

globalThis.StreambenchWorkspace = Object.freeze({
  entries: workspaceEntries,
  playIndex: playSourceIndex,
});

ui.entries.addEventListener("click", (event) => {
  const row = event.target.closest(".playlist-entry");
  if (!row) return;
  const item = rowItems.get(row);
  if (!item) return;

  const action = event.target.closest("[data-workspace-action]")?.dataset.workspaceAction;
  if (action) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "favorite") library.toggleFavorite(item);
    if (action === "hide") library.toggleHidden(item);
    if (action === "edit") openEditor(item);
    enhanceRows();
    return;
  }

  if (event.target.closest(".entry-action")) {
    if (item.external) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const sourceIndex = Number(row.querySelector(".entry-action")?.dataset.playlistIndex);
    playItem(item, Number.isInteger(sourceIndex) ? sourceIndex : -1);
  }
}, true);

ui.libraryEntries.addEventListener("click", (event) => {
  const row = event.target.closest(".library-entry");
  if (!row) return;
  const item = library.items(ui.libraryView.value).map(classifyItem)
    .find((entry) => itemKey(entry) === row.dataset.libraryKey);
  if (!item) return;
  const action = event.target.closest("[data-library-action]")?.dataset.libraryAction;
  if (action === "edit") openEditor(item);
  else if (action === "unhide") {
    library.toggleHidden(item);
    enhanceRows();
  } else if (action === "favorite") {
    library.toggleFavorite(item);
    renderLibrary();
  } else if (event.target.closest(".library-play")) {
    playItem(item);
  }
});

ui.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const item = creatingItem || itemFromActiveEdit();
  if (!item) return closeEditor();
  try {
    const url = new URL(ui.editUrl.value.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid protocol");
    const title = ui.editTitle.value.trim();
    if (!title) throw new Error("missing title");
    const changes = {
      title,
      sourceTitle: title,
      url: url.href,
      group: ui.editGroup.value.trim() || "Bez grupy",
      id: ui.editId.value.trim(),
      logo: ui.editLogo.value.trim(),
      country: ui.editCountry.value.trim(),
      language: ui.editLanguage.value.trim(),
      radio: ui.editRadio.checked,
      hls: /\.m3u8(?:$|[?#])/i.test(url.href) || (item.hls && url.href === item.url),
    };

    if (creatingItem) {
      if (sourceItems.some((entry) => effectiveItem(entry).url === url.href)) {
        throw new Error("duplicate url");
      }
      const added = classifyItem({
        ...creatingItem,
        ...changes,
        providerId: "local",
        providerLabel: "Własna",
      });
      const label = sourceLabel || "Własna playlista";
      pendingCaptureOptions = sourceItems.length
        ? { label, ...sourceOptions, defaultRadio: false }
        : { label, providerId: "local", providerLabel: "Własna" };
      ui.text.value = serializeM3u([...sourceItems, added], { dedupe: false });
      ui.parse.click();
      queueMicrotask(() => {
        ui.text.value = "";
      });
      closeEditor();
      setWorkspaceStatus(`Dodano: ${title}`);
      return;
    }

    library.setEdit(item, changes);
    closeEditor();
    enhanceRows();
  } catch (error) {
    const duplicate = error instanceof Error && error.message === "duplicate url";
    ui.editUrl.setCustomValidity(duplicate
      ? "Ten adres już jest na aktualnej playliście."
      : "Podaj poprawny adres HTTP lub HTTPS i nazwę kanału.");
    ui.editUrl.reportValidity();
    ui.editUrl.setCustomValidity("");
  }
});

ui.resetEdit.addEventListener("click", () => {
  const item = itemFromActiveEdit();
  if (item) library.clearEdit(item);
  closeEditor();
  enhanceRows();
});
ui.cancelEdit.addEventListener("click", closeEditor);
ui.addCurrent?.addEventListener("click", openCreator);
ui.exportButton.addEventListener("click", exportFile);
ui.copyButton.addEventListener("click", copyExport);
ui.libraryView.addEventListener("change", renderLibrary);
ui.clearRecent.addEventListener("click", () => {
  library.clearRecent();
  renderLibrary();
});
ui.mode.value = library.value.preferences.mediaMode;
ui.mode.addEventListener("change", () => library.setPreference("mediaMode", ui.mode.value));
ui.provider.addEventListener("change", () => library.setPreference("provider", ui.provider.value));

const providerObserver = new MutationObserver(() => {
  if (restoredProvider || ui.provider.disabled) return;
  const preferred = library.value.preferences.provider;
  if (preferred && [...ui.provider.options].some((option) => option.value === preferred)) {
    ui.provider.value = preferred;
    ui.provider.dispatchEvent(new Event("change"));
  }
  restoredProvider = true;
});
providerObserver.observe(ui.provider, { childList: true, attributes: true });

ui.file.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  const generation = ++sourceGeneration;
  try {
    const source = await file.text();
    if (generation !== sourceGeneration) return;
    captureSource(source, {
      label: file.name,
      defaultRadio: /radio/i.test(file.name),
    });
  } catch {
    setWorkspaceStatus("Nie udało się przygotować playlisty", "error");
  }
}, true);

ui.parse.addEventListener("click", () => {
  ++sourceGeneration;
  const options = pendingCaptureOptions || { label: "Wklejony tekst" };
  pendingCaptureOptions = null;
  captureSource(ui.text.value, options);
}, true);

ui.form.addEventListener("submit", () => {
  if (submittingWorkspaceItem) return;
  const url = ui.url.value.trim();
  if (!url) return;
  let title = "Własny adres";
  try {
    title = new URL(url).hostname;
  } catch {}
  const item = classifyItem({
    url,
    title,
    group: "Własny adres",
    providerId: "direct",
    providerLabel: "Bezpośredni URL",
    radio: ui.mode.value === "audio",
  });
  library.addRecent(item);
  renderLibrary();
}, true);

observer = new MutationObserver(scheduleEnhance);
observer.observe(ui.entries, { childList: true, subtree: true });
renderLibrary();
