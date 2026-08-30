import { classifyChannel, type ChannelClassificationOptions } from "./channel-meta.ts";

type SourceDescriptionOptions = ChannelClassificationOptions & {
  pageProtocol?: string;
};

type HlsLevel = {
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
};

type HlsDescriptionOptions = {
  live?: boolean | null;
  duration?: number | null;
};

type MediaDescription = {
  videoWidth?: number;
  videoHeight?: number;
  duration?: number;
  readyState: number;
  networkState: number;
};

export function describeSource(rawUrl: string, options: SourceDescriptionOptions = {}) {
  const url = new URL(rawUrl);
  const channel = classifyChannel(url.href, options);
  const mixedContent = options.pageProtocol === "https:" && url.protocol === "http:";

  return {
    address: `${url.origin}${url.pathname}${url.search ? "?…" : ""}`,
    type: [channel.playback, channel.quality].filter(Boolean).join(" · "),
    security: mixedContent ? "Mixed content: przeglądarka może zablokować" : channel.protocol,
  };
}

export function describeHls(
  levels: HlsLevel[] = [],
  { live = null, duration = null }: HlsDescriptionOptions = {},
): string {
  const resolutions = [...new Set(levels
    .map((level) => level.height ? `${level.height}p` : "")
    .filter(Boolean))];
  const codecs = [...new Set(levels
    .flatMap((level) => [level.videoCodec, level.audioCodec])
    .filter((codec): codec is string => Boolean(codec)))];
  const parts: string[] = [];

  if (live !== null) parts.push(live ? "live" : "VOD");
  if (levels.length) parts.push(`${levels.length} wariantów`);
  if (resolutions.length) parts.push(resolutions.join(", "));
  if (codecs.length) parts.push(codecs.join(", "));
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0 && !live) {
    parts.push(`${Math.round(duration)} s`);
  }
  return parts.join(" · ") || "Brak danych manifestu";
}

export function describeMedia(media: MediaDescription | null | undefined): string {
  if (!media) return "Brak danych odtwarzacza";
  const parts: string[] = [];
  if (media.videoWidth && media.videoHeight) parts.push(`${media.videoWidth}×${media.videoHeight}`);
  if (typeof media.duration === "number" && Number.isFinite(media.duration) && media.duration > 0) {
    parts.push(`${Math.round(media.duration)} s`);
  }
  parts.push(`ready ${media.readyState}`);
  parts.push(`network ${media.networkState}`);
  return parts.join(" · ");
}
