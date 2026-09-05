// All location- and policy-specific knobs in one place.

export const CONFIG = {
  place: "Kościelec (Chrzanów)",
  lat: 50.14,
  lon: 19.42,
  tz: "Europe/Warsaw",

  // powiat chrzanowski — IMGW *meteo* warnings are issued per powiat TERYT.
  terytPowiat: "1203",
  // IMGW *hydro* warnings carry no TERYT (scoped by catchment/voivodeship),
  // so they can only be filtered to the voivodeship. Chrzanów = małopolskie.
  wojewodztwo: "małopolskie",

  // Nearest IMGW synop station (~30 km). Shown as reference context only;
  // NOT blended into the point ensemble, since it's a different location.
  imgwStation: "Kraków",

  forecastDays: 7,

  // Pollen species fetched from the Open-Meteo Air Quality API (CAMS European
  // domain). Olive omitted — Mediterranean, irrelevant at this latitude.
  pollenSpecies: ["alder", "birch", "grass", "mugwort", "ragweed"] as const,

  thresholds: {
    currentTempC: 3,
    precipOnsetMm: 0.1,
    forecastTMaxC: 3,
    forecastPrecipProb: 50,
  },

  maxEntries: 60,
  sourceTimeoutMs: 15000,
  sourceRetries: 1,
  retryBaseMs: 300,

  // Covers one missed 2h cycle with margin.
  lastGoodMaxAgeMs: 3 * 60 * 60 * 1000,
  // Health fails after two missed cycles plus margin.
  currentStaleAfterMs: 5 * 60 * 60 * 1000,
} as const;

export const SOURCE_LABEL: Record<string, string> = {
  openmeteo: "Open-Meteo",
  openweather: "OpenWeather",
  visualcrossing: "Visual Crossing",
};

export const POLLEN_PL: Record<string, string> = {
  alder: "olcha", birch: "brzoza", grass: "trawy", mugwort: "bylica", ragweed: "ambrozja",
};
