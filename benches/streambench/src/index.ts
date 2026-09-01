import { FREE_TV_COUNTRIES, filterFreeTvPlaylist } from "./providers/free-tv.ts";
import { createRadioBrowserProvider } from "./providers/radio-browser-worker.ts";
import { bindProviderHandlers, providerById, providerManifest } from "./providers/registry.ts";

const IPTV_ORG_API = "https://iptv-org.github.io/api/";
const IPTV_ORG_PLAYLISTS = "https://iptv-org.github.io/iptv/";
const FREE_TV_PLAYLIST = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8";
const MAX_PLAYLIST_BYTES = 5_000_000;

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: https: http:",
    "connect-src 'self' blob: https: http:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

type PlaylistReadResult = { body: string; error?: never } | { body?: never; error: Response };
type IptvOrgCountry = { code?: unknown; name?: unknown; flag?: unknown };
type IptvOrgCategory = { id?: unknown; name?: unknown };
type LegacyProviderRoute = { providerId: string; resource: "catalog" | "playlist" };

function json(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readPlaylist(response: Response): Promise<PlaylistReadResult> {
  if (!response.ok) return { error: json({ error: "provider_playlist_unavailable" }, 502) };

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PLAYLIST_BYTES) {
    return { error: json({ error: "provider_playlist_too_large" }, 413) };
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PLAYLIST_BYTES) {
    return { error: json({ error: "provider_playlist_too_large" }, 413) };
  }

  const body = new TextDecoder().decode(bytes);
  if (!body.trimStart().startsWith("#EXTM3U")) {
    return { error: json({ error: "invalid_provider_playlist" }, 502) };
  }
  return { body };
}

