const STORAGE_KEY = "streambench.provider-relays.v1";
const MAX_RELAYS = 500;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ProviderRelayMap = Map<string, string>;

declare global {
  interface Window {
    streambenchProviderRelays: ProviderRelayMap;
  }
}

function safeUrl(value: unknown, base?: string | URL): URL | null {
  try {
    const url = new URL(String(value || "").trim(), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function validRelay(sourceUrl: URL, relayValue: unknown, origin: string): URL | null {
  const relay = safeUrl(relayValue, origin);
  if (!relay || relay.origin !== origin || relay.pathname !== "/api/relay") return null;
  const target = safeUrl(relay.searchParams.get("source") || relay.searchParams.get("url"));
  const signature = relay.searchParams.get("sig") || "";
  if (!target || target.href !== sourceUrl.href || !SIGNATURE_PATTERN.test(signature)) return null;
  return relay;
}

function parseAttributes(line: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

export function parseProviderRelays(
  source: unknown,
  origin = "https://streambench.invalid",
): ProviderRelayMap {
  const relays: ProviderRelayMap = new Map();
  let pendingRelay = "";
  for (const rawLine of String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      pendingRelay = parseAttributes(line)["streambench-relay"] || "";
      continue;
    }
    if (line.startsWith("#")) continue;
    const sourceUrl = safeUrl(line);
    const relay = sourceUrl && pendingRelay ? validRelay(sourceUrl, pendingRelay, origin) : null;
    if (sourceUrl && relay) relays.set(sourceUrl.href, relay.href);
    pendingRelay = "";
  }
  return relays;
}

export function relayForSource(
  rawUrl: unknown,
  relays: unknown = typeof window !== "undefined" ? window.streambenchProviderRelays : undefined,
): URL | null {
  const source = safeUrl(rawUrl);
  if (!source || !(relays instanceof Map)) return null;
  const relay = relays.get(source.href);
  return relay ? safeUrl(relay) : null;
}

if (typeof window !== "undefined") {
  const relays: ProviderRelayMap = new Map();

  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [sourceValue, relayValue] of Object.entries(stored).slice(-MAX_RELAYS)) {
        const sourceUrl = safeUrl(sourceValue);
        const relay = sourceUrl ? validRelay(sourceUrl, relayValue, location.origin) : null;
        if (sourceUrl && relay) relays.set(sourceUrl.href, relay.href);
      }
    }
  } catch {}

  window.streambenchProviderRelays = relays;

  const persist = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(relays)));
    } catch {}
  };

  const remember = (source: unknown): void => {
    for (const [sourceUrl, relayUrl] of parseProviderRelays(source, location.origin)) {
      relays.delete(sourceUrl);
      relays.set(sourceUrl, relayUrl);
    }
    while (relays.size > MAX_RELAYS) {
      const oldest = relays.keys().next().value;
      if (typeof oldest !== "string") break;
      relays.delete(oldest);
    }
    persist();
  };

  const providerPlaylistRequest = (input: RequestInfo | URL): boolean => {
    try {
      const rawUrl = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, location.origin);
      return url.pathname === "/api/playlist"
        || /^\/api\/providers\/[a-z0-9-]+\/playlist$/.test(url.pathname);
    } catch {
      return false;
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const providerPlaylist = providerPlaylistRequest(args[0]);
    const response = await originalFetch(...args);
    if (providerPlaylist && response.ok) {
      try {
        remember(await response.clone().text());
      } catch {}
    }
    return response;
  };
}
