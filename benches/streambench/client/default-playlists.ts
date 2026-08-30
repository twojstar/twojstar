import {
  dedupePlaylist,
  parseM3uWorkspace,
  serializeM3u,
  type PlaylistItem,
} from "./playlist-format.ts";

type DefaultPlaylist = {
  path: string;
  defaultRadio: boolean;
};

declare global {
  interface Window {
    streambenchBundledUrls: Set<string>;
  }
}

const DEFAULT_PLAYLISTS: DefaultPlaylist[] = [
  { path: "/playlists/iptv.m3u8", defaultRadio: false },
  { path: "/playlists/internet_radio.m3u8", defaultRadio: true },
];

async function readPlaylist(source: DefaultPlaylist): Promise<PlaylistItem[]> {
  const response = await fetch(source.path, {
    headers: { accept: "audio/x-mpegurl,text/plain" },
  });
  if (!response.ok) throw new Error(`${source.path} returned ${response.status}`);

  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text.startsWith("#EXTM3U")) {
    throw new Error(`${source.path} is not an M3U playlist`);
  }

  return parseM3uWorkspace(text, {
    providerId: "bundled",
    providerLabel: "Wbudowane",
    defaultRadio: source.defaultRadio,
  });
}

async function loadDefaults(): Promise<void> {
  const textarea = document.querySelector<HTMLTextAreaElement>("#playlistText");
  const parseButton = document.querySelector<HTMLButtonElement>("#parsePlaylist");
  const entryCount = document.querySelector<HTMLElement>("#entryCount");
  if (!textarea || !parseButton) return;

  const sources = await Promise.allSettled(DEFAULT_PLAYLISTS.map(readPlaylist));
  for (const [index, result] of sources.entries()) {
    if (result.status === "rejected") {
      console.warn(`Streambench skipped ${DEFAULT_PLAYLISTS[index].path}`, result.reason);
    }
  }

  const items = dedupePlaylist(sources
    .filter((result): result is PromiseFulfilledResult<PlaylistItem[]> => result.status === "fulfilled")
    .flatMap((result) => result.value));

  if (!items.length) {
    console.warn("Streambench default playlists are unavailable");
    return;
  }

  window.streambenchBundledUrls = new Set(items.map((item) => item.url));
  if (Number(entryCount?.textContent || 0) > 0 || textarea.value.trim()) return;

  textarea.value = serializeM3u(items, { dedupe: false });
  parseButton.click();
  queueMicrotask(() => {
    textarea.value = "";
  });
}

loadDefaults().catch((error: unknown) => {
  console.warn("Streambench could not load its default playlists", error);
});
