const RADIO_BROWSER_LIMIT = 200;

type RadioBrowserRow = Record<string, unknown>;

type RadioBrowserStation = {
  id: string;
  name: string;
  url: string;
  logo: string;
  country: string;
  language: string;
  tags: string;
  codec: string;
  bitrate: number;
  hls: boolean;
};

function safeText(value: unknown, maxLength = 160): string {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function m3uAttribute(value: unknown): string {
  return safeText(value).replace(/["\\]/g, "");
}

function flagFromCode(code: string): string {
  return [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function hlsPlaybackUrl(rawUrl: string, hls: boolean): string {
  if (!hls || /\.m3u8(?:$|[?#])/i.test(rawUrl)) return rawUrl;
  const url = new URL(rawUrl);
  const marker = "streambench-hls=.m3u8";
  url.hash = url.hash ? `${url.hash.slice(1)}&${marker}` : marker;
  return url.href;
}

function technicalLabel(station: RadioBrowserStation): string {
  return [station.codec, station.bitrate ? `${station.bitrate} kb/s` : ""].filter(Boolean).join(" · ");
}

export function normalizeRadioBrowserCatalog(
  countryRows: RadioBrowserRow[],
  tagRows: RadioBrowserRow[],
  locale = "pl",
) {
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const countries = countryRows
    .filter((row) => /^[A-Z]{2}$/.test(String(row?.name)) && Number(row.stationcount) > 0)
    .map((row) => {
      const code = String(row.name);
      return {
        code,
        name: displayNames.of(code) || code,
        flag: flagFromCode(code),
        stationcount: Number(row.stationcount),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, locale));

  const tags = tagRows
    .map((row) => ({
      id: safeText(row?.name, 80),
      stationcount: Number(row?.stationcount),
    }))
    .filter((tag) => tag.id && tag.stationcount > 0)
    .map((tag) => ({
      ...tag,
      name: `${tag.id} (${tag.stationcount})`,
    }))
    .slice(0, 120);

  return { countries, tags };
}

export function radioBrowserSearchPath(type: string, id: string): string | null {
  const params = new URLSearchParams({
    hidebroken: "true",
    is_https: "true",
    order: "votes",
    reverse: "true",
    limit: String(RADIO_BROWSER_LIMIT),
  });

  if (type === "country" && /^[A-Z]{2}$/.test(id)) {
    params.set("countrycode", id);
  } else if (type === "tag" && id.length > 0 && id.length <= 80) {
    params.set("tag", id);
    params.set("tagExact", "true");
  } else {
    return null;
  }
  return `/json/stations/search?${params}`;
}

export function radioBrowserStationsToM3u(rows: RadioBrowserRow[]): { body: string; count: number } {
  const stations: RadioBrowserStation[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (Number(row?.lastcheckok) !== 1) continue;
    const url = safeUrl(row.url_resolved || row.url);
    const name = safeText(row.name, 180);
    if (!url || !name) continue;

    const key = safeText(row.stationuuid, 80) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    const countryCode = String(row.countrycode || "");

    stations.push({
      id: key,
      name,
      url,
      logo: safeUrl(row.favicon),
      country: /^[A-Z]{2}$/.test(countryCode) ? countryCode : "",
      language: safeText(row.language, 100),
      tags: safeText(row.tags, 120),
      codec: safeText(row.codec, 30),
      bitrate: Number.isFinite(Number(row.bitrate)) ? Math.max(0, Number(row.bitrate)) : 0,
      hls: Number(row.hls) === 1,
    });
    if (stations.length >= RADIO_BROWSER_LIMIT) break;
  }

  const lines = ["#EXTM3U"];
  for (const station of stations) {
    const quality = technicalLabel(station);
    const attributes = [
      `tvg-id="${m3uAttribute(station.id)}"`,
      `tvg-name="${m3uAttribute(station.name)}"`,
      station.logo ? `tvg-logo="${m3uAttribute(station.logo)}"` : "",
      station.country ? `tvg-country="${station.country}"` : "",
      station.language ? `tvg-language="${m3uAttribute(station.language)}"` : "",
      station.tags ? `tvg-tags="${m3uAttribute(station.tags)}"` : "",
      `group-title="${m3uAttribute(station.tags ? `Radio · ${station.tags}` : "Radio")}"`,
      station.codec ? `tvg-codec="${m3uAttribute(station.codec)}"` : "",
      station.bitrate ? `tvg-bitrate="${station.bitrate}"` : "",
      quality ? `tvg-quality="${m3uAttribute(quality)}"` : "",
      station.hls ? `hls="true"` : "",
      `radio="true"`,
    ].filter(Boolean).join(" ");
    lines.push(`#EXTINF:-1 ${attributes},${station.name}`, hlsPlaybackUrl(station.url, station.hls));
  }

  return { body: `${lines.join("\n")}\n`, count: stations.length };
}
