import { createLocalState } from "./local-state.ts";
import { serializeM3u, type PlaylistItem } from "./playlist-format.ts";

const library = createLocalState();
const view = document.querySelector<HTMLSelectElement>("#libraryView");
const exportButton = document.querySelector<HTMLButtonElement>("#exportLibrary");
const copyButton = document.querySelector<HTMLButtonElement>("#copyLibrary");
const status = document.querySelector<HTMLElement>("#workspaceStatus");

type LibraryView = "favorites" | "recent" | "hidden";

function selectedView(): LibraryView {
  const value = view?.value;
  return value === "recent" || value === "hidden" ? value : "favorites";
}

function setStatus(message: string, state = "idle"): void {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function selectedItems(): PlaylistItem[] {
  library.reload();
  return library.items(selectedView()) as PlaylistItem[];
}

function exportText(): string {
  return serializeM3u(selectedItems(), { dedupe: true });
}

function viewName(): string {
  return view?.selectedOptions?.[0]?.textContent?.trim() || "Biblioteka";
}

exportButton?.addEventListener("click", () => {
  const items = selectedItems();
  if (!items.length) return setStatus(`${viewName()}: brak pozycji do eksportu`, "error");
  const blob = new Blob([serializeM3u(items, { dedupe: true })], { type: "audio/x-mpegurl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `streambench-${selectedView()}.m3u8`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`${viewName()}: wyeksportowano ${items.length} pozycji`);
});

copyButton?.addEventListener("click", async () => {
  const items = selectedItems();
  if (!items.length) return setStatus(`${viewName()}: brak pozycji do skopiowania`, "error");
  try {
    await navigator.clipboard.writeText(exportText());
    setStatus(`${viewName()}: M3U skopiowane`);
  } catch {
    setStatus("Nie udało się skopiować biblioteki", "error");
  }
});
