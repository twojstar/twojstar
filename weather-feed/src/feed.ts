import { CONFIG, POLLEN_PL } from "./config";
import { CONDITION_PL } from "./ensemble";
import type {
  AirQuality, DayEnsemble, Ensemble, FeedEntry, Warning,
} from "./types";
import { warningIsExpired } from "./warnings";

export const FEED_ID = "tag:travny,2026:weather:koscielec";

// Compare against the last *published* baseline (not the last run) so small
// drift doesn't accumulate into spurious entries.
export function currentChange(prev: Ensemble | null, next: Ensemble): FeedEntry | null {
  const reasons: string[] = [];
  if (prev) {
    const dT = delta(prev.tempC.median, next.tempC.median);
    if (dT !== null && Math.abs(dT) >= CONFIG.thresholds.currentTempC)
      reasons.push(`temperatura ${signed(dT)}°C → ${fmt(next.tempC.median)}°C`);
    if (prev.condition !== next.condition)
      reasons.push(`${CONDITION_PL[prev.condition]} → ${CONDITION_PL[next.condition]}`);
    if (crossed(prev.precipMm.median, next.precipMm.median, CONFIG.thresholds.precipOnsetMm))
      reasons.push((next.precipMm.median ?? 0) >= CONFIG.thresholds.precipOnsetMm ? "zaczęło padać" : "opady ustały");
  } else {
    reasons.push("pierwszy odczyt");
  }
  if (reasons.length === 0) return null;

  const uv = next.uv.median !== null ? `, UV ${fmt(next.uv.median)}` : "";
  const now = new Date().toISOString();
  return {
    id: `${FEED_ID}:current:${now}`,
    kind: "current_change",
    title: `${CONFIG.place}: ${CONDITION_PL[next.condition]}, ${fmt(next.tempC.median)}°C`,
    summary: `${reasons.join("; ")}. `
      + `Mediana ${next.sources.length} źródeł: ${fmt(next.tempC.median)}°C `
      + `(rozrzut ${fmt(next.tempC.min)}–${fmt(next.tempC.max)}°C), `
      + `wiatr ${fmt(next.windMs.median)} m/s, wilgotność ${fmt(next.humidity.median)}%${uv}.`,
    published: now,
  };
}

export function forecastRevision(prev: DayEnsemble[] | null, next: DayEnsemble[]): FeedEntry | null {
  const byDate = new Map((prev ?? []).map((d) => [d.date, d]));
  const changed: string[] = [];
  for (const d of next) {
    const p = byDate.get(d.date);
    if (!p) continue;
    const dMax = delta(p.tMaxC.median, d.tMaxC.median);
    if (dMax !== null && Math.abs(dMax) >= CONFIG.thresholds.forecastTMaxC)
      changed.push(`${d.date}: max ${signed(dMax)}°C → ${fmt(d.tMaxC.median)}°C`);
    else if (crossed(p.precipProb.median, d.precipProb.median, CONFIG.thresholds.forecastPrecipProb))
      changed.push(`${d.date}: szansa opadów ${fmt(p.precipProb.median)}% → ${fmt(d.precipProb.median)}%`);
  }
  if (!prev) changed.push("pierwsza prognoza");
  if (changed.length === 0) return null;

  const now = new Date().toISOString();
  return {
    id: `${FEED_ID}:forecast:${now}`,
    kind: "forecast_revision",
    title: `${CONFIG.place}: rewizja prognozy (${changed.length} dni)`,
    summary: changed.join("; ") + ".",
    published: now,
  };
}

