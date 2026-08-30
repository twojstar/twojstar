const MAX_PROGRAMMES = 100_000;
const MAX_OPEN_PROGRAMME_MS = 6 * 60 * 60 * 1_000;

export type XmltvProgramme = {
  channel: string;
  channelName?: string;
  start: number;
  stop: number | null;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
};

export type XmltvProgrammes = Map<string, XmltvProgramme[]>;

export function parseXmltvDate(rawValue: unknown): number | null {
  const value = String(rawValue || "").trim();
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-]\d{4})?\s*$/);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText = "00", minuteText = "00", secondText = "00", zone = "Z"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;

  const localTimestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const localDate = new Date(localTimestamp);
  if (
    localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hour
    || localDate.getUTCMinutes() !== minute
    || localDate.getUTCSeconds() !== second
  ) return null;

  let timestamp = localTimestamp;
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(3, 5));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    const sign = zone[0] === "+" ? 1 : -1;
    timestamp -= sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  }
  return timestamp;
}

function textContent(element: ParentNode, selector: string): string {
  return element.querySelector(selector)?.textContent?.trim() || "";
}

export function parseXmltv(source: unknown, Parser: typeof DOMParser = globalThis.DOMParser): XmltvProgrammes {
  if (typeof Parser !== "function") throw new Error("DOMParser is unavailable");
  const document = new Parser().parseFromString(String(source || ""), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("invalid XMLTV document");

  const channelNames = new Map<string, string>();
  for (const channel of document.querySelectorAll("channel[id]")) {
    const id = channel.getAttribute("id");
    if (id) channelNames.set(id, textContent(channel, "display-name"));
  }

  const programmes: XmltvProgrammes = new Map();
  let programmeCount = 0;
  for (const element of document.querySelectorAll("programme[channel][start]")) {
    if (programmeCount >= MAX_PROGRAMMES) throw new Error("XMLTV programme limit exceeded");
    const channel = element.getAttribute("channel") || "";
    const start = parseXmltvDate(element.getAttribute("start"));
    const stop = parseXmltvDate(element.getAttribute("stop"));
    const title = textContent(element, "title");
    if (!channel || start === null || !title) continue;

    const programme: XmltvProgramme = {
      channel,
      channelName: channelNames.get(channel) || channel,
      start,
      stop: stop !== null && stop > start ? stop : null,
      title,
      subtitle: textContent(element, "sub-title"),
      description: textContent(element, "desc"),
      category: textContent(element, "category"),
    };
    const entries = programmes.get(channel) || [];
    entries.push(programme);
    programmes.set(channel, entries);
    programmeCount += 1;
  }

  for (const entries of programmes.values()) {
    entries.sort((left, right) => left.start - right.start);
  }
  return programmes;
}

export function scheduleForChannel(
  programmes: ReadonlyMap<string, readonly XmltvProgramme[]>,
  channelId: string,
  now = Date.now(),
): { current: XmltvProgramme | null; next: XmltvProgramme | null } {
  const entries = programmes.get(channelId) || [];
  let current: XmltvProgramme | null = null;
  let next: XmltvProgramme | null = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const inferredStop = entry.stop
      ?? entries[index + 1]?.start
      ?? entry.start + MAX_OPEN_PROGRAMME_MS;
    if (entry.start <= now && now < inferredStop) current = entry;
    if (entry.start > now) {
      next = entry;
      break;
    }
  }
  return { current, next };
}

export function formatProgramme(programme: XmltvProgramme | null | undefined, locale = "pl-PL"): string {
  if (!programme) return "Brak danych";
  const formatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const range = programme.stop
    ? `${formatter.format(programme.start)}–${formatter.format(programme.stop)}`
    : formatter.format(programme.start);
  return `${range} · ${programme.title}${programme.subtitle ? ` · ${programme.subtitle}` : ""}`;
}
