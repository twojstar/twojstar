import {
  childAllowed,
  hasErrorName,
  json,
  relayUpstream,
  rewriteManifest,
  safeRemoteUrl,
  sameOriginBrowserRequest,
} from "./relay-core.ts";
import { verifySourceSignature } from "./source-signing.ts";

const RELAY_LABEL = "signed-provider";

export function rewriteSignedHlsManifest(
  source: string,
  currentUrl: URL,
  sourceUrl: URL,
  requestUrl: URL,
  signature: string,
  authorizationParent: URL = currentUrl,
): string {
  return rewriteManifest(source, currentUrl, sourceUrl, requestUrl, { authorizationParent, signature });
}

async function signedRelay(request: Request, requestUrl: URL, secret: string): Promise<Response> {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  const source = safeRemoteUrl(requestUrl.searchParams.get("source")) || target;
  const parent = safeRemoteUrl(requestUrl.searchParams.get("parent"));
  const signature = requestUrl.searchParams.get("sig") || "";
  if (!await verifySourceSignature(source, signature, secret)) {
    return json({ error: "invalid_source_signature" }, 403);
  }
  if (parent && !await childAllowed(source, parent, target)) {
    return json({ error: "manifest_reference_required" }, 403);
  }
  if (!parent && target.href !== source.href) return json({ error: "invalid_source" }, 403);

  return relayUpstream(request, { target, source, requestUrl, signature, label: RELAY_LABEL });
}

export async function handleSignedMediaApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/relay" || !url.searchParams.has("sig")) return null;
  if (!["GET", "HEAD"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  try {
    return await signedRelay(request, url, env.STREAMBENCH_RELAY_SECRET);
  } catch (error) {
    const code = hasErrorName(error, "AbortError") ? "upstream_timeout" : "upstream_unavailable";
    return json({ error: code }, 502);
  }
}
