import { activePlaylistIndex, submitPlaybackForm } from "./playback-submission.js";

"use strict";

(() => {
  const form = document.querySelector("#streamForm");
  const input = document.querySelector("#streamUrl");
  const submit = form?.querySelector('button[type="submit"]');
  const playlistText = document.querySelector("#playlistText");
  const parseButton = document.querySelector("#parsePlaylist");
  const entries = document.querySelector("#playlistEntries");
  const shell = document.querySelector(".media-shell");
  const hint = document.querySelector("#streamHint");
  const status = document.querySelector("#status");
  const diagnosticError = document.querySelector("#diagnosticError");
  const nowPlaying = document.querySelector("#nowPlaying");
  if (!form || !input || !shell) return;

  const M3U_PATTERN = /\.m3u(?:$|[?#])/i;
  let passThrough = false;
  let sourceGeneration = 0;
  let userEditedInput = false;

  function remoteUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url.href, {
        headers: { accept: "application/x-mpegurl,audio/x-mpegurl,text/plain" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  function firstStreamUrl(source) {
    for (const rawLine of String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const url = remoteUrl(line);
      if (url) return url.href;
    }
    return "";
  }

  function setFailure(message, detail = message) {
    status.textContent = "Błąd";
    status.dataset.state = "error";
    hint.textContent = message;
    if (diagnosticError) diagnosticError.textContent = detail;
  }

  async function resolveNestedStream(url) {
    const source = await fetchText(url);
    const resolved = firstStreamUrl(source);
    if (!resolved) throw new Error("Playlista nie zawiera adresu streamu.");
    return resolved;
  }

  async function importRemotePlaylist(url, generation) {
    const source = await fetchText(url);
    if (generation !== sourceGeneration) return;
    if (!source.trimStart().startsWith("#EXTM3U")) {
      throw new Error("Adres nie zwrócił playlisty M3U.");
    }
    if (!playlistText || !parseButton) throw new Error("Import playlisty jest niedostępny.");
    playlistText.value = source;
    parseButton.click();
    queueMicrotask(() => {
      playlistText.value = "";
    });
  }

  function normalizeMetadataLayout() {
    const tabs = shell.closest(".player-tabs");
    if (!tabs) return;
    const panel = tabs.querySelector(".player-metadata");
    const content = panel?.lastElementChild;

    if (panel && content) {
      panel.querySelector(".player-metadata-empty")?.remove();
      panel.className = "channel-details";
      panel.removeAttribute("role");
      form.insertAdjacentElement("afterend", panel);

      const sync = () => {
        panel.hidden = content.hidden;
      };
      new MutationObserver(sync).observe(content, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
      sync();
    }

    tabs.replaceWith(shell);
  }

  input.addEventListener("input", () => {
    userEditedInput = true;
    sourceGeneration += 1;
  });

  window.addEventListener("streambench:playback-stop", () => {
    sourceGeneration += 1;
    passThrough = false;
    userEditedInput = false;
  });

  form.addEventListener("submit", async (event) => {
    const generation = ++sourceGeneration;
    const topLevelSubmission = event.submitter === submit || userEditedInput;
    userEditedInput = false;

    if (passThrough) {
      passThrough = false;
      return;
    }
    if (!topLevelSubmission) return;

    const url = remoteUrl(input.value);
    if (!url || !M3U_PATTERN.test(url.href)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (submit) submit.disabled = true;
    status.textContent = "Wczytywanie";
    status.dataset.state = "loading";
    hint.textContent = "Pobieranie zdalnej playlisty M3U.";

    try {
      await importRemotePlaylist(url, generation);
    } catch (error) {
      if (generation !== sourceGeneration) return;
      const reason = error instanceof Error ? error.message : String(error);
      setFailure(
        "Nie udało się pobrać playlisty. Serwer może być offline albo blokować CORS.",
        `Źródło: ${reason}`,
      );
    } finally {
      if (submit) submit.disabled = false;
    }
  }, true);

  window.addEventListener("streambench:channel", (event) => {
    const generation = ++sourceGeneration;
    if (!event.detail?.title) return;

    setTimeout(async () => {
      if (generation !== sourceGeneration) return;
      const nestedUrl = remoteUrl(input.value);
      if (!nestedUrl || !M3U_PATTERN.test(nestedUrl.href)) return;

      const originalTitle = nowPlaying?.textContent || event.detail.title;
      const activeEntry = entries?.querySelector('.entry-action[aria-current="true"]');
      status.textContent = "Rozwiązywanie";
      status.dataset.state = "loading";
      hint.textContent = "Pobieranie adresu z zagnieżdżonej playlisty M3U.";

      try {
        const resolved = await resolveNestedStream(nestedUrl);
        if (generation !== sourceGeneration) return;
        input.value = resolved;
        passThrough = true;
        submitPlaybackForm(form, {
          playlistIndex: activePlaylistIndex(form),
          preserveSelection: true,
          preserveAttempt: true,
        });
        queueMicrotask(() => {
          if (nowPlaying) nowPlaying.textContent = originalTitle;
          activeEntry?.setAttribute("aria-current", "true");
          hint.textContent = "Rozwiązano playlistę do bezpośredniego adresu streamu.";
        });
      } catch (error) {
        if (generation !== sourceGeneration) return;
        const reason = error instanceof Error ? error.message : String(error);
        setFailure(
          "Nie udało się rozwiązać zagnieżdżonej playlisty.",
          `Źródło: ${reason}`,
        );
      }
    }, 0);
  });

  if (diagnosticError && hint) {
    new MutationObserver(() => {
      const error = diagnosticError.textContent || "";
      if (/manifestLoadError|levelLoadError|fragLoadError/i.test(error)) {
        hint.textContent = "HLS nie został pobrany. Przy własnych playlistach zwykle oznacza to CORS, mixed content, geoblokadę albo martwy adres.";
      }
    }).observe(diagnosticError, { childList: true, subtree: true });
  }

  normalizeMetadataLayout();
})();