export function warningEntries(prev: Warning[], next: Warning[]): FeedEntry[] {
  const prevIds = new Set(prev.map((w) => w.id));
  const nextIds = new Set(next.map((w) => w.id));
  const out: FeedEntry[] = [];
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);

  for (const w of next) {
    if (prevIds.has(w.id)) continue;
    const tag = w.category === "hydro" ? "IMGW hydro" : "IMGW";
    const lvl = w.level && w.level >= 1 ? ` (stopień ${w.level})` : "";
    out.push({
      id: `${FEED_ID}:warn:${w.id}:new`,
      kind: "warning_new",
      title: `⚠ ${tag}: ${w.event}${lvl}`,
      summary: `${w.content || w.event}. `
        + (w.probability ? `Prawdopodobieństwo ${w.probability}%. ` : "")
        + `Obowiązuje ${w.from ?? "?"} → ${w.to ?? "?"}.`,
      published: now,
    });
  }
  for (const w of prev) {
    if (nextIds.has(w.id)) continue;
    const tag = w.category === "hydro" ? "IMGW hydro" : "IMGW";
    const expired = warningIsExpired(w, nowMs);
    out.push({
      id: `${FEED_ID}:warn:${w.id}:lifted`,
      kind: "warning_lifted",
      title: `✓ ${tag}: ${expired ? "wygasło" : "odwołano"} — ${w.event}`,
      summary: expired
        ? `Upłynął termin ostrzeżenia „${w.event}".`
        : `Ostrzeżenie „${w.event}" nie jest już aktywne.`,
      published: now,
    });
  }
  return out;
}

const AQI_BANDS: { max: number; pl: string }[] = [
  { max: 20, pl: "bardzo dobra" },
  { max: 40, pl: "dobra" },
  { max: 60, pl: "umiarkowana" },
  { max: 80, pl: "zła" },
  { max: 100, pl: "bardzo zła" },
  { max: Infinity, pl: "ekstremalnie zła" },
];
function aqiBandIndex(aqi: number): number {
  return AQI_BANDS.findIndex((b) => aqi <= b.max);
}

export function airQualityChange(prev: AirQuality | null, next: AirQuality | null): FeedEntry | null {
  if (!next || next.europeanAqi === null) return null;
  const nextIdx = aqiBandIndex(next.europeanAqi);
  const prevIdx = prev && prev.europeanAqi !== null ? aqiBandIndex(prev.europeanAqi) : -1;
  if (prevIdx === nextIdx) return null;

  const label = AQI_BANDS[nextIdx]?.pl ?? "—";
  const pollen = next.topPollen
    ? ` Dominujący pyłek: ${POLLEN_PL[next.topPollen.species] ?? next.topPollen.species} (${next.topPollen.grains} ziaren/m³).`
    : " Brak istotnych pyłków.";
  const now = new Date().toISOString();
  return {
    id: `${FEED_ID}:air:${now}`,
    kind: "air_quality_change",
    title: `${CONFIG.place}: jakość powietrza — ${label} (AQI ${Math.round(next.europeanAqi)})`,
    summary: `Europejski indeks AQI ${Math.round(next.europeanAqi)} (${label}). `
      + `PM2.5 ${fmt(next.pm25)} µg/m³, PM10 ${fmt(next.pm10)} µg/m³.${pollen}`,
    published: now,
  };
}

export function renderAtom(
  entries: readonly FeedEntry[],
  title: string,
  origin: string,
  selfPath = "/feed.atom",
  feedId = FEED_ID,
): string {
  const updated = entries[0]?.published ?? new Date().toISOString();
  const items = entries.map((e) => `  <entry>
    <title>${esc(e.title)}</title>
    <id>${esc(e.id)}</id>
    <updated>${e.published}</updated>
    <published>${e.published}</published>
    <category term="${e.kind}"/>
    <content type="text">${esc(e.summary)}</content>
  </entry>`).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(title)}</title>
  <id>${esc(feedId)}</id>
  <updated>${updated}</updated>
  <link rel="self" href="${esc(origin + selfPath)}"/>
  <link rel="alternate" href="${esc(origin + "/")}"/>
  <author><name>travny weather aggregator</name></author>
  <generator>cloudflare-worker</generator>
${items}
</feed>`;
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.round((b - a) * 10) / 10;
}
function crossed(a: number | null, b: number | null, threshold: number): boolean {
  if (a === null || b === null) return false;
  return a < threshold !== b < threshold;
}
function fmt(x: number | null): string {
  return x === null ? "—" : String(Math.round(x * 10) / 10);
}
function signed(x: number): string {
  return x > 0 ? `+${x}` : String(x);
}
function esc(s: string): string {
  return s.replace(/[<>&'\"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" }[c]!));
}
