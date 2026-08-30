import { faviconResponse } from "./favicons.ts";
import worker from "./index.ts";
import { handleMediaApi } from "./media-api.ts";
import { handleSignedMediaApi } from "./signed-media-api.ts";
import { annotateProviderPlaylistResponse } from "./source-signing.ts";

const SITE_HOST = "streambench.trfny.com";
const WORKERS_HOST = "streambench.travny.workers.dev";

function isProviderPlaylist(pathname: string): boolean {
  return pathname === "/api/playlist"
    || /^\/api\/providers\/[a-z0-9-]+\/playlist$/.test(pathname);
}

function isPortableApiRequest(request: Request, url: URL): boolean {
  return url.pathname.startsWith("/api/") && request.headers.get("origin") === "null";
}

function portableApiRequest(request: Request, url: URL): Request {
  if (!isPortableApiRequest(request, url)) return request;
  const headers = new Headers(request.headers);
  headers.set("sec-fetch-site", "same-origin");
  return new Request(request, { headers });
}

function portableApiResponse(request: Request, url: URL, response: Response): Response {
  if (!isPortableApiRequest(request, url)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "null");
  headers.set("vary", [headers.get("vary"), "Origin"].filter(Boolean).join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/index.html" || (url.hostname === WORKERS_HOST && url.pathname === "/")) {
      url.hostname = SITE_HOST;
      url.protocol = "https:";
      url.pathname = "/";
      return Response.redirect(url.toString(), 301);
    }
    if (isPortableApiRequest(request, url) && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "null",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "Range",
          "access-control-max-age": "86400",
          vary: "Origin",
        },
      });
    }

    const apiRequest = portableApiRequest(request, url);
    const signedMediaApi = await handleSignedMediaApi(apiRequest, env);
    if (signedMediaApi) return portableApiResponse(request, url, signedMediaApi);

    const mediaApi = await handleMediaApi(apiRequest, env);
    if (mediaApi) return portableApiResponse(request, url, mediaApi);

    const icon = faviconResponse(url.pathname);
    if (icon) {
      return request.method === "HEAD"
        ? new Response(null, { status: icon.status, headers: icon.headers })
        : icon;
    }

    const response = await worker.fetch(apiRequest, env);
    const annotated = isProviderPlaylist(url.pathname)
      ? await annotateProviderPlaylistResponse(response, url, env.STREAMBENCH_RELAY_SECRET)
      : response;
    return portableApiResponse(request, url, annotated);
  },
} satisfies ExportedHandler<Env>;
