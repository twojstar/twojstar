// Normalized internal model. Every source is converted to SI-ish units at the
// boundary: temperature °C, wind m/s, pressure hPa (sea-level), precip mm.

export type Condition =
  | "clear" | "clouds" | "fog" | "drizzle"
  | "rain" | "snow" | "storm" | "unknown";

// Point-forecast sources that get blended into the ensemble.
export type SourceId = "openmeteo" | "openweather" | "visualcrossing";

export interface Reading {
  source: SourceId;
  tempC: number | null;
  feelsC: number | null;
  humidity: number | null;
  pressureHpa: number | null;
  windMs: number | null;
  windDir: number | null;
  precipMm: number | null;
  uvIndex: number | null;
  condition: Condition;
  observedAt: string;
}

// Reference-only station reading. It cannot accidentally enter a point ensemble
// because its source is not a SourceId.
export interface StationReading extends Omit<Reading, "source"> {
  source: "imgw";
}

export interface DayForecast {
  source: SourceId;
  date: string;
  tMaxC: number | null;
  tMinC: number | null;
  precipMm: number | null;
  precipProb: number | null;
  uvIndexMax: number | null;
  condition: Condition;
}

export interface Stat {
  median: number | null;
  min: number | null;
  max: number | null;
  n: number;
}

export interface Ensemble {
  observedAt: string;
  tempC: Stat;
  feelsC: Stat;
  humidity: Stat;
  pressureHpa: Stat;
  windMs: Stat;
  precipMm: Stat;
  uv: Stat;
  condition: Condition;
  sources: SourceId[];
}

export interface DayEnsemble {
  date: string;
  tMaxC: Stat;
  tMinC: Stat;
  precipMm: Stat;
  precipProb: Stat;
  uvMax: Stat;
  condition: Condition;
  sources: SourceId[];
}

export interface Warning {
  id: string;
  category: "meteo" | "hydro";
  event: string;
  level: number | null;
  probability: number | null;
  from: string | null;
  to: string | null;
  content: string;
}

export interface PollenReading {
  species: string;
  grains: number;
}
export interface AirQuality {
  observedAt: string;
  europeanAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  pollen: PollenReading[];
  topPollen: PollenReading | null;
}

export type EntryKind =
  | "warning_new" | "warning_lifted"
  | "current_change" | "forecast_revision"
  | "air_quality_change";

export interface FeedEntry {
  id: string;
  kind: EntryKind;
  title: string;
  summary: string;
  published: string;
}

export interface CurrentState {
  ensemble: Ensemble;
  warnings: Warning[];
  airQuality: AirQuality | null;
  imgwStation: StationReading | null;
}
