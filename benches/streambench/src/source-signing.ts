const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MIN_SECRET_LENGTH = 32;
const encoder = new TextEncoder();
let cachedSecret = "";
let cachedKey: CryptoKey | null = null;

type UrlValue = string | URL;

type PlaylistAnnotation = {
  body: string;
  count: number;
  enabled: boolean;
};

function normalizedSecret(value: string): string {
  const secret = String(value || "").trim();
  return secret.length >= MIN_SECRET_LENGTH ? secret : "";
}

function remoteUrl(value: UrlValue): URL | null {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

async function signingKey(secretValue: string): Promise<CryptoKey | null> {
  const secret = normalizedSecret(secretValue);
  if (!secret) return null;
  if (cachedKey && cachedSecret === secret) return cachedKey;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedSecret = secret;
  cachedKey = key;
  return key;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signatureBytes(value: string): Uint8Array | null {
  if (!SIGNATURE_PATTERN.test(String(value || ""))) return null;
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/") + "=";
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function createSourceSignature(sourceValue: UrlValue, secretValue: string): Promise<string> {
  const source = remoteUrl(sourceValue);
  const key = await signingKey(secretValue);
  if (!source || !key) return "";
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(source.href));
  return base64Url(new Uint8Array(signature));
}

export async function verifySourceSignature(
  sourceValue: UrlValue,
  signatureValue: string,
  secretValue: string,
): Promise<boolean> {
  const source = remoteUrl(sourceValue);
  const signature = signatureBytes(signatureValue);
  const key = await signingKey(secretValue);
  if (!source || !signature || !key) return false;
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(source.href));
}

function mediaFragment(url: URL): string {
  const extension = url.pathname.match(/\.(m3u8?|mp4|webm|mp3|aac|m4a|ogg|opus|flac)$/i)?.[0];
  return extension ? `streambench${extension.toLowerCase()}` : "streambench.media";
}

export async function signedRelayUrl(
  sourceValue: UrlValue,
  requestValue: UrlValue,
  secretValue: string,
): Promise<URL | null> {
  const source = remoteUrl(sourceValue);
  if (!source || source.protocol !== "http:") return null;
  const signature = await createSourceSignature(source, secretValue);
  if (!signature) return null;
  const relay = new URL("/api/relay", requestValue);
  relay.searchParams.set("url", source.href);
  relay.searchParams.set("sig", signature);
  relay.hash = mediaFragment(source);
  return relay;
}

function extinfDelimiter(line: string): number {
  let quoted = false;
  for (let index = "#EXTINF:".length; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== "\\") quoted = !quoted;
    if (character === "," && !quoted) return index;
  }
  return -1;
}

function withRelayAttribute(line: string, relayUrl: URL): string {
  const clean = line.replace(/\s+streambench-relay="[^"]*"/gi, "");
  const delimiter = extinfDelimiter(clean);
  if (delimiter < 0) return clean;
  return `${clean.slice(0, delimiter)} streambench-relay="${relayUrl.href}"${clean.slice(delimiter)}`;
}

export async function annotateProviderPlaylist(
  sourceValue: string,
  requestValue: UrlValue,
  secretValue: string,
): Promise<PlaylistAnnotation> {
  const source = String(sourceValue || "");
  if (!normalizedSecret(secretValue)) return { body: source, count: 0, enabled: false };
  const lines = source.split(/\r?\n/);
  let pendingIndex = -1;
  let count = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      pendingIndex = index;
      continue;
    }
    if (line.startsWith("#")) continue;

    const sourceUrl = remoteUrl(line);
    if (pendingIndex >= 0 && sourceUrl?.protocol === "http:") {
      const relay = await signedRelayUrl(sourceUrl, requestValue, secretValue);
      if (relay) {
        lines[pendingIndex] = withRelayAttribute(lines[pendingIndex], relay);
        count += 1;
      }
    }
    pendingIndex = -1;
  }

  return { body: lines.join("\n"), count, enabled: true };
}

export async function annotateProviderPlaylistResponse(
  response: Response,
  requestValue: UrlValue,
  secretValue: string,
): Promise<Response> {
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !/(?:mpegurl|m3u8)/i.test(type)) return response;

  if (!normalizedSecret(secretValue)) {
    const headers = new Headers(response.headers);
    headers.set("x-streambench-relay-signing", "disabled");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const result = await annotateProviderPlaylist(await response.text(), requestValue, secretValue);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-streambench-relay-signing", "enabled");
  headers.set("x-streambench-relay-count", String(result.count));
  return new Response(result.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
