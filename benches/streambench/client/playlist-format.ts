const ATTRIBUTE_PATTERN = /([\w-]+)="([^"]*)"/g;
const AUDIO_PATTERN = /\.(mp3|aac|m4a|ogg|opus|flac)(?:$|[?#])/i;

type Attributes = Record<string, string>;

type PendingItem = {
  attributes: Attributes;
  id: string;
  title: string;
  group: string;
  album: string;
  logo: string;
  country: string;
  language: string;
  tags: string;
  codec: string;
  bitrate: string;
  quality: string;
  radio: boolean;
  hls: boolean;
  directives: string[];
};

export type PlaylistItem = {
  id: string;
  url: string;
  title: string;
  sourceTitle?: string;
  group?: string;
  album?: string;
  logo?: string;
  country?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: string;
  quality?: string;
  radio?: boolean;
  hls?: boolean;
  providerId?: string;
  providerLabel?: string;
  attributes?: Record<string, unknown>;
  directives?: unknown[];
  [key: string]: unknown;
};

type ParseOptions = {
  providerId?: string;
  providerLabel?: string;
  defaultRadio?: boolean;
};

type SerializeOptions = {
  dedupe?: boolean;
};

function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeText(value: unknown, maxLength = 500): string {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function parseAttributes(line: string): Attributes {
  const attributes: Attributes = {};
  for (const match of line.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1].toLowerCase()] = match[2];
  }
  return attributes;
}

function extinfTitle(line: string): string {
  let quoted = false;
  for (let index = "#EXTINF:".length; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index - 1] !== "\\") quoted = !quoted;
    if (character === "," && !quoted) return line.slice(index + 1).trim();
  }
  return "";
}

export function parseM3uWorkspace(
  source: unknown,
  { providerId = "local", providerLabel = "Lokalna", defaultRadio = false }: ParseOptions = {},
): PlaylistItem[] {
  const items: PlaylistItem[] = [];
  let pending: PendingItem | null = null;

  for (const rawLine of String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const attributes = parseAttributes(line);
      pending = {
        attributes,
        id: attributes["tvg-id"] || "",
        title: extinfTitle(line) || attributes["tvg-name"] || "",
        group: attributes["group-title"] || "",
        album: "",
        logo: safeUrl(attributes["tvg-logo"]),
        country: attributes["tvg-country"] || "",
        language: attributes["tvg-language"] || "",
        tags: attributes["tvg-tags"] || "",
        codec: attributes["tvg-codec"] || "",
        bitrate: attributes["tvg-bitrate"] || "",
        quality: attributes["tvg-quality"] || attributes.quality || attributes.resolution || "",
        radio: attributes.radio === "true" || attributes.type === "radio",
        hls: attributes.hls === "true",
        directives: [],
      };
      continue;
    }

    if (line.startsWith("#EXTALB:")) {
      if (pending) pending.album = safeText(line.slice("#EXTALB:".length), 120);
      continue;
    }

    if (line.startsWith("#")) {
      if (pending && line.length <= 2_000) pending.directives.push(line);
      continue;
    }
    const url = safeUrl(line);
    if (!url) {
      pending = null;
      continue;
    }

    const title = pending?.title || new URL(url).hostname;
    const radio = pending?.radio || defaultRadio || AUDIO_PATTERN.test(url);
    items.push({
      id: pending?.id || "",
      url,
      title,
      sourceTitle: title,
      group: pending?.group || "Bez grupy",
      album: pending?.album || "",
      logo: pending?.logo || "",
      country: pending?.country || "",
      language: pending?.language || "",
      tags: pending?.tags || "",
      codec: pending?.codec || "",
      bitrate: pending?.bitrate || "",
      quality: pending?.quality || "",
      radio,
      hls: pending?.hls || /\.m3u8(?:$|[?#])/i.test(url),
      providerId,
      providerLabel,
      attributes: pending?.attributes || {},
      directives: pending?.directives || [],
    });
    pending = null;
  }

  return items;
}

function attributeValue(value: unknown): string {
  return safeText(value, 500).replace(/["\\]/g, "");
}

function titleValue(value: unknown): string {
  return safeText(value, 500).replace(/[\r\n]/g, " ");
}

export function dedupePlaylist(items: readonly PlaylistItem[] | null | undefined): PlaylistItem[] {
  const result: PlaylistItem[] = [];
  const seen = new Set<string>();
  for (const item of items || []) {
    const url = safeUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ ...item, url });
  }
  return result;
}

export function serializeM3u(
  items: readonly PlaylistItem[] | null | undefined,
  { dedupe = true }: SerializeOptions = {},
): string {
  const source = dedupe ? dedupePlaylist(items) : (items || []).filter((item) => safeUrl(item?.url));
  const lines = ["#EXTM3U"];
  const known = new Set([
    "tvg-id", "tvg-name", "tvg-logo", "tvg-country", "tvg-language",
    "tvg-tags", "tvg-codec", "tvg-bitrate", "tvg-quality", "quality",
    "resolution", "group-title", "radio", "type", "hls",
  ]);

  for (const item of source) {
    const attributes: string[] = [];
    const add = (name: string, value: unknown): void => {
      const safe = attributeValue(value);
      if (safe) attributes.push(`${name}="${safe}"`);
    };
    add("tvg-id", item.id);
    add("tvg-name", item.title);
    add("tvg-logo", item.logo);
    add("tvg-country", item.country);
    add("tvg-language", item.language);
    add("tvg-tags", item.tags);
    add("tvg-codec", item.codec);
    add("tvg-bitrate", item.bitrate);
    add("tvg-quality", item.quality);
    add("group-title", item.group && item.group !== "Bez grupy" ? item.group : "");
    if (item.radio) attributes.push('radio="true"');
    if (item.hls && !/\.m3u8(?:$|[?#])/i.test(item.url)) attributes.push('hls="true"');

    for (const [name, value] of Object.entries(item.attributes || {})) {
      if (known.has(name) || !/^[\w-]+$/.test(name)) continue;
      add(name, value);
    }

    const title = titleValue(item.title) || new URL(item.url).hostname;
    lines.push(`#EXTINF:-1${attributes.length ? ` ${attributes.join(" ")}` : ""},${title}`);
    if (item.album) lines.push(`#EXTALB:${titleValue(item.album)}`);
    for (const directive of item.directives || []) {
      const safeDirective = String(directive || "").replace(/[\r\n]+/g, "").slice(0, 2_000);
      if (safeDirective.startsWith("#") && !safeDirective.startsWith("#EXTINF:")) lines.push(safeDirective);
    }
    lines.push(item.url);
  }
  return `${lines.join("\n")}\n`;
}
