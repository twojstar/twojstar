import { classifyChannel } from "./channel-meta.js";
import { describeHls, describeMedia, describeSource } from "./diagnostics.js";

const ui = {
  form: document.querySelector("#streamForm"),
  url: document.querySelector("#streamUrl"),
  mode: document.querySelector("#mediaMode"),
  shell: document.querySelector(".media-shell"),
  video: document.querySelector("#videoPlayer"),
  audio: document.querySelector("#audioPlayer"),
  title: document.querySelector("#nowPlaying"),
  status: document.querySelector("#status"),
  hint: document.querySelector("#streamHint"),
  diagnosticAddress: document.querySelector("#diagnosticAddress"),
  diagnosticType: document.querySelector("#diagnosticType"),
  diagnosticSecurity: document.querySelector("#diagnosticSecurity"),
  diagnosticHls: document.querySelector("#diagnosticHls"),
  diagnosticMedia: document.querySelector("#diagnosticMedia"),
  diagnosticError: document.querySelector("#diagnosticError"),
  providerName: document.querySelector("#providerName"),
  providerHeading: document.querySelector("#providerHeading"),
  providerLink: document.querySelector("#providerLink"),
  providerScope: document.querySelector("#providerScope"),
  providerValue: document.querySelector("#providerValue"),
  providerLoad: document.querySelector("#loadProvider"),
  providerStatus: document.querySelector("#providerStatus"),
  file: document.querySelector("#playlistFile"),
  text: document.querySelector("#playlistText"),
  parse: document.querySelector("#parsePlaylist"),
  search: document.querySelector("#playlistSearch"),
  entries: document.querySelector("#playlistEntries"),
  empty: document.querySelector("#playlistEmpty"),
  count: document.querySelector("#entryCount"),
};

let playlist = [];
const providers = new Map();
const providerCatalogs = new Map();
let providerRequest = null;
let hls = null;
let activeEntry = null;

function setStatus(label, state = "idle") {
  ui.status.textContent = label;
  ui.status.dataset.state = state;
}

function setProviderStatus(label, state = "idle") {
  ui.providerStatus.textContent = label;
  ui.providerStatus.dataset.state = state;
}

function announceChannel(item = {}) {
  window.dispatchEvent(new CustomEvent("streambench:channel", {
    detail: { id: item.id || "", title: item.title || "" },
  }));
}

function setDiagnosticError(message = "Brak") {
  ui.diagnosticError.textContent = message;
}

function renderSourceDiagnostics(rawUrl, options = {}) {
  const source = describeSource(rawUrl, {
    ...options,
    pageProtocol: location.protocol,
  });
  ui.diagnosticAddress.textContent = source.address;
  ui.diagnosticType.textContent = source.type || "Stream";
  ui.diagnosticSecurity.textContent = source.security;
  ui.diagnosticHls.textContent = source.type.startsWith("HLS") ? "Oczekiwanie na manifest" : "Nie dotyczy";
  ui.diagnosticMedia.textContent = options.external ? "Źródło zewnętrzne" : "Oczekiwanie na odtwarzacz";
  setDiagnosticError();
}

function updateMediaDiagnostics(media) {
  if (media.currentSrc) ui.diagnosticMedia.textContent = describeMedia(media);
}

function currentProvider() {
  return providers.get(ui.providerName.value) || null;
}

function cancelProviderRequest(showStatus = true) {
  if (!providerRequest) return;
  const request = providerRequest;
  providerRequest = null;
  request.abort();
  ui.providerLoad.disabled = !providerCatalogs.has(ui.providerName.value);
  if (showStatus) setProviderStatus("Pobieranie anulowane");
}

function validRemoteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function inferMode(url, requested = "auto", radio = false) {
  if (requested !== "auto") return requested;
  if (radio || /\.(mp3|aac|m4a|ogg|opus|flac)(?:$|[?#])/i.test(url)) return "audio";
  return "video";
}

function stopPlayback() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  for (const media of [ui.video, ui.audio]) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
}

function playbackError(message) {
  setStatus("Błąd", "error");
  ui.hint.textContent = message;
  setDiagnosticError(message);
}

function selectExternalSource(rawUrl, title = "") {
  const parsed = validRemoteUrl(rawUrl.trim());
  if (!parsed) {
    playbackError("Adres musi używać protokołu HTTP albo HTTPS.");
    return null;
  }

  stopPlayback();
  delete ui.shell.dataset.mode;
  ui.url.value = parsed.href;
  ui.title.textContent = title || parsed.hostname;
  setStatus("Link zewnętrzny");
  ui.hint.textContent = "To źródło jest stroną zewnętrzną, więc otwieram je poza odtwarzaczem.";
  renderSourceDiagnostics(parsed.href, { title, external: true });
  return parsed;
}

function playStream(rawUrl, options = {}) {
  const parsed = validRemoteUrl(rawUrl.trim());
  if (!parsed) {
    playbackError("Adres musi używać protokołu HTTP albo HTTPS.");
    return;
  }

  const url = parsed.href;
  const mode = inferMode(url, options.mode || ui.mode.value, options.radio);
  const media = mode === "audio" ? ui.audio : ui.video;
  const isHls = /\.m3u8(?:$|[?#])/i.test(url);
  const nativeHls = isHls && Boolean(media.canPlayType("application/vnd.apple.mpegurl"));

  stopPlayback();
  ui.shell.dataset.mode = mode;
  ui.url.value = url;
  ui.title.textContent = options.title || parsed.hostname;
  ui.hint.textContent = parsed.protocol === "http:" && location.protocol === "https:"
    ? "Przeglądarka może zablokować ten stream jako niezabezpieczoną treść HTTP."
    : "Łączenie bezpośrednio ze źródłem streamu, bez proxy Streambencha.";
  renderSourceDiagnostics(url, options);
  setStatus("Łączenie", "loading");

  if (isHls && window.Hls?.isSupported()) {
    hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hls.attachMedia(media);
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
      ui.diagnosticHls.textContent = describeHls(data.levels || hls.levels || []);
      media.play().catch(() => setStatus("Naciśnij play"));
    });
    hls.on(window.Hls.Events.LEVEL_LOADED, (_event, data) => {
      ui.diagnosticHls.textContent = describeHls(hls.levels || [], {
        live: data.details?.live ?? null,
        duration: data.details?.totalduration ?? null,
      });
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      const message = `HLS: ${data.details || data.type || "nieznany błąd"}`;
      setDiagnosticError(message);
      if (!data.fatal) return;
      playbackError(message);
      hls?.destroy();
      hls = null;
    });
    return;
  }

  if (isHls && !nativeHls) {
    playbackError("Ta przeglądarka nie obsługuje HLS ani Media Source Extensions.");
    return;
  }
  if (nativeHls) {
    ui.diagnosticHls.textContent = "Natywne HLS · szczegóły manifestu niedostępne";
  }

  media.src = url;
  media.play().catch(() => setStatus("Naciśnij play"));
}

for (const media of [ui.video, ui.audio]) {
  media.addEventListener("loadedmetadata", () => updateMediaDiagnostics(media));
  media.addEventListener("durationchange", () => updateMediaDiagnostics(media));
  media.addEventListener("playing", () => {
    setStatus("Odtwarzanie", "playing");
    updateMediaDiagnostics(media);
  });
  media.addEventListener("waiting", () => {
    setStatus("Buforowanie", "loading");
    updateMediaDiagnostics(media);
  });
  media.addEventListener("stalled", () => {
    setStatus("Przestój", "loading");
    updateMediaDiagnostics(media);
  });
  media.addEventListener("ended", () => {
    setStatus("Koniec");
    updateMediaDiagnostics(media);
  });
  media.addEventListener("error", () => {
    if (!media.currentSrc || hls) return;
    playbackError("Odtwarzacz nie może otworzyć tego źródła.");
  });
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  activeEntry?.removeAttribute("aria-current");
  activeEntry = null;
  announceChannel();

  const parsed = validRemoteUrl(ui.url.value.trim());
  if (!parsed) {
    playbackError("Adres musi używać protokołu HTTP albo HTTPS.");
    return;
  }

  if (classifyChannel(parsed.href).external) {
    const selected = selectExternalSource(parsed.href);
    if (selected) window.open(selected.href, "_blank", "noopener,noreferrer");
    return;
  }
  playStream(parsed.href);
});

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

function parseM3u(source, {
  allowArtwork = false,
  providerId = "local",
  providerLabel = "Lokalna",
} = {}) {
  const items = [];
  let pending = null;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const attributes = parseAttributes(line);
      pending = {
        id: attributes["tvg-id"] || "",
        title: extinfTitle(line) || attributes["tvg-name"] || "",
        group: attributes["group-title"] || "",
        logo: allowArtwork ? validRemoteUrl(attributes["tvg-logo"] || "")?.href || "" : "",
        country: attributes["tvg-country"] || "",
        language: attributes["tvg-language"] || "",
        quality: attributes["tvg-quality"] || attributes.quality || attributes.resolution || "",
        radio: attributes.radio === "true" || attributes.type === "radio",
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    const url = validRemoteUrl(line);
    if (!url) {
      pending = null;
      continue;
    }

    const title = pending?.title || url.hostname;
    const radio = pending?.radio || false;
    items.push({
      id: pending?.id || "",
      url: url.href,
      title,
      group: pending?.group || "Bez grupy",
      logo: pending?.logo || "",
      country: pending?.country || "",
      language: pending?.language || "",
      radio,
      providerId,
      providerLabel,
      ...classifyChannel(url.href, {
        title,
        radio,
        quality: pending?.quality || "",
      }),
    });
    pending = null;
  }

  return items;
}

function itemMeta(item) {
  return [item.group, item.country, item.language].filter(Boolean).join(" · ");
}

function itemSearch(item) {
  return [
    item.id,
    item.title,
    itemMeta(item),
    item.providerLabel,
    item.protocol,
    item.playback,
    item.quality,
  ].filter(Boolean).join(" ").toLocaleLowerCase("pl");
}

function channelArtwork(item) {
  const fallback = document.createElement("span");
  fallback.className = "channel-fallback";
  fallback.textContent = item.external ? "↗" : item.radio ? "♫" : "▶";

  if (!item.logo) return fallback;

  const logo = document.createElement("img");
  logo.className = "channel-logo";
  logo.src = item.logo;
  logo.alt = "";
  logo.loading = "lazy";
  logo.referrerPolicy = "no-referrer";
  logo.addEventListener("error", () => logo.replaceWith(fallback), { once: true });
  return logo;
}

function channelBadges(item) {
  const container = document.createElement("span");
  container.className = "channel-badges";

  for (const label of [item.providerLabel, item.protocol, item.playback, item.quality].filter(Boolean)) {
    const badge = document.createElement("span");
    badge.className = "channel-badge";
    badge.textContent = label;
    container.append(badge);
  }
  return container;
}

function activateEntry(action) {
  activeEntry?.removeAttribute("aria-current");
  activeEntry = action;
  action.setAttribute("aria-current", "true");
}

function entryAction(item) {
  const action = document.createElement(item.external ? "a" : "button");
  action.className = "entry-action";
  action.dataset.search = itemSearch(item);

  if (item.external) {
    action.href = item.url;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.addEventListener("click", () => {
      activateEntry(action);
      announceChannel(item);
      selectExternalSource(item.url, item.title);
    });
  } else {
    action.type = "button";
    action.addEventListener("click", () => {
      activateEntry(action);
      announceChannel(item);
      playStream(item.url, {
        title: item.title,
        radio: item.radio,
        quality: item.quality,
      });
    });
  }

  const copy = document.createElement("span");
  copy.className = "channel-copy";
  const name = document.createElement("span");
  name.className = "channel-name";
  name.textContent = item.title;
  const meta = document.createElement("span");
  meta.className = "channel-meta";
  meta.textContent = itemMeta(item);
  copy.append(name, channelBadges(item), meta);
  action.append(channelArtwork(item), copy);
  return action;
}

function entryRow(item) {
  const row = document.createElement("li");
  row.className = "playlist-entry";
  row.append(entryAction(item));
  return row;
}

function renderPlaylist() {
  const query = ui.search.value.trim().toLocaleLowerCase("pl");
  const visible = query
    ? playlist.filter((item) => itemSearch(item).includes(query))
    : playlist;

  ui.entries.replaceChildren(...visible.map(entryRow));
  ui.empty.hidden = playlist.length > 0;
  ui.search.disabled = playlist.length === 0;
  ui.count.textContent = query ? `${visible.length}/${playlist.length}` : String(playlist.length);
}

function loadPlaylist(source, label, {
  allowArtwork = false,
  cancelProvider = true,
  local = true,
  providerId = "local",
  providerLabel = "Lokalna",
} = {}) {
  if (cancelProvider) cancelProviderRequest();
  playlist = parseM3u(source, { allowArtwork, providerId, providerLabel });
  activeEntry?.removeAttribute("aria-current");
  activeEntry = null;
  announceChannel();
  ui.search.value = "";
  renderPlaylist();
  setStatus(playlist.length ? "Playlista gotowa" : "Pusta playlista", playlist.length ? "idle" : "error");
  ui.hint.textContent = playlist.length
    ? local
      ? `${label}: wczytano ${playlist.length} pozycji lokalnie.`
      : `${label}: wczytano ${playlist.length} pozycji z publicznego katalogu.`
    : `${label}: nie znaleziono poprawnych adresów HTTP lub HTTPS.`;
  return playlist.length;
}

function currentScope(provider = currentProvider()) {
  return provider?.scopes.find((scope) => scope.id === ui.providerScope.value) || null;
}

function renderProviderValues() {
  const provider = currentProvider();
  const scope = currentScope(provider);
  const catalog = providerCatalogs.get(provider?.id);
  const entries = scope ? catalog?.[scope.values] : null;

  ui.providerValue.replaceChildren(...(entries || []).map((entry) => {
    const option = document.createElement("option");
    option.value = scope.values === "countries" ? entry.code : entry.id;
    option.textContent = scope.values === "countries" ? `${entry.flag || "🌐"} ${entry.name}` : entry.name;
    return option;
  }));

  if ([...ui.providerValue.options].some((option) => option.value === scope?.default)) {
    ui.providerValue.value = scope.default;
  }
  ui.providerValue.disabled = !entries?.length;
  ui.providerLoad.disabled = !entries?.length;
}

function renderProviderScopes() {
  const provider = currentProvider();
  ui.providerScope.replaceChildren(...(provider?.scopes || []).map((scope) => {
    const option = document.createElement("option");
    option.value = scope.id;
    option.textContent = scope.label;
    return option;
  }));
  ui.providerScope.disabled = !provider || provider.scopes.length <= 1;
  renderProviderValues();
}

async function loadProviderCatalog(providerId) {
  const provider = providers.get(providerId);
  if (!provider) return;

  if (providerCatalogs.has(providerId)) {
    if (ui.providerName.value === providerId) {
      renderProviderScopes();
      setProviderStatus(provider.status || "Katalog gotowy");
    }
    return;
  }

  setProviderStatus("Pobieranie katalogu…", "loading");
  try {
    const response = await fetch(provider.endpoints.catalog, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    providerCatalogs.set(providerId, await response.json());
    if (ui.providerName.value !== providerId) return;
    renderProviderScopes();
    setProviderStatus(provider.status || "Katalog gotowy");
  } catch {
    if (ui.providerName.value !== providerId) return;
    ui.providerValue.disabled = true;
    ui.providerLoad.disabled = true;
    setProviderStatus(`Nie udało się pobrać katalogu ${provider.label}.`, "error");
  }
}

function selectProvider() {
  cancelProviderRequest(false);
  const provider = currentProvider();
  if (!provider) return;

  ui.providerHeading.textContent = provider.label;
  ui.providerLink.href = provider.link;
  ui.providerLink.hidden = false;
  ui.providerScope.disabled = true;
  ui.providerValue.disabled = true;
  ui.providerLoad.disabled = true;
  ui.providerScope.replaceChildren();
  ui.providerValue.replaceChildren();
  loadProviderCatalog(provider.id);
}

async function loadProviders() {
  setProviderStatus("Pobieranie źródeł…", "loading");
  try {
    const response = await fetch("/api/providers", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.providers) || body.providers.length === 0) throw new Error("empty provider manifest");

    providers.clear();
    for (const provider of body.providers) {
      if (!provider?.id || !provider?.label || !provider?.endpoints?.catalog || !provider?.endpoints?.playlist) continue;
      providers.set(provider.id, provider);
    }
    if (providers.size === 0) throw new Error("invalid provider manifest");

    ui.providerName.replaceChildren(...[...providers.values()].map((provider) => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      return option;
    }));
    ui.providerName.value = providers.has("free-tv") ? "free-tv" : providers.keys().next().value;
    ui.providerName.disabled = false;
    selectProvider();
  } catch {
    ui.providerName.disabled = true;
    ui.providerScope.disabled = true;
    ui.providerValue.disabled = true;
    ui.providerLoad.disabled = true;
    setProviderStatus("Nie udało się pobrać listy źródeł.", "error");
  }
}

