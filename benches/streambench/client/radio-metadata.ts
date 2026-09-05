export {};

type RadioMetadata = {
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  artwork?: unknown;
  station?: unknown;
  refreshAfter?: unknown;
};

const form = document.querySelector<HTMLFormElement>("#streamForm");
const input = document.querySelector<HTMLInputElement>("#streamUrl");
const shell = document.querySelector<HTMLElement>(".media-shell");
const stage = document.querySelector<HTMLElement>(".radio-now-playing");
const image = stage?.querySelector<HTMLImageElement>("img");
const fallback = stage?.querySelector<HTMLElement>(".radio-artwork-fallback");
const title = stage?.querySelector<HTMLElement>(".radio-artwork-copy strong");
const meta = stage?.querySelector<HTMLElement>(".radio-artwork-copy span");
let timer: number | null = null;
let generation = 0;
let currentUrl = "";
let stationArtwork = "";
let stationTitle = "";

function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function setArtwork(url: unknown): void {
  const artwork = safeUrl(url);
  if (!image || !fallback) return;
  image.hidden = !artwork;
  fallback.hidden = Boolean(artwork);
  image.removeAttribute("src");
  if (artwork) image.src = artwork;
}

function applyMetadata(data: RadioMetadata): void {
  const trackTitle = String(data.title || "").trim();
  const artist = String(data.artist || "").trim();
  const album = String(data.album || "").trim();
  const station = String(data.station || "").trim();
  const artwork = safeUrl(data.artwork) || stationArtwork;
  if (trackTitle && title) title.textContent = trackTitle;
  if (meta) meta.textContent = [artist, album].filter(Boolean).join(" · ") || station || stationTitle || "Stream audio";
  setArtwork(artwork);

  if ("mediaSession" in navigator && trackTitle) {
    const artworkList = artwork ? [{ src: artwork }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackTitle,
      artist,
      album: album || stationTitle,
      artwork: artworkList,
    });
  }
}

async function poll(expectedGeneration: number): Promise<void> {
  if (expectedGeneration !== generation || !currentUrl || shell?.dataset.mode !== "audio") return;
  const endpoint = new URL("/api/radio-metadata", location.origin);
  endpoint.searchParams.set("url", currentUrl);
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as RadioMetadata;
    if (expectedGeneration !== generation) return;
    applyMetadata(data);
    timer = window.setTimeout(
      () => void poll(expectedGeneration),
      Math.max(10, Number(data.refreshAfter) || 20) * 1000,
    );
  } catch {
    if (expectedGeneration === generation) {
      timer = window.setTimeout(() => void poll(expectedGeneration), 45_000);
    }
  }
}

function start(): void {
  queueMicrotask(() => {
    const url = safeUrl(input?.value);
    clearTimer();
    generation += 1;
    if (
      !url
      || shell?.dataset.mode !== "audio"
      || !(window.streambenchBundledUrls instanceof Set)
      || !window.streambenchBundledUrls.has(url)
    ) {
      currentUrl = "";
      return;
    }
    currentUrl = url;
    stationArtwork = image?.hidden ? "" : safeUrl(image?.src);
    stationTitle = title?.textContent?.trim() || "Radio";
    void poll(generation);
  });
}

form?.addEventListener("submit", start);
window.addEventListener("streambench:channel", start);
image?.addEventListener("error", () => {
  image.hidden = true;
  if (fallback) fallback.hidden = false;
});
