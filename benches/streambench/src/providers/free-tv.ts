const DIRECT_MEDIA_PATTERN = /\.(?:m3u8|mp4|webm|mp3|aac|m4a|ogg|opus|flac|php)(?:$|[?#])/i;
const GEO_MARKER_PATTERN = /[Ⓖⓖ]/u;

type FreeTvAttributes = Record<string, string>;

type FreeTvPlaylistResult = {
  body: string;
  count: number;
  total: number;
};

export const FREE_TV_COUNTRIES = [
  { code: "ALL", name: "Wszystkie", flag: "🌍" },
  { code: "PL", name: "Polska", flag: "🇵🇱" },
  { code: "DE", name: "Niemcy", flag: "🇩🇪" },
  { code: "CZ", name: "Czechy", flag: "🇨🇿" },
  { code: "SK", name: "Słowacja", flag: "🇸🇰" },
  { code: "UA", name: "Ukraina", flag: "🇺🇦" },
  { code: "GB", name: "Wielka Brytania", flag: "🇬🇧" },
  { code: "US", name: "USA", flag: "🇺🇸" },
  { code: "FR", name: "Francja", flag: "🇫🇷" },
  { code: "IT", name: "Włochy", flag: "🇮🇹" },
  { code: "ES", name: "Hiszpania", flag: "🇪🇸" },
];

function parseAttributes(line: string): FreeTvAttributes {
  const attributes: FreeTvAttributes = {};
  for (const match of line.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function isSelectedCountry(attributes: FreeTvAttributes, country: string): boolean {
  if (country === "ALL") return true;
  return (attributes["tvg-country"] || "")
    .split(/[;,]/)
    .map((code) => code.trim().toUpperCase())
    .includes(country);
}

function directHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DIRECT_MEDIA_PATTERN.test(url.href) ? url : null;
  } catch {
    return null;
  }
}

export function filterFreeTvPlaylist(source: string, country = "PL"): FreeTvPlaylistResult {
  const selectedCountry = country.toUpperCase();
  if (!FREE_TV_COUNTRIES.some((entry) => entry.code === selectedCountry)) {
    throw new TypeError("unsupported Free-TV country");
  }
  if (!source.trimStart().startsWith("#EXTM3U")) {
    throw new TypeError("invalid Free-TV playlist");
  }

  const output = ["#EXTM3U"];
  const seen = new Set<string>();
  let pending: string | null = null;
  let total = 0;

  for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      pending = line;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;

    total += 1;
    const attributes = parseAttributes(pending);
    const url = directHttpsUrl(line);
    const geoblocked = GEO_MARKER_PATTERN.test(pending);
    const key = attributes["tvg-id"] || url?.href || "";

    if (url && !geoblocked && isSelectedCountry(attributes, selectedCountry) && !seen.has(key)) {
      seen.add(key);
      output.push(pending, url.href);
    }
    pending = null;
  }

  return {
    body: `${output.join("\n")}\n`,
    count: (output.length - 1) / 2,
    total,
  };
}
