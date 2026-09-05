import type {
  Condition, DayEnsemble, DayForecast, Ensemble, Reading, SourceId, Stat,
} from "./types";

const SEVERITY: Record<Condition, number> = {
  storm: 7, snow: 6, rain: 5, drizzle: 4, fog: 3, clouds: 2, clear: 1, unknown: 0,
};

function stat(values: readonly (number | null)[]): Stat {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { median: null, min: null, max: null, n: 0 };
  const mid = Math.floor(n / 2);
  const median = n % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return { median: round(median), min: xs[0]!, max: xs[n - 1]!, n };
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

function majority(conds: readonly Condition[]): Condition {
  const counts = new Map<Condition, number>();
  for (const c of conds) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: Condition = "unknown";
  let bestCount = -1;
  for (const [c, k] of counts) {
    if (k > bestCount || (k === bestCount && SEVERITY[c] > SEVERITY[best])) {
      best = c;
      bestCount = k;
    }
  }
  return best;
}

function oldestObservation(readings: readonly Reading[]): string {
  const dated = readings
    .map((reading) => ({ value: reading.observedAt, time: Date.parse(reading.observedAt) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time);
  return dated[0]?.value ?? new Date().toISOString();
}

export function buildEnsemble(readings: readonly Reading[]): Ensemble {
  const sources = readings.map((r) => r.source);
  return {
    // Conservative timestamp: the age of the oldest contributing source. A
    // cached fallback therefore cannot make the ensemble look freshly observed.
    observedAt: oldestObservation(readings),
    tempC: stat(readings.map((r) => r.tempC)),
    feelsC: stat(readings.map((r) => r.feelsC)),
    humidity: stat(readings.map((r) => r.humidity)),
    pressureHpa: stat(readings.map((r) => r.pressureHpa)),
    windMs: stat(readings.map((r) => r.windMs)),
    precipMm: stat(readings.map((r) => r.precipMm)),
    uv: stat(readings.map((r) => r.uvIndex)),
    condition: majority(readings.map((r) => r.condition)),
    sources,
  };
}

export function buildDayEnsembles(perSource: readonly DayForecast[][]): DayEnsemble[] {
  const byDate = new Map<string, DayForecast[]>();
  for (const list of perSource) {
    for (const d of list) {
      const arr = byDate.get(d.date) ?? [];
      arr.push(d);
      byDate.set(d.date, arr);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, days]) => ({
      date,
      tMaxC: stat(days.map((d) => d.tMaxC)),
      tMinC: stat(days.map((d) => d.tMinC)),
      precipMm: stat(days.map((d) => d.precipMm)),
      precipProb: stat(days.map((d) => d.precipProb)),
      uvMax: stat(days.map((d) => d.uvIndexMax)),
      condition: majority(days.map((d) => d.condition)),
      sources: [...new Set(days.map((d) => d.source))] as SourceId[],
    }));
}

export const CONDITION_PL: Record<Condition, string> = {
  clear: "bezchmurnie", clouds: "zachmurzenie", fog: "mgła", drizzle: "mżawka",
  rain: "deszcz", snow: "śnieg", storm: "burza", unknown: "—",
};
