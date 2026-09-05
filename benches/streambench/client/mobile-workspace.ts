export {};

const mediaQuery = window.matchMedia("(max-width: 840px)");
const nav = document.querySelector<HTMLElement>("#mobileWorkspaceNav");
const buttons = [...document.querySelectorAll<HTMLElement>("[data-mobile-view-target]")];
const playlistCount = document.querySelector<HTMLElement>("#mobilePlaylistCount");
const entryCount = document.querySelector<HTMLElement>("#entryCount")!;
const status = document.querySelector<HTMLElement>("#status")!;
const toolsPanel = document.querySelector<HTMLDetailsElement>("#toolsPanel");

type ViewOptions = { scroll?: boolean };

function updateCount(): void {
  if (playlistCount) playlistCount.textContent = entryCount.textContent?.trim() || "0";
}

function syncToolsDrawer(): void {
  if (mediaQuery.matches && document.body.dataset.mobileView === "tools" && toolsPanel) {
    toolsPanel.open = true;
  }
}

function setView(view: string | undefined, { scroll = false }: ViewOptions = {}): void {
  if (!view || !buttons.some((button) => button.dataset.mobileViewTarget === view)) return;
  document.body.dataset.mobileView = view;
  syncToolsDrawer();
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.mobileViewTarget === view));
  }
  if (scroll && mediaQuery.matches) nav?.scrollIntoView({ block: "start", behavior: "smooth" });
}

for (const button of buttons) {
  button.addEventListener("click", () => setView(button.dataset.mobileViewTarget, { scroll: true }));
}

mediaQuery.addEventListener("change", syncToolsDrawer);
new MutationObserver(updateCount).observe(entryCount, { childList: true, subtree: true, characterData: true });
new MutationObserver(() => {
  if (status.textContent?.trim() !== "Playlista gotowa") return;
  document.body.dataset.hasPlaylist = "true";
  updateCount();
  setView("playlist", { scroll: true });
}).observe(status, { childList: true, subtree: true, characterData: true });

window.addEventListener("streambench:channel", (event) => {
  const detail = (event as CustomEvent<{ title?: string }>).detail;
  if (detail?.title) setView("player", { scroll: mediaQuery.matches });
});

setView("player");
updateCount();
