export {};

const workspace = document.querySelector<HTMLElement>(".workspace");
const sourceTools = document.querySelector<HTMLElement>(".source-tools");
const toolsPanel = document.querySelector<HTMLDetailsElement>("#toolsPanel");
const library = document.querySelector<HTMLElement>(".library-box");
const epgImport = document.querySelector<HTMLElement>(".epg-import");
const playlistEmpty = document.querySelector<HTMLParagraphElement>("#playlistEmpty p");
const mobileTools = document.querySelector<HTMLElement>('[data-mobile-view-target="tools"]');

function sourceTab(id: string, label: string, selected = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `sourceTab-${id}`;
  button.className = "source-mode-tab";
  button.dataset.sourceTarget = id;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", `sourcePanel-${id}`);
  button.setAttribute("aria-selected", String(selected));
  button.textContent = label;
  return button;
}

function sourcePanel(id: string, selected = false): HTMLElement {
  const panel = document.createElement("section");
  panel.id = `sourcePanel-${id}`;
  panel.className = "source-mode-panel";
  panel.dataset.sourcePanel = id;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `sourceTab-${id}`);
  panel.hidden = !selected;
  return panel;
}

if (workspace && sourceTools) {
  const heading = sourceTools.querySelector<HTMLElement>(":scope > .tool-heading");
  const provider = sourceTools.querySelector<HTMLElement>(":scope > .provider-box");
  const divider = sourceTools.querySelector<HTMLElement>(":scope > .source-divider");
  const fileButton = sourceTools.querySelector<HTMLElement>(":scope > .file-button");
  const pasteBox = sourceTools.querySelector<HTMLElement>(":scope > .paste-box");
  const playlistTools = sourceTools.querySelector<HTMLElement>(":scope > .playlist-tools");

  divider?.remove();
  heading?.querySelector(".eyebrow")?.replaceChildren("Źródła i dane");
  heading?.querySelector("h3")?.replaceChildren("Katalog, własna M3U i XMLTV");

  const tabs = document.createElement("div");
  tabs.className = "source-mode-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Rodzaj danych wejściowych");

  const catalogTab = sourceTab("catalog", "Katalog", true);
  const playlistTab = sourceTab("playlist", "Własna M3U");
  const epgTab = sourceTab("epg", "XMLTV");
  tabs.append(catalogTab, playlistTab, epgTab);

  const catalogPanel = sourcePanel("catalog", true);
  const playlistPanel = sourcePanel("playlist");
  const epgPanel = sourcePanel("epg");
  if (provider) catalogPanel.append(provider);
  if (fileButton) playlistPanel.append(fileButton);
  if (pasteBox) playlistPanel.append(pasteBox);
  if (playlistTools) playlistPanel.append(playlistTools);
  if (epgImport) epgPanel.append(epgImport);

  const panels = document.createElement("div");
  panels.className = "source-mode-panels";
  panels.append(catalogPanel, playlistPanel, epgPanel);

  const children = [heading, tabs, panels].filter((node): node is HTMLElement => node !== null);
  sourceTools.replaceChildren(...children);

  const sourceDock = document.createElement("section");
  sourceDock.className = "panel source-dock";
  sourceDock.setAttribute("aria-label", "Źródła playlisty i XMLTV");
  sourceDock.append(sourceTools);
  workspace.after(sourceDock);

  const selectSource = (id: string | undefined): void => {
    tabs.querySelectorAll<HTMLElement>(".source-mode-tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.sourceTarget === id));
    });
    panels.querySelectorAll<HTMLElement>(".source-mode-panel").forEach((panel) => {
      panel.hidden = panel.dataset.sourcePanel !== id;
    });
  };

  tabs.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest<HTMLElement>(".source-mode-tab");
    if (tab) selectSource(tab.dataset.sourceTarget);
  });

  if (library) {
    library.classList.add("panel", "library-panel");
    sourceDock.after(library);
    const controls = library.querySelector<HTMLElement>(".library-controls");
    if (controls && !document.querySelector("#exportLibrary")) {
      const exportButton = document.createElement("button");
      exportButton.id = "exportLibrary";
      exportButton.type = "button";
      exportButton.className = "secondary";
      exportButton.textContent = "Eksportuj M3U";
      const copyButton = document.createElement("button");
      copyButton.id = "copyLibrary";
      copyButton.type = "button";
      copyButton.className = "secondary";
      copyButton.textContent = "Kopiuj";
      controls.append(exportButton, copyButton);
    }
  }
}

if (toolsPanel) {
  toolsPanel.querySelector(".tools-summary .eyebrow")?.replaceChildren("Zaplecze");
  toolsPanel.querySelector(".tools-summary h2")?.replaceChildren("Diagnostyka i program");
}

if (playlistEmpty) {
  playlistEmpty.textContent = "Wczytaj katalog lub własną playlistę w panelu pod odtwarzaczem.";
}

if (mobileTools?.firstChild) {
  mobileTools.firstChild.textContent = "Źródła";
}

window.dispatchEvent(new CustomEvent("streambench:layout-ready"));
