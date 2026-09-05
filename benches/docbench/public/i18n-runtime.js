"use strict";
(() => {

  const TEXT_NODE = globalThis.Node?.TEXT_NODE ?? 3;
  const ELEMENT_NODE = globalThis.Node?.ELEMENT_NODE ?? 1;

  function createBenchI18n(options) {
    const {
      baseLanguage,
      storageKey,
      pairs,
      patterns = {},
      mountSelector = "header",
      skipSelector = "",
      metaSelector = 'meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]',
    } = options;
    const languages = ["en", "pl"];
    const maps = Object.fromEntries(languages.map((language) => [language, new Map()]));
    for (const [en, pl] of pairs) {
      maps.en.set(en, en); maps.en.set(pl, en);
      maps.pl.set(en, pl); maps.pl.set(pl, pl);
    }

    const stored = (() => { try { return localStorage.getItem(storageKey); } catch { return null; } })();
    let language = languages.includes(stored)
      ? stored
      : (navigator.languages?.length ? navigator.languages : [navigator.language]).some((item) => /^pl(?:-|$)/i.test(item || "")) ? "pl" : "en";
    let applying = false;
    let switcher = null;

    const shouldSkip = (node) => {
      const element = node.nodeType === ELEMENT_NODE ? node : node.parentElement;
      if (!element) return true;
      if (element.closest("script,style,textarea,input,pre,code,[data-i18n-skip]")) return true;
      return Boolean(skipSelector && element.closest(skipSelector));
    };

    const shouldSkipAttributes = (element) =>
      Boolean(element.closest("script,style,[data-i18n-skip]") || (skipSelector && element.closest(skipSelector)));

    const translate = (value, target = language) => {
      if (typeof value !== "string" || !value) return value;
      const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const lead = match?.[1] || "";
      const core = match?.[2] || value;
      const tail = match?.[3] || "";
      const exact = maps[target]?.get(core);
      if (exact !== undefined) return `${lead}${exact}${tail}`;
      for (const [pattern, replacement] of patterns[target] || []) {
        pattern.lastIndex = 0;
        if (pattern.test(core)) {
          pattern.lastIndex = 0;
          return `${lead}${core.replace(pattern, replacement)}${tail}`;
        }
      }
      return value;
    };

    const source = (value) => translate(value, baseLanguage);

    const translateElement = (element) => {
      if (!(element instanceof Element) || shouldSkip(element)) return;
      for (const name of ["placeholder", "title", "aria-label"]) {
        if (!element.hasAttribute(name)) continue;
        const before = element.getAttribute(name);
        const after = translate(before);
        if (after !== before) element.setAttribute(name, after);
      }
      element.querySelectorAll("*").forEach((child) => {
        if (!shouldSkipAttributes(child)) for (const name of ["placeholder", "title", "aria-label"]) {
          if (child.hasAttribute(name)) child.setAttribute(name, translate(child.getAttribute(name)));
        }
      });
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = null;
      while ((node = walker.nextNode())) {
        if (shouldSkip(node)) continue;
        const after = translate(node.nodeValue);
        if (after !== node.nodeValue) node.nodeValue = after;
      }
    };

    const apply = (root = document.body) => {
      if (!root || applying) return;
      applying = true;
      try {
        document.documentElement.lang = language;
        document.title = translate(document.title);
        document.querySelectorAll(metaSelector).forEach((meta) => {
          const before = meta.getAttribute("content");
          const after = translate(before);
          if (after !== before) meta.setAttribute("content", after);
        });
        if (root.nodeType === TEXT_NODE) {
          if (!shouldSkip(root)) root.nodeValue = translate(root.nodeValue);
        } else {
          translateElement(root);
        }
        switcher?.querySelectorAll("button").forEach((button) => {
          button.setAttribute("aria-pressed", String(button.dataset.language === language));
        });
      } finally {
        applying = false;
      }
    };

    const setLanguage = (next) => {
      if (!languages.includes(next)) return;
      language = next;
      try { localStorage.setItem(storageKey, language); } catch { globalThis.__benchI18nStorageUnavailable = true; }
      apply(document.body);
      window.dispatchEvent(new CustomEvent("bench:languagechange", { detail: { language } }));
    };

    if (!document.getElementById("bench-i18n-style")) {
      const style = document.createElement("style");
      style.id = "bench-i18n-style";
      style.textContent = '.bench-language-switcher{display:inline-flex;gap:2px;margin-inline-start:auto;padding:2px;border:1px solid currentColor;border-radius:999px;opacity:.78}.bench-language-switcher button{border:0;background:transparent;color:inherit;font:inherit;font-size:.72rem;font-weight:700;line-height:1;padding:.38rem .48rem;border-radius:999px;cursor:pointer}.bench-language-switcher button[aria-pressed="true"]{background:currentColor;color:Canvas}';
      document.head.append(style);
    }

    const mount = document.querySelector(mountSelector);
    if (mount) {
      switcher = document.createElement("div");
      switcher.className = "bench-language-switcher";
      switcher.dataset.i18nSkip = "";
      switcher.setAttribute("role", "group");
      switcher.setAttribute("aria-label", "Language / Język");
      switcher.innerHTML = '<button type="button" data-language="en">EN</button><button type="button" data-language="pl">PL</button>';
      switcher.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-language]");
        if (button) setLanguage(button.dataset.language);
      });
      mount.append(switcher);
    }

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") apply(mutation.target);
        else mutation.addedNodes.forEach((node) => {
          if (node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE) apply(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    apply(document.body);

    return Object.freeze({
      t: (value) => translate(value),
      source,
      setLanguage,
      getLanguage: () => language,
    });
  }

  globalThis.createBenchI18n = createBenchI18n;
})();