async function loadProviderPlaylist() {
  const provider = currentProvider();
  const type = ui.providerScope.value;
  const id = ui.providerValue.value;
  const selection = ui.providerValue.selectedOptions[0]?.textContent?.trim() || id;
  if (!provider || !id) return;

  cancelProviderRequest(false);
  const controller = new AbortController();
  providerRequest = controller;

  const url = new URL(provider.endpoints.playlist, location.origin);
  url.searchParams.set("type", type);
  url.searchParams.set("id", id);

  ui.providerLoad.disabled = true;
  setProviderStatus(`Pobieranie: ${selection}…`, "loading");
  try {
    const response = await fetch(url, {
      headers: { accept: "audio/x-mpegurl,text/plain" },
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    if (providerRequest !== controller) return;
    const count = loadPlaylist(source, `${provider.label} · ${selection}`, {
      allowArtwork: true,
      cancelProvider: false,
      local: false,
      providerId: provider.id,
      providerLabel: provider.label,
    });
    const sourceCount = Number(response.headers.get("x-streambench-source-count") || 0);
    const label = count && sourceCount
      ? `Wczytano ${count} z ${sourceCount} pozycji`
      : count
        ? `Wczytano ${count} pozycji`
        : "Playlista jest pusta";
    setProviderStatus(label, count ? "idle" : "error");
  } catch (error) {
    if (providerRequest === controller && error.name !== "AbortError") {
      setProviderStatus(`Nie udało się pobrać playlisty ${provider.label}.`, "error");
    }
  } finally {
    if (providerRequest === controller) {
      providerRequest = null;
      ui.providerLoad.disabled = false;
    }
  }
}

ui.providerName.addEventListener("change", selectProvider);
ui.providerScope.addEventListener("change", renderProviderValues);
ui.providerLoad.addEventListener("click", loadProviderPlaylist);
ui.file.addEventListener("change", async () => {
  const [file] = ui.file.files;
  if (!file) return;
  cancelProviderRequest();
  try {
    loadPlaylist(await file.text(), file.name);
  } catch {
    playbackError("Nie udało się odczytać pliku playlisty.");
  } finally {
    ui.file.value = "";
  }
});
ui.parse.addEventListener("click", () => loadPlaylist(ui.text.value, "Wklejony tekst"));
ui.search.addEventListener("input", renderPlaylist);

loadProviders();
