import {
  normalizeRadioBrowserCatalog,
  radioBrowserSearchPath,
  radioBrowserStationsToM3u,
} from "./radio-browser.ts";

const API_ROOT = "https://de1.api.radio-browser.info/";
const USER_AGENT = "Streambench/0.7";
const MAX_JSON_BYTES = 5_000_000;

type JsonResponder = (body: unknown, status?: number, cacheControl?: string) => Response;
type JsonRow = Record<string, unknown>;

async function fetchRows(path: string): Promise<JsonRow[]> {
  const response = await fetch(new URL(path, API_ROOT), {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Radio Browser returned ${response.status}`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BYTES) throw new Error("Radio Browser response too large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error("Radio Browser response too large");

  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(body)) throw new Error("invalid Radio Browser response");
  return body as JsonRow[];
}

export function createRadioBrowserProvider(json: JsonResponder) {
  async function catalog(): Promise<Response> {
    const [countryRows, tagRows] = await Promise.all([
      fetchRows("/json/countrycodes?hidebroken=true&order=stationcount&reverse=true&limit=250"),
      fetchRows("/json/tags?hidebroken=true&order=stationcount&reverse=true&limit=120"),
    ]);
    return json(
      { provider: "radio-browser", ...normalizeRadioBrowserCatalog(countryRows, tagRows) },
      200,
      "public, max-age=21600, stale-while-revalidate=86400",
    );
  }

  async function playlist(url: URL): Promise<Response> {
    const type = url.searchParams.get("type") || "";
    const rawId = url.searchParams.get("id") || "";
    const id = type === "country" ? rawId.toUpperCase() : rawId;
    const path = radioBrowserSearchPath(type, id);
    if (!path) return json({ error: "invalid_provider_selection" }, 400);

    const rows = await fetchRows(path);
    const result = radioBrowserStationsToM3u(rows);
    return new Response(result.body, {
      headers: {
        "content-type": "audio/x-mpegurl; charset=utf-8",
        "cache-control": "public, max-age=900, stale-while-revalidate=3600",
        "x-streambench-source": "radio-browser",
        "x-streambench-source-count": String(rows.length),
        "x-streambench-lite-count": String(result.count),
      },
    });
  }

  return { catalog, playlist };
}
