import { countDocumentStats } from "./token-counter-core.mjs";

const editor = document.querySelector("#editor");
const detailStatus = document.querySelector("#detail-status");
const eolSelect = document.querySelector("#eol-select");
const encodingLabel = document.querySelector("#encoding-label");

if (editor && detailStatus) {
  const STORAGE_KEY = "docbench:token-count-enabled";
  const numberFormatter = new Intl.NumberFormat();
  const tokenizerAssets = globalThis.__docbenchTokenizerAssets || {};
  const liteModuleUrl = tokenizerAssets.liteUrl || "./vendor/js-tiktoken/lite.js";
  const rankModuleUrl = tokenizerAssets.rankUrl || "./vendor/js-tiktoken/ranks/o200k_base.js";

  const style = document.createElement("style");
  style.textContent = `
    .document-stats-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px 14px;
      padding: 8px 12px 10px;
      color: var(--muted);
      font: 600 0.69rem/1.35 "Space Mono", ui-monospace, monospace;
    }
    .document-stats-bar .detail-status {
      margin: 0;
      padding: 0;
    }
    .document-counters {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 5px 10px;
    }
    .document-counter {
      white-space: nowrap;
    }
    .token-counter-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      white-space: nowrap;
    }
    .token-counter-toggle input {
      width: 14px;
      height: 14px;
      margin: 0;
    }
    #token-count-value {
      color: var(--text-soft);
    }
    @media (max-width: 680px) {
      .document-stats-bar,
      .document-counters {
        align-items: flex-start;
        justify-content: flex-start;
      }
      .document-stats-bar {
        flex-direction: column;
      }
    }
  `;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.className = "document-stats-bar";
  detailStatus.before(bar);
  bar.append(detailStatus);

  const counters = document.createElement("div");
  counters.className = "document-counters";
  counters.setAttribute("aria-label", "Document statistics");

  const words = document.createElement("span");
  words.className = "document-counter";
  const characters = document.createElement("span");
  characters.className = "document-counter";
  const bytes = document.createElement("span");
  bytes.className = "document-counter";

  const tokenToggle = document.createElement("label");
  tokenToggle.className = "token-counter-toggle";
  tokenToggle.title = "Count locally with the o200k_base tokenizer";
  const tokenCheckbox = document.createElement("input");
  tokenCheckbox.type = "checkbox";
  const tokenToggleText = document.createElement("span");
  tokenToggleText.textContent = "Tokens";
  tokenToggle.append(tokenCheckbox, tokenToggleText);

  const tokenValue = document.createElement("span");
  tokenValue.id = "token-count-value";
  tokenValue.className = "document-counter";
  tokenValue.setAttribute("aria-live", "polite");
  tokenValue.hidden = true;

  counters.append(words, characters, bytes, tokenToggle, tokenValue);
  bar.append(counters);

  let statsFrame = 0;
  let tokenTimer = 0;
  let tokenRevision = 0;
  let encoderPromise = null;

  const formatNumber = (value) => numberFormatter.format(value);

  function serializationOptions() {
    return {
      eol: eolSelect?.value || "LF",
      bom: encodingLabel?.textContent?.startsWith("UTF-8 BOM") || false,
    };
  }

  function updateBasicStats() {
    statsFrame = 0;
    const stats = countDocumentStats(editor.value, serializationOptions());
    words.textContent = `${formatNumber(stats.words)} word${stats.words === 1 ? "" : "s"}`;
    characters.textContent = `${formatNumber(stats.characters)} char${stats.characters === 1 ? "" : "s"}`;
    bytes.textContent = `${formatNumber(stats.bytes)} B`;
  }

  function scheduleBasicStats() {
    if (statsFrame) cancelAnimationFrame(statsFrame);
    statsFrame = requestAnimationFrame(updateBasicStats);
  }

  async function getEncoder() {
    if (!encoderPromise) {
      encoderPromise = Promise.all([
        import(liteModuleUrl),
        import(rankModuleUrl),
      ])
        .then(([{ Tiktoken }, { default: o200kBase }]) => new Tiktoken(o200kBase))
        .catch((error) => {
          encoderPromise = null;
          throw error;
        });
    }
    return encoderPromise;
  }

  async function updateTokenCount(revision) {
    tokenValue.textContent = "counting…";
    tokenValue.setAttribute("aria-busy", "true");
    try {
      const encoder = await getEncoder();
      if (revision !== tokenRevision || !tokenCheckbox.checked) return;
      const count = encoder.encode(editor.value).length;
      if (revision !== tokenRevision || !tokenCheckbox.checked) return;
      tokenValue.textContent = `${formatNumber(count)} token${count === 1 ? "" : "s"} · o200k`;
    } catch (error) {
      console.warn("DocBench token counter unavailable", error);
      tokenValue.textContent = "token count unavailable";
    } finally {
      if (revision === tokenRevision) tokenValue.removeAttribute("aria-busy");
    }
  }

  function scheduleTokenCount(delay = 360) {
    tokenRevision += 1;
    clearTimeout(tokenTimer);
    if (!tokenCheckbox.checked) {
      tokenValue.hidden = true;
      tokenValue.removeAttribute("aria-busy");
      return;
    }
    tokenValue.hidden = false;
    const revision = tokenRevision;
    tokenTimer = setTimeout(() => updateTokenCount(revision), delay);
  }

  function refreshCounters(delay = 0) {
    scheduleBasicStats();
    scheduleTokenCount(delay);
  }

  function storedTokenPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function storeTokenPreference(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // File URLs and hardened browsers may deny storage. The toggle still works for this session.
    }
  }

  tokenCheckbox.checked = storedTokenPreference();
  tokenCheckbox.addEventListener("change", () => {
    storeTokenPreference(tokenCheckbox.checked);
    scheduleTokenCount(0);
  });
  editor.addEventListener("input", () => refreshCounters(360));
  eolSelect?.addEventListener("change", () => refreshCounters(0));
  document.addEventListener("docbench:document-change", () => refreshCounters(0));
  if (encodingLabel) {
    new MutationObserver(() => scheduleBasicStats()).observe(encodingLabel, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  updateBasicStats();
  scheduleTokenCount(0);
}
