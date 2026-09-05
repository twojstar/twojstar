import { classifyChannel } from "./channel-meta.js";
import { describeHls, describeMedia, describeSource } from "./diagnostics.js";
import { shouldWaitForHlsRecovery } from "./playback-recovery-policy.js";
import {
  beginPlaybackAttemptForTarget,
  completePlaybackAttemptIfTerminal,
  createPlaybackAttemptCoordinator,
} from "./playback-attempt.js";
import {
  playbackSubmissionContext,
  setActivePlaylistIndex as persistActivePlaylistIndex,
} from "./playback-submission.js";
import "./stream-bridge.js";

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
let activeItemIndex = -1;
const playbackAttempts = createPlaybackAttemptCoordinator();
let webmcpActivationAttempt = null;

function effectivePlaylistEntries() {
  const entries = globalThis.StreambenchWorkspace?.entries?.();
  if (Array.isArray(entries) && entries.length) return entries;
  return playlist.map((item, index) => ({ index, item, hidden: false }));
}

function effectivePlaylistEntry(index) {
  const entry = effectivePlaylistEntries().find((candidate) => candidate.index === index);
  if (entry) return entry;
  const item = playlist[index];
  return item ? { index, item, hidden: false } : null;
}

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

  if (!webmcpActivationAttempt) playbackAttempts.cancel("superseded");
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

  const preservedAttempt = options.preserveAttempt ? playbackAttempts.current() : null;
  const ownedAttempt = webmcpActivationAttempt || preservedAttempt;
  const attemptSignal = ownedAttempt?.signal || null;
  if (!ownedAttempt) playbackAttempts.cancel("superseded");
  const attemptActive = () => !attemptSignal?.aborted;
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
    const instance = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hls = instance;
    instance.attachMedia(media);
    instance.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      if (attemptActive()) instance.loadSource(url);
    });
    instance.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (!attemptActive()) return;
      ui.diagnosticHls.textContent = describeHls(data.levels || instance.levels || []);
      media.play().catch(() => {
        if (attemptActive()) setStatus("Naciśnij play");
      });
    });
    instance.on(window.Hls.Events.LEVEL_LOADED, (_event, data) => {
      if (!attemptActive()) return;
      ui.diagnosticHls.textContent = describeHls(instance.levels || [], {
        live: data.details?.live ?? null,
        duration: data.details?.totalduration ?? null,
      });
    });
    instance.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!attemptActive()) return;
      const message = `HLS: ${data.details || data.type || "nieznany błąd"}`;
      setDiagnosticError(message);
      if (!data.fatal) return;
      playbackError(message);
      instance.destroy();
      if (hls === instance) hls = null;
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
  media.play().catch(() => {
    if (attemptActive()) setStatus("Naciśnij play");
  });
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
  const context = playbackSubmissionContext(ui.form);
  const selected = ui.entries.querySelector('.entry-action[aria-current="true"]');
  const selectedIndex = Number(selected?.dataset.playlistIndex);
  const nextIndex = context.playlistIndex >= 0
    ? context.playlistIndex
    : context.preserveSelection && selected && Number.isInteger(selectedIndex) ? selectedIndex : -1;
  const nextEntry = nextIndex >= 0
    ? ui.entries.querySelector(`[data-playlist-index="${nextIndex}"]`)
    : null;
  if (selected && selected !== nextEntry) selected.removeAttribute("aria-current");
  nextEntry?.setAttribute("aria-current", "true");
  activeEntry = nextEntry;
  activeItemIndex = nextIndex;
  persistActivePlaylistIndex(ui.form, activeItemIndex);
  announceChannel(effectivePlaylistEntry(activeItemIndex)?.item || {});

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
  playStream(parsed.href, { preserveAttempt: context.preserveAttempt });
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