async function fetchIptvOrg(path: string, accept: string): Promise<Response> {
  const response = await fetch(new URL(path, IPTV_ORG_API), {
    headers: { accept },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`iptv-org returned ${response.status}`);
  return response;
}

async function iptvOrgCatalog(): Promise<Response> {
  const [countriesResponse, categoriesResponse] = await Promise.all([
    fetchIptvOrg("countries.json", "application/json"),
    fetchIptvOrg("categories.json", "application/json"),
  ]);
  const [countriesSource, categoriesSource] = await Promise.all([
    countriesResponse.json(),
    categoriesResponse.json(),
  ]);

  if (!Array.isArray(countriesSource) || !Array.isArray(categoriesSource)) {
    throw new Error("invalid iptv-org catalog");
  }

  const countries = (countriesSource as IptvOrgCountry[])
    .filter((country) => /^[A-Z]{2}$/.test(String(country.code || "")) && typeof country.name === "string")
    .map((country) => ({
      code: String(country.code),
      name: String(country.name),
      flag: typeof country.flag === "string" ? country.flag : "",
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const categories = (categoriesSource as IptvOrgCategory[])
    .filter((category) => (
      /^[a-z0-9-]+$/.test(String(category.id || ""))
      && typeof category.name === "string"
      && category.id !== "xxx"
      && category.id !== "undefined"
    ))
    .map((category) => ({ id: String(category.id), name: String(category.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  return json(
    { provider: "iptv-org", countries, categories },
    200,
    "public, max-age=21600, stale-while-revalidate=86400",
  );
}

function iptvOrgPlaylistPath(url: URL): string | null {
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id") || "";
  if (type === "country" && /^[a-z]{2}$/i.test(id)) return `countries/${id.toLowerCase()}.m3u`;
  if (type === "category" && /^[a-z0-9-]+$/.test(id)) return `categories/${id}.m3u`;
  return null;
}

async function iptvOrgPlaylist(url: URL): Promise<Response> {
  const path = iptvOrgPlaylistPath(url);
  if (!path) return json({ error: "invalid_provider_selection" }, 400);

  const source = await readPlaylist(await fetch(new URL(path, IPTV_ORG_PLAYLISTS), {
    headers: { accept: "audio/x-mpegurl,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }));
  if (source.error) return source.error;

  return new Response(source.body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "cache-control": "public, max-age=1800, stale-while-revalidate=21600",
      "x-streambench-source": "iptv-org",
    },
  });
}

function freeTvCatalog(): Response {
  return json(
    {
      provider: "free-tv",
      countries: FREE_TV_COUNTRIES,
      filters: providerById("free-tv")!.filters,
    },
    200,
    "public, max-age=86400, stale-while-revalidate=604800",
  );
}

async function freeTvPlaylist(url: URL): Promise<Response> {
  const type = url.searchParams.get("type");
  const id = (url.searchParams.get("id") || "").toUpperCase();
  if (type !== "country" || !FREE_TV_COUNTRIES.some((entry) => entry.code === id)) {
    return json({ error: "invalid_provider_selection" }, 400);
  }

  const source = await readPlaylist(await fetch(FREE_TV_PLAYLIST, {
    headers: { accept: "audio/x-mpegurl,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }));
  if (source.error) return source.error;

  const filtered = filterFreeTvPlaylist(source.body, id);
  return new Response(filtered.body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "cache-control": "public, max-age=1800, stale-while-revalidate=21600",
      "x-streambench-source": "free-tv",
      "x-streambench-lite-count": String(filtered.count),
      "x-streambench-source-count": String(filtered.total),
    },
  });
}

const PROVIDER_HANDLERS = bindProviderHandlers({
  "free-tv": { catalog: freeTvCatalog, playlist: freeTvPlaylist },
  "iptv-org": { catalog: iptvOrgCatalog, playlist: iptvOrgPlaylist },
  "radio-browser": createRadioBrowserProvider(json),
});

function providersResponse(): Response {
  return json(
    { providers: providerManifest() },
    200,
    "public, max-age=86400, stale-while-revalidate=604800",
  );
}

async function catalogResponse(providerId: string): Promise<Response> {
  const handler = PROVIDER_HANDLERS.get(providerId);
  return handler ? handler.catalog() : json({ error: "unknown_provider" }, 400);
}

async function playlistResponse(providerId: string, url: URL): Promise<Response> {
  const handler = PROVIDER_HANDLERS.get(providerId);
  return handler ? handler.playlist(url) : json({ error: "unknown_provider" }, 400);
}

function legacyProviderRoute(pathname: string): LegacyProviderRoute | null {
  const match = pathname.match(/^\/api\/providers\/([a-z0-9-]+)\/(catalog|playlist)$/);
  return match
    ? { providerId: match[1], resource: match[2] as LegacyProviderRoute["resource"] }
    : null;
}

async function providerResponse(url: URL): Promise<Response> {
  if (url.pathname === "/api/providers") return providersResponse();

  if (url.pathname === "/api/catalog" || url.pathname === "/api/playlist") {
    const providerId = url.searchParams.get("provider") || "";
    if (!PROVIDER_HANDLERS.has(providerId)) return json({ error: "unknown_provider" }, 400);
    return url.pathname === "/api/catalog"
      ? catalogResponse(providerId)
      : playlistResponse(providerId, url);
  }

  const legacy = legacyProviderRoute(url.pathname);
  if (!legacy || !PROVIDER_HANDLERS.has(legacy.providerId)) return json({ error: "not_found" }, 404);
  return legacy.resource === "catalog"
    ? catalogResponse(legacy.providerId)
    : playlistResponse(legacy.providerId, url);
}

function isProviderRoute(pathname: string): boolean {
  return pathname === "/api/providers"
    || pathname === "/api/catalog"
    || pathname === "/api/playlist"
    || pathname.startsWith("/api/providers/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withSecurityHeaders(json({ status: "ok", service: "streambench" }));
    }

    if (isProviderRoute(url.pathname)) {
      if (request.method !== "GET") {
        return withSecurityHeaders(json({ error: "method_not_allowed" }, 405));
      }
      try {
        return withSecurityHeaders(await providerResponse(url));
      } catch {
        return withSecurityHeaders(json({ error: "provider_unavailable" }, 502));
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(json({ error: "method_not_allowed" }, 405));
    }

    const asset = await env.ASSETS.fetch(request);
    const response = withSecurityHeaders(asset);
    if (url.pathname === "/" && response.headers.get("content-type")?.includes("text/html")) {
      const headers = new Headers(response.headers);
      headers.set(
        "link",
        '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"',
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
