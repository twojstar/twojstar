export const MAX_MANIFEST_BYTES = 2_000_000;
export const FETCH_TIMEOUT_MS = 12_000;

const MANIFEST_CACHE_MS = 45_000;
const MANIFEST_CACHE_LIMIT = 100;

type ManifestCacheEntry = {
  expires: number;
  text: string;
  finalUrl: URL;
};

type FetchValidatedOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

type RewriteManifestOptions = {
  authorizationParent?: URL;
  signature?: string;
};

type RelayResponseOptions = {
  manifest?: boolean;
  label?: string;
};

type RelayUpstreamOptions = {
  target: URL;
  source: URL;
  requestUrl: URL;
  signature?: string;
  label?: string;
};

const manifestCache = new Map<string, ManifestCacheEntry>();

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders({ "content-type": "application/json; charset=utf-8" }),
  });
}

export function hasErrorName(error: unknown, name: string): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === name;
}

export function isPrivateHost(hostname: unknown): boolean {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const ipv4Private = (value: string): boolean | null => {
    const parts = value.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
    const octets = parts.map(Number);
    if (octets.some((part) => part < 0 || part > 255)) return true;
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || octets[0] >= 224;
  };

  const directIpv4 = ipv4Private(host);
  if (directIpv4 !== null) return directIpv4;
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("ff")) return true;

  const mapped = host.match(/^::ffff:(.+)$/)?.[1];
  if (!mapped) return false;
  const dotted = ipv4Private(mapped);
  if (dotted !== null) return dotted;
  const words = mapped.split(":");
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return true;
  const high = Number.parseInt(words[0], 16);
  const low = Number.parseInt(words[1], 16);
  return ipv4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`) ?? true;
}

export function safeRemoteUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (isPrivateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function sameOriginBrowserRequest(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export function upstreamHeaders(request: Request, { icy = false }: { icy?: boolean } = {}): Headers {
  const headers = new Headers({
    accept: request.headers.get("accept") || "*/*",
    "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
  });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (icy) headers.set("Icy-MetaData", "1");
  return headers;
}

export async function fetchValidated(
  rawUrl: string | URL,
  init: RequestInit = {},
  { timeoutMs = FETCH_TIMEOUT_MS, signal }: FetchValidatedOptions = {},
): Promise<Response> {
  let current = safeRemoteUrl(rawUrl);
  if (!current) throw new Error("invalid redirect target");
  const controller = signal ? null : new AbortController();
  const activeSignal = signal || controller!.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetch(current, {
        ...init,
        signal: activeSignal,
        redirect: "manual",
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      void response.body?.cancel();
      if (!location || redirectCount === 5) throw new Error("invalid redirect chain");
      current = safeRemoteUrl(new URL(location, current));
      if (!current) throw new Error("invalid redirect target");
    }
    throw new Error("too many redirects");
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("response too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchCapped(
  url: string | URL,
  init: RequestInit,
  limit: number,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchValidated(url, init, { signal: controller.signal });
    const bytes = await readCapped(response, limit);
    return { response, bytes };
  } finally {
    clearTimeout(timer);
  }
}

function referencedUrls(source: string, baseUrl: URL): Set<string> {
  const urls = new Set<string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("#")) {
      try { urls.add(new URL(line, baseUrl).href); } catch {}
    }
    for (const match of line.matchAll(/URI=(?:"([^"]+)"|([^,\s]+))/gi)) {
      try { urls.add(new URL(match[1] || match[2], baseUrl).href); } catch {}
    }
  }
  return urls;
}

async function manifestSource(url: URL, { refresh = false }: { refresh?: boolean } = {}): Promise<ManifestCacheEntry> {
  const cached = manifestCache.get(url.href);
  if (!refresh && cached && cached.expires > Date.now()) return cached;
  const { response, bytes } = await fetchCapped(url, {
    headers: {
      accept: "application/vnd.apple.mpegurl,application/x-mpegURL,audio/mpegurl,text/plain",
      "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
    },
  }, MAX_MANIFEST_BYTES);
  if (!response.ok) throw new Error(`manifest returned ${response.status}`);
  const text = new TextDecoder().decode(bytes);
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("not an HLS manifest");
  const result: ManifestCacheEntry = {
    expires: Date.now() + MANIFEST_CACHE_MS,
    text,
    finalUrl: new URL(response.url || url.href),
  };
  manifestCache.set(url.href, result);
  if (manifestCache.size > MANIFEST_CACHE_LIMIT) {
    manifestCache.delete(manifestCache.keys().next().value as string);
  }
  return result;
}

async function manifestReferences(parent: URL, target: URL): Promise<boolean> {
  let manifest = await manifestSource(parent);
  if (referencedUrls(manifest.text, manifest.finalUrl).has(target.href)) return true;
  manifest = await manifestSource(parent, { refresh: true });
  return referencedUrls(manifest.text, manifest.finalUrl).has(target.href);
}

export async function childAllowed(source: URL, parent: URL, target: URL): Promise<boolean> {
  if (parent.href !== source.href && !await manifestReferences(source, parent)) return false;
  return manifestReferences(parent, target);
}

function relayHref(target: URL, source: URL, parent: URL, requestUrl: URL, signature: string): string {
  const relay = new URL("/api/relay", requestUrl);
  relay.searchParams.set("url", target.href);
  relay.searchParams.set("source", source.href);
  relay.searchParams.set("parent", parent.href);
  if (signature) relay.searchParams.set("sig", signature);
  return relay.href;
}

export function rewriteManifest(
  source: string,
  currentUrl: URL,
  sourceUrl: URL,
  requestUrl: URL,
  { authorizationParent = currentUrl, signature = "" }: RewriteManifestOptions = {},
): string {
  const rewrite = (value: string): string => {
    try {
      return relayHref(new URL(value, currentUrl), sourceUrl, authorizationParent, requestUrl, signature);
    } catch {
      return value;
    }
  };
  return source.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return rawLine;
    if (!line.startsWith("#")) return rewrite(line);
    return rawLine.replace(
      /URI=(?:"([^"]+)"|([^,\s]+))/gi,
      (_match, quoted: string | undefined, plain: string | undefined) => `URI="${rewrite(quoted || plain || "")}"`,
    );
  }).join("\n");
}

function relayResponseHeaders(
  upstream: Response,
  { manifest = false, label = "1" }: RelayResponseOptions = {},
): Headers {
  const headers = new Headers(apiHeaders({ "x-streambench-relay": label }));
  for (const name of ["accept-ranges", "content-range", "icy-br", "icy-description", "icy-genre", "icy-name", "icy-url"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (manifest) {
    headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
  } else {
    headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
  }
  return headers;
}

export async function relayUpstream(
  request: Request,
  { target, source, requestUrl, signature = "", label = "1" }: RelayUpstreamOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetchValidated(target, {
      method: request.method,
      headers: upstreamHeaders(request),
    }, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  if (!upstream.ok && upstream.status !== 206) {
    clearTimeout(timer);
    void upstream.body?.cancel();
    return json({ error: "upstream_unavailable", status: upstream.status }, 502);
  }
  if (request.method === "HEAD") {
    clearTimeout(timer);
    void upstream.body?.cancel();
    return new Response(null, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream, { label }),
    });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const looksLikeManifest = /(?:mpegurl|m3u8)/i.test(contentType) || /\.m3u8?(?:$|[?#])/i.test(target.href);
  if (!looksLikeManifest) {
    clearTimeout(timer);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream, { label }),
    });
  }

  let text: string;
  try {
    text = new TextDecoder().decode(await readCapped(upstream, MAX_MANIFEST_BYTES));
  } finally {
    clearTimeout(timer);
  }
  if (!text.trimStart().startsWith("#EXTM3U")) {
    return new Response(text, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream, { label }),
    });
  }

  const current = new URL(upstream.url || target.href);
  return new Response(
    rewriteManifest(text, current, source, requestUrl, { authorizationParent: target, signature }),
    {
      status: upstream.status,
      headers: relayResponseHeaders(upstream, { manifest: true, label }),
    },
  );
}
