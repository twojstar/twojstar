import { formatProgramme, parseXmltv, scheduleForChannel, type XmltvProgrammes } from "./xmltv.ts";

const MAX_XMLTV_BYTES = 10_000_000;

const ui = {
  file: document.querySelector<HTMLInputElement>("#epgFile")!,
  text: document.querySelector<HTMLTextAreaElement>("#epgText")!,
  loadText: document.querySelector<HTMLButtonElement>("#loadEpgText")!,
  status: document.querySelector<HTMLElement>("#epgStatus")!,
  now: document.querySelector<HTMLElement>("#epgNow")!,
  next: document.querySelector<HTMLElement>("#epgNext")!,
};

let programmes: XmltvProgrammes = new Map();
let activeChannel: { id?: string } | null = null;

function setStatus(message: string, state = "idle"): void {
  ui.status.textContent = message;
  ui.status.dataset.state = state;
}

function renderSchedule(): void {
  if (!activeChannel?.id) {
    ui.now.textContent = "Wybierz kanał z tvg-id";
    ui.next.textContent = "Brak danych";
    return;
  }
  const schedule = scheduleForChannel(programmes, activeChannel.id);
  ui.now.textContent = formatProgramme(schedule.current);
  ui.next.textContent = formatProgramme(schedule.next);
}

function loadSource(source: string, label: string): void {
  if (new Blob([source]).size > MAX_XMLTV_BYTES) throw new Error("XMLTV source is too large");
  programmes = parseXmltv(source);
  const count = [...programmes.values()].reduce((sum, entries) => sum + entries.length, 0);
  setStatus(count ? `${label}: ${count} audycji` : `${label}: brak audycji`, count ? "idle" : "error");
  renderSchedule();
}

ui.file.addEventListener("change", async () => {
  const [file] = ui.file.files || [];
  if (!file) return;
  try {
    if (file.size > MAX_XMLTV_BYTES) throw new Error("XMLTV file is too large");
    loadSource(await file.text(), file.name);
  } catch {
    setStatus("Nie udało się odczytać XMLTV (limit 10 MB).", "error");
  } finally {
    ui.file.value = "";
  }
});

ui.loadText.addEventListener("click", () => {
  try {
    loadSource(ui.text.value, "Wklejony XMLTV");
  } catch {
    setStatus("Nieprawidłowy XMLTV lub przekroczony limit 10 MB.", "error");
  }
});

window.addEventListener("streambench:channel", (event) => {
  activeChannel = (event as CustomEvent<{ id?: string } | null>).detail || null;
  renderSchedule();
});

setInterval(renderSchedule, 60_000);
