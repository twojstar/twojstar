"use strict";
(() => {

  const TEXT_NODE = globalThis.Node?.TEXT_NODE ?? 3;
  const ELEMENT_NODE = globalThis.Node?.ELEMENT_NODE ?? 1;

  function createBenchI18n(options) {
    const {
      baseLanguage,
      storageKey = "",
      storage = null,
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

    const browserLanguage = (navigator.languages?.length ? navigator.languages : [navigator.language])
      .map((item) => /^pl(?:-|$)/i.test(item || "") ? "pl" : /^en(?:-|$)/i.test(item || "") ? "en" : null)
      .find((item) => item !== null) || "en";
    const readStoredLanguage = () => {
      if (!storageKey) return null;
      try {
        const stored = storage?.getItem(storageKey);
        return languages.includes(stored) ? stored : null;
      } catch {
        return null;
      }
    };
    const storeLanguage = (next) => {
      if (!storageKey) return;
      try {
        storage?.setItem(storageKey, next);
      } catch {
        return;
      }
    };
    let language = readStoredLanguage() || browserLanguage;
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
    const isKnownVariant = (canonical, value) =>
      languages.some((target) => translate(canonical, target) === value);
    const textSources = new WeakMap();
    const attributeSources = new WeakMap();
    const metaSources = new WeakMap();
    let titleSource = null;

    const canonicalText = (node) => {
      const current = node.nodeValue;
      let canonical = textSources.get(node);
      if (canonical === undefined || !isKnownVariant(canonical, current)) {
        canonical = source(current);
        textSources.set(node, canonical);
      }
      return canonical;
    };

    const canonicalAttribute = (element, name, current) => {
      let sources = attributeSources.get(element);
      if (!sources) {
        sources = new Map();
        attributeSources.set(element, sources);
      }
      let canonical = sources.get(name);
      if (canonical === undefined || !isKnownVariant(canonical, current)) {
        canonical = source(current);
        sources.set(name, canonical);
      }
      return canonical;
    };

    const translateAttribute = (element, name) => {
      if (!element.hasAttribute(name)) return;
      const before = element.getAttribute(name);
      const canonical = canonicalAttribute(element, name, before);
      const after = translate(canonical);
      if (after !== before) element.setAttribute(name, after);
    };

    const translateTextNode = (node) => {
      if (shouldSkip(node)) return;
      const after = translate(canonicalText(node));
      if (after !== node.nodeValue) node.nodeValue = after;
    };

    const translateElement = (element) => {
      if (!(element instanceof Element) || shouldSkip(element)) return;
      for (const name of ["placeholder", "title", "aria-label"]) translateAttribute(element, name);
      element.querySelectorAll("*").forEach((child) => {
        if (!shouldSkipAttributes(child)) {
          for (const name of ["placeholder", "title", "aria-label"]) translateAttribute(child, name);
        }
      });
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = null;
      while ((node = walker.nextNode())) translateTextNode(node);
    };

    const translateTitle = () => {
      const current = document.title;
      if (titleSource === null || !isKnownVariant(titleSource, current)) titleSource = source(current);
      const after = translate(titleSource);
      if (after !== current) document.title = after;
    };

    const translateMeta = (meta) => {
      const current = meta.getAttribute("content");
      if (typeof current !== "string") return;
      let canonical = metaSources.get(meta);
      if (canonical === undefined || !isKnownVariant(canonical, current)) {
        canonical = source(current);
        metaSources.set(meta, canonical);
      }
      const after = translate(canonical);
      if (after !== current) meta.setAttribute("content", after);
    };

    const apply = (root = document.body) => {
      if (!root || applying) return;
      applying = true;
      try {
        document.documentElement.lang = language;
        translateTitle();
        document.querySelectorAll(metaSelector).forEach(translateMeta);
        if (root.nodeType === TEXT_NODE) {
          translateTextNode(root);
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
      storeLanguage(language);
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
        if (mutation.type === "characterData" || mutation.type === "attributes") {
          apply(mutation.target);
        } else {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === ELEMENT_NODE || node.nodeType === TEXT_NODE) apply(node);
          });
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
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
