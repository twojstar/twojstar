const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }

    if (asset.ok && headers.get("content-type")?.includes("text/html")) {
      headers.set("cache-control", "no-cache");
      headers.set(
        "link",
        '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"',
      );
    }

    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
