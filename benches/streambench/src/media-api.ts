import {
  FETCH_TIMEOUT_MS,
  childAllowed,
  fetchCapped,
  fetchValidated,
  hasErrorName,
  isPrivateHost,
  json,
  relayUpstream,
  rewriteManifest,
  safeRemoteUrl,
  sameOriginBrowserRequest,
  upstreamHeaders,
} from "./relay-core.ts";

const MAX_ICY_BYTES = 512_000;
const MAX_METADATA_BYTES = 128_000;
const BUNDLED_PLAYLISTS = ["/playlists/iptv.m3u8", "/playlists/internet_radio.m3u8"];
let bundledCache: Promise<Set<string>> | null = null;

type TrackMetadata = {
  provider: string;
  station?: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  refreshAfter: number;
};

type StreamTitle = {
  artist: string;
  title: string;
};

export { isPrivateHost };

export function rewriteHlsManifest(
  source: string,
  currentUrl: URL,
  sourceUrl: URL,
  requestUrl: URL,
  authorizationParent: URL = currentUrl,
): string {
  return rewriteManifest(source, currentUrl, sourceUrl, requestUrl, { authorizationParent });
}

async function bundledPlaylistUrls(path: string, env: Env, requestUrl: URL): Promise<string[]> {
  const response = await env.ASSETS.fetch(new Request(new URL(path, requestUrl), {
    headers: { accept: "audio/x-mpegurl,text/plain" },
  }));
  if (!response.ok) {
    void response.body?.cancel();
    return [];
  }
  const text = await response.text();
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line))
    .map((line) => safeRemoteUrl(line)?.href)
    .filter((url): url is string => Boolean(url));
}

async function bundledUrls(env: Env, requestUrl: URL): Promise<Set<string>> {
  if (!bundledCache) {
    bundledCache = (async () => {
      const lists = await Promise.all(BUNDLED_PLAYLISTS
        .map((path) => bundledPlaylistUrls(path, env, requestUrl)));
      const urls = new Set(lists.flat());
      if (urls.size === 0) throw new Error("bundled playlists unavailable");
      return urls;
    })().catch((error: unknown) => {
      bundledCache = null;
      throw error;
    });
  }
  return bundledCache;
}

async function isBundledUrl(url: URL, env: Env, requestUrl: URL): Promise<boolean> {
  return (await bundledUrls(env, requestUrl)).has(url.href);
}

async function relay(request: Request, env: Env, requestUrl: URL): Promise<Response> {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  const source = safeRemoteUrl(requestUrl.searchParams.get("source")) || target;
  const parent = safeRemoteUrl(requestUrl.searchParams.get("parent"));
  if (!await isBundledUrl(source, env, requestUrl)) return json({ error: "source_not_bundled" }, 403);
  if (parent && !await childAllowed(source, parent, target)) return json({ error: "manifest_reference_required" }, 403);
  if (!parent && target.href !== source.href) return json({ error: "invalid_source" }, 403);

  return relayUpstream(request, { target, source, requestUrl });
}

export function radioParadiseChannel(rawUrl: string | URL): number | null {
  let url: URL;
  try { url = new URL(String(rawUrl)); } catch { return null; }
  if (!/(^|\.)radioparadise\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.toLowerCase();
  if (path.includes("rock")) return 2;
  if (path.includes("global") || path.includes("world")) return 3;
  if (/(?:^|[-_/])(?:mellow|192m)(?:[-_/]|$)/.test(path)) return 1;
  return 0;
}

function safeArtwork(value: unknown): string {
  return safeRemoteUrl(value)?.href || "";
}

async function radioParadiseMetadata(channel: number): Promise<TrackMetadata> {
  const { response, bytes } = await fetchCapped(
    `https://api.radioparadise.com/api/now_playing?chan=${channel}`,
    { headers: { accept: "application/json", "user-agent": "Streambench/1.0" } },
    MAX_METADATA_BYTES,
  );
  if (!response.ok) throw new Error(`Radio Paradise returned ${response.status}`);
  const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return {
    provider: "radio-paradise",
    title: String(body.title || "").trim(),
    artist: String(body.artist || "").trim(),
    album: String(body.album || "").trim(),
    artwork: safeArtwork(body.cover || body.cover_med || body.cover_small),
    refreshAfter: 15,
  };
}

export function parseStreamTitle(value: unknown): StreamTitle {
  const text = String(value || "").replace(/\0+$/g, "").trim();
  const match = text.match(/StreamTitle='([^']*)'/i);
  const combined = (match?.[1] || "").trim();
  const separator = combined.indexOf(" - ");
  return separator > 0
    ? { artist: combined.slice(0, separator).trim(), title: combined.slice(separator + 3).trim() }
    : { artist: "", title: combined };
}

async function icyMetadata(request: Request, target: URL): Promise<TrackMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchValidated(target, {
      headers: upstreamHeaders(request, { icy: true }),
    }, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`radio returned ${response.status}`);
    const interval = Number(response.headers.get("icy-metaint") || 0);
    if (!Number.isInteger(interval) || interval <= 0 || interval >= MAX_ICY_BYTES - 1) {
      void response.body.cancel();
      return {
        provider: "icy",
        station: response.headers.get("icy-name") || "",
        title: "",
        artist: "",
        album: "",
        artwork: "",
        refreshAfter: 30,
      };
    }
    const reader = response.body.getReader();
    let bytes = new Uint8Array(0);
    while (bytes.byteLength <= interval && bytes.byteLength < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.byteLength + value.byteLength);
      next.set(bytes);
      next.set(value, bytes.byteLength);
      bytes = next;
    }
    if (bytes.byteLength <= interval) {
      void reader.cancel();
      throw new Error("ICY metadata missing");
    }
    const metadataLength = bytes[interval] * 16;
    const required = interval + 1 + metadataLength;
    while (bytes.byteLength < required && bytes.byteLength < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.byteLength + value.byteLength);
      next.set(bytes);
      next.set(value, bytes.byteLength);
      bytes = next;
    }
    void reader.cancel();
    const metadata = new TextDecoder("latin1").decode(bytes.slice(interval + 1, Math.min(required, bytes.byteLength)));
    const parsed = parseStreamTitle(metadata);
    return {
      provider: "icy",
      station: response.headers.get("icy-name") || "",
      title: parsed.title,
      artist: parsed.artist,
      album: "",
      artwork: "",
      refreshAfter: 20,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function metadata(request: Request, env: Env, requestUrl: URL): Promise<Response> {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  if (!await isBundledUrl(target, env, requestUrl)) return json({ error: "source_not_bundled" }, 403);
  const channel = radioParadiseChannel(target.href);
  const result = channel === null
    ? await icyMetadata(request, target)
    : await radioParadiseMetadata(channel);
  return json(result);
}

export async function handleMediaApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/relay" && url.pathname !== "/api/radio-metadata") return null;
  if (!["GET", "HEAD"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  try {
    return url.pathname === "/api/relay"
      ? await relay(request, env, url)
      : await metadata(request, env, url);
  } catch (error) {
    const code = hasErrorName(error, "AbortError") ? "upstream_timeout" : "upstream_unavailable";
    return json({ error: code }, 502);
  }
}
