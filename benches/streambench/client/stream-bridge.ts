import { relayForSource, type ProviderRelayMap } from "./provider-relay.ts";

type RelayTargetOptions = {
  origin?: string;
  bundledUrls?: Set<string>;
  providerRelays?: ProviderRelayMap;
};

export function relayTarget(
  rawUrl: unknown,
  {
    origin = "https://streambench.invalid",
    bundledUrls = new Set<string>(),
    providerRelays = new Map<string, string>(),
  }: RelayTargetOptions = {},
): URL | null {
  let source: URL;
  try {
    source = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(source.protocol)) return null;

  const providerRelay = relayForSource(source, providerRelays);
  if (providerRelay) return providerRelay;

  if (!(bundledUrls instanceof Set) || !bundledUrls.has(source.href)) return null;

  const hls = /\.m3u8$/i.test(source.pathname);
  if (source.protocol !== "http:" && !hls) return null;

  const relay = new URL("/api/relay", origin);
  relay.searchParams.set("url", source.href);
  const extension = source.pathname.match(/\.(m3u8|mp3|aac|m4a|ogg|opus|flac)$/i)?.[0];
  if (extension) relay.hash = `streambench${extension.toLowerCase()}`;
  return relay;
}

if (typeof document !== "undefined") {
  const form = document.querySelector<HTMLFormElement>("#streamForm");
  const input = document.querySelector<HTMLInputElement>("#streamUrl");
  const mode = document.querySelector<HTMLSelectElement>("#mediaMode");
  const shell = document.querySelector<HTMLElement>(".media-shell");
  const hint = document.querySelector<HTMLElement>("#streamHint");
  const title = document.querySelector<HTMLElement>("#nowPlaying");
  const entries = document.querySelector<HTMLElement>("#playlistEntries");

  const browserRelay = (value: unknown): URL | null => relayTarget(value, {
    origin: location.origin,
    bundledUrls: window.streambenchBundledUrls,
    providerRelays: window.streambenchProviderRelays,
  });

  form?.addEventListener("submit", () => {
    if (!input) return;
    const original = input.value;
    const relay = browserRelay(original);
    if (!relay) return;

    input.value = relay.href;
    queueMicrotask(() => {
      if (input.value === relay.href) input.value = original;
      if (hint) {
        hint.textContent = "Stream przechodzi przez ograniczony przekaźnik Streambencha, aby ominąć mixed content lub CORS HLS.";
      }
    });
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const action = target?.closest<HTMLElement>("#playlistEntries .entry-action");
    if (!action || !form || !input) return;

    queueMicrotask(() => {
      entries?.querySelectorAll('[aria-current="true"]').forEach((entry) => {
        entry.removeAttribute("aria-current");
      });
      action.setAttribute("aria-current", "true");

      const original = input.value;
      const relay = browserRelay(original);
      if (!relay) return;

      const selectedTitle = title?.textContent || "";
      const selectedMode = shell?.dataset.mode;
      const previousMode = mode?.value;
      input.value = relay.href;
      if (mode && selectedMode) mode.value = selectedMode;
      form.requestSubmit();
      input.value = original;
      if (mode && previousMode) mode.value = previousMode;

      action.setAttribute("aria-current", "true");
      if (title && selectedTitle) title.textContent = selectedTitle;
      window.dispatchEvent(new CustomEvent("streambench:channel", {
        detail: { title: selectedTitle },
      }));
      if (hint) {
        hint.textContent = "Stream przechodzi przez ograniczony przekaźnik Streambencha, aby ominąć mixed content lub CORS HLS.";
      }
    });
  });
}