function entryAction(item, index) {
  const action = document.createElement(item.external ? "a" : "button");
  action.className = "entry-action";
  action.dataset.search = itemSearch(item);
  action.dataset.playlistIndex = String(index);

  if (item.external) {
    action.href = item.url;
    action.target = "_blank";
    action.rel = "noopener noreferrer";
    action.addEventListener("click", () => {
      activateEntry(action);
      activeItemIndex = index;
      announceChannel(item);
      selectExternalSource(item.url, item.title);
    });
  } else {
    action.type = "button";
    action.addEventListener("click", () => {
      activateEntry(action);
      activeItemIndex = index;
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

function entryRow(item, index) {
  const row = document.createElement("li");
  row.className = "playlist-entry";
  row.append(entryAction(item, index));
  return row;
}

function renderPlaylist() {
  const query = ui.search.value.trim().toLocaleLowerCase("pl");
  const indexed = playlist.map((item, index) => ({ item, index }));
  const visible = query
    ? indexed.filter(({ item }) => itemSearch(item).includes(query))
    : indexed;

  ui.entries.replaceChildren(...visible.map(({ item, index }) => entryRow(item, index)));
  activeEntry = activeItemIndex >= 0
    ? ui.entries.querySelector(`[data-playlist-index="${activeItemIndex}"]`)
    : null;
  activeEntry?.setAttribute("aria-current", "true");
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
  activeItemIndex = -1;
  persistActivePlaylistIndex(ui.form, -1);
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

function publicPlaylistItem(item, index) {
  const host = validRemoteUrl(item.url)?.hostname || "";
  return {
    index,
    id: item.id || "",
    title: item.title || "",
    group: item.group || "",
    country: item.country || "",
    language: item.language || "",
    provider: item.providerLabel || "",
    protocol: item.protocol || "",
    playback: item.playback || "",
    quality: item.quality || "",
    radio: Boolean(item.radio),
    external: Boolean(item.external),
    host,
  };
}

function streamState() {
  const active = activeItemIndex >= 0 ? effectivePlaylistEntry(activeItemIndex)?.item || null : null;
  return {
    status: ui.status.textContent || "",
    statusState: ui.status.dataset.state || "idle",
    nowPlaying: ui.title.textContent || "",
    mode: ui.shell.dataset.mode || ui.mode.value || "auto",
    playlist: {
      count: playlist.length,
      query: ui.search.value || "",
      active: active ? publicPlaylistItem(active, activeItemIndex) : null,
    },
    provider: {
      id: ui.providerName.value || "",
      scope: ui.providerScope.value || "",
      value: ui.providerValue.value || "",
      status: ui.providerStatus.textContent || "",
    },
    diagnostics: {
      address: ui.diagnosticAddress.textContent || "",
      type: ui.diagnosticType.textContent || "",
      security: ui.diagnosticSecurity.textContent || "",
      hls: ui.diagnosticHls.textContent || "",
      media: ui.diagnosticMedia.textContent || "",
      error: ui.diagnosticError.textContent || "",
    },
    epg: {
      status: document.querySelector("#epgStatus")?.textContent || "",
      now: document.querySelector("#epgNow")?.textContent || "",
      next: document.querySelector("#epgNext")?.textContent || "",
    },
  };
}

function searchPlaylistEntries(query = "", limit = 20) {
  const needle = String(query).trim().toLocaleLowerCase("pl");
  const matches = effectivePlaylistEntries()
    .filter(({ hidden }) => !hidden)
    .filter(({ item }) => !needle || itemSearch(item).includes(needle));
  return {
    total: matches.length,
    items: matches.slice(0, limit).map(({ item, index }) => publicPlaylistItem(item, index)),
    truncated: matches.length > limit,
  };
}

function playbackOutcome(entry) {
  const state = streamState();
  if (state.statusState === "playing") return { ok: true, started: true, pending: false, entry, state };
  if (state.statusState === "error") {
    if (shouldWaitForHlsRecovery(
      state.diagnostics.error,
      state.statusState,
      ui.status.dataset.streambenchRecovery,
    )) return null;
    return { ok: false, started: false, error: state.diagnostics.error || state.status || "Playback failed.", entry, state };
  }
  if (state.status === "Naciśnij play") {
    return {
      ok: false,
      started: false,
      requiresInteraction: true,
      error: "Browser requires user interaction before playback can start.",
      entry,
      state,
    };
  }
  return null;
}

async function waitForPlaybackOutcome(entry, signal, timeoutMs: number | null = 1500) {
  const cancelled = () => ({
    ok: false,
    started: false,
    cancelled: true,
    reason: signal.reason || "cancelled",
    entry,
    state: streamState(),
  });
  if (signal.aborted) return cancelled();
  const immediate = playbackOutcome(entry);
  if (immediate) return immediate;
  return new Promise((resolve) => {
    let timer = null;
    const observer = new MutationObserver(() => {
      if (signal.aborted) return finish(cancelled());
      const outcome = playbackOutcome(entry);
      if (outcome) finish(outcome);
    });
    const onAbort = () => finish(cancelled());
    const finish = (result) => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    observer.observe(ui.status, { attributes: true, childList: true, subtree: true });
    if (timeoutMs !== null) {
      timer = setTimeout(() => finish(signal.aborted
        ? cancelled()
        : { ok: true, started: false, pending: true, entry, state: streamState() }), timeoutMs);
    }
  });
}

async function settlePendingPlaybackAttempt(attempt, entry) {
  const terminal = await waitForPlaybackOutcome(entry, attempt.signal, null);
  if (!terminal.cancelled) playbackAttempts.complete(attempt);
}

async function startPlaylistPlayback(index) {
  const effective = effectivePlaylistEntry(index);
  const entry = effective ? publicPlaylistItem(effective.item, index) : null;
  if (!effective) return { ok: false, error: "Playlist entry does not exist." };
  if (effective.hidden) return { ok: false, error: "Playlist entry is hidden.", entry };
  if (effective.item.external) {
    return { ok: false, error: "This entry is an external page and cannot play inside Streambench.", entry };
  }
  const item = effective.item;

  const workspace = globalThis.StreambenchWorkspace;
  const action = workspace?.playIndex
    ? null
    : ui.entries.querySelector(`[data-playlist-index="${index}"]`);
  if (!workspace?.playIndex && !action) {
    return { ok: false, error: "Playlist entry is not available in the current UI.", entry };
  }
  const prepared = beginPlaybackAttemptForTarget(playbackAttempts, effective);
  if (!prepared.ok) return { ok: false, error: prepared.error, entry };
  const attempt = prepared.attempt;
  webmcpActivationAttempt = attempt;
  try {
    if (workspace?.playIndex) {
      const result = workspace.playIndex(index);
      if (!result?.ok) {
        playbackAttempts.complete(attempt);
        return { ok: false, error: result?.error || "Streambench could not activate the entry.", entry };
      }
    } else {
      action.click();
    }
  } finally {
    webmcpActivationAttempt = null;
  }

  await Promise.resolve();
  const effectiveEntry = publicPlaylistItem(effectivePlaylistEntry(index)?.item || item, index);
  const outcome = await waitForPlaybackOutcome(effectiveEntry, attempt.signal);
  if (outcome.pending) void settlePendingPlaybackAttempt(attempt, effectiveEntry);
  completePlaybackAttemptIfTerminal(playbackAttempts, attempt, outcome);
  return outcome;
}

function stopStreamPlayback() {
  window.dispatchEvent(new Event("streambench:playback-stop"));
  playbackAttempts.cancel("stopped");
  stopPlayback();
  setStatus("Zatrzymano");
  return { ok: true, state: streamState() };
}

globalThis.StreambenchUi = Object.freeze({
  readState: streamState,
  searchEntries: searchPlaylistEntries,
  startPlayback: startPlaylistPlayback,
  stopPlayback: stopStreamPlayback,
});

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
