import { CONFIG } from "./config";
import { renderPage } from "./page";
import { buildDayEnsembles, buildEnsemble } from "./ensemble";
import {
  airQualityChange, currentChange, FEED_ID, forecastRevision, renderAtom, warningEntries,
} from "./feed";
import {
  type Env, fetchImgwStation, fetchImgwWarnings, fetchOpenMeteo,
  fetchOpenMeteoAirQuality, fetchOpenWeather, fetchVisualCrossing,
} from "./sources";
import type {
  AirQuality, CurrentState, DayEnsemble, Ensemble, FeedEntry, Reading, SourceId, Warning,
} from "./types";
import { reconcileWarnings } from "./warnings";

const SITE_ORIGIN = "https://weather.trfny.com";
const SITE_HOST = new URL(SITE_ORIGIN).hostname;
const WORKERS_HOST = "weather.travny.workers.dev";

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
const SITEMAP = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_ORIGIN}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE_ORIGIN}/feed.atom</loc><changefreq>hourly</changefreq></url>
  <url><loc>${SITE_ORIGIN}/warnings.atom</loc><changefreq>hourly</changefreq></url>
</urlset>
`;
const INDEX_MD = `# Pogoda Chrzanów · Kościelec

> Multi-source local weather dashboard for Kościelec in Chrzanów, Poland.

The dashboard combines several weather sources instead of presenting a single-provider forecast. It publishes current conditions, forecast ensembles, air quality, pollen observations and IMGW warnings.

## Machine-readable resources

- [Current state JSON](${SITE_ORIGIN}/state.json)
- [Weather changes Atom feed](${SITE_ORIGIN}/feed.atom)
- [IMGW warnings Atom feed](${SITE_ORIGIN}/warnings.atom)
- [Concise LLM guide](${SITE_ORIGIN}/llms.txt)
- [Full LLM guide](${SITE_ORIGIN}/llms-full.txt)
- [TRAVNY hub](https://trfny.com/)
`;

const LLMS = `# Pogoda Chrzanów · Kościelec

> Multi-source local weather dashboard with air quality, pollen and IMGW warnings.

## Resources

- [Dashboard](${SITE_ORIGIN}/index.md): Markdown description of the local weather dashboard.
- [Current state JSON](${SITE_ORIGIN}/state.json): machine-readable current ensemble.
- [Weather changes feed](${SITE_ORIGIN}/feed.atom): Atom feed of meaningful changes.
- [IMGW warnings feed](${SITE_ORIGIN}/warnings.atom): warning-only Atom feed.
- [Full LLM guide](${SITE_ORIGIN}/llms-full.txt): complete weather-service guide in one file.
- [TRAVNY hub](https://trfny.com/): related tools and services.
`;

const LLMS_FULL = `# Pogoda Chrzanów · Kościelec full documentation

Source: ${SITE_ORIGIN}/

Description: Complete LLM-oriented guide to the TRAVNY multi-source weather service for Kościelec in Chrzanów, Poland.

## Dashboard

The service combines Open-Meteo, OpenWeather, Visual Crossing and IMGW data where available. The dashboard presents an ensemble rather than pretending one provider is authoritative. It includes current temperature, feels-like temperature, humidity, wind, conditions, air quality, pollen and active IMGW warnings.

## Public data

- [Current state JSON](${SITE_ORIGIN}/state.json): current machine-readable ensemble.
- [Weather changes Atom feed](${SITE_ORIGIN}/feed.atom): meaningful condition and forecast changes.
- [IMGW warnings Atom feed](${SITE_ORIGIN}/warnings.atom): active warning changes.
- [Markdown dashboard page](${SITE_ORIGIN}/index.md): concise page description.

## Freshness

Current observations are refreshed on the Worker schedule and health status tracks staleness. Consumers should prefer timestamps published in JSON/feed payloads over assuming a successful HTTP response is fresh.

## Related

- [TRAVNY hub](https://trfny.com/)
- [Source](https://github.com/trvny/trvny/tree/main/weather-feed)
`;

const K = {
  entries: "entries",
  baselineCurrent: "baseline:current",
  baselineForecast: "baseline:forecast",
  baselineAir: "baseline:air",
  warnings: "warnings:active",
  current: "state:current",
  lastGood: "lastgood:current",
  statusCurrent: "status:current",
  statusForecast: "status:forecast",
} as const;

const POINT_SOURCES: readonly SourceId[] = ["openmeteo", "openweather", "visualcrossing"];
type LastGood = Partial<Record<SourceId, { reading: Reading; storedAt: number }>>;
interface CycleStatus {
  ok: boolean;
  completedAt: string;
  sources?: SourceId[];
  warningsFresh?: ("meteo" | "hydro")[];
  message?: string;
}

async function load<T>(env: Env, key: string): Promise<T | null> {
  return env.WEATHER_KV.get(key, "json") as Promise<T | null>;
}

function log(level: "info" | "warn" | "error", fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level, ...fields }));
}

async function pushEntries(env: Env, fresh: FeedEntry[]): Promise<void> {
  if (fresh.length === 0) return;
  const existing = (await load<FeedEntry[]>(env, K.entries)) ?? [];
  const merged = [...fresh, ...existing].slice(0, CONFIG.maxEntries);
  await env.WEATHER_KV.put(K.entries, JSON.stringify(merged));
  log("info", { msg: "entries appended", added: fresh.length, total: merged.length });
}

async function runCurrent(env: Env): Promise<void> {
  const [om, ow, vc, air, warningFetch, station] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
    fetchOpenMeteoAirQuality().catch(asNull("airquality")),
    fetchImgwWarnings().catch(asNull("imgw-warnings")),
    fetchImgwStation(CONFIG.imgwStation).catch(asNull("imgw-station")),
  ]);

  const liveReadings = [om?.current, ow?.current, vc?.current]
    .filter((r): r is Reading => r != null);

  const now = Date.now();
  const cache = (await load<LastGood>(env, K.lastGood)) ?? {};
  const readings: Reading[] = [...liveReadings];
  for (const id of POINT_SOURCES) {
    if (readings.some((r) => r.source === id)) continue;
    const hit = cache[id];
    if (hit && now - hit.storedAt <= CONFIG.lastGoodMaxAgeMs) {
      readings.push(hit.reading);
      log("info", { msg: "source from cache", source: id, ageMs: now - hit.storedAt });
    }
  }
  if (liveReadings.length > 0) {
    const next: LastGood = { ...cache };
    for (const r of liveReadings) next[r.source] = { reading: r, storedAt: now };
    await env.WEATHER_KV.put(K.lastGood, JSON.stringify(next));
  }
  log("info", { msg: "current sources", n: readings.length, sources: readings.map((r) => r.source) });

  const fresh: FeedEntry[] = [];
  let ensemble: Ensemble | null = null;

  if (readings.length > 0) {
    ensemble = buildEnsemble(readings);
    const prev = await load<Ensemble>(env, K.baselineCurrent);
    const entry = currentChange(prev, ensemble);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineCurrent, JSON.stringify(ensemble));
    }
  }

  if (air) {
    const prevAir = await load<AirQuality>(env, K.baselineAir);
    const entry = airQualityChange(prevAir, air);
    if (entry) {
      fresh.push(entry);
      await env.WEATHER_KV.put(K.baselineAir, JSON.stringify(air));
    }
  }

  const prevWarnings = (await load<Warning[]>(env, K.warnings)) ?? [];
  let warnings = prevWarnings;
  if (warningFetch && warningFetch.succeeded.length > 0) {
    warnings = reconcileWarnings(prevWarnings, warningFetch);
    fresh.push(...warningEntries(prevWarnings, warnings));
    await env.WEATHER_KV.put(K.warnings, JSON.stringify(warnings));
  } else {
    log("warn", { msg: "IMGW warnings unavailable; preserving previous state" });
  }

  const prevState = await load<CurrentState>(env, K.current);
  if (ensemble) {
    const state: CurrentState = {
      ensemble,
      warnings,
      airQuality: air ?? prevState?.airQuality ?? null,
      imgwStation: station ?? prevState?.imgwStation ?? null,
    };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  } else if (prevState) {
    const state: CurrentState = {
      ...prevState,
      warnings,
      airQuality: air ?? prevState.airQuality,
      imgwStation: station ?? prevState.imgwStation,
    };
    await env.WEATHER_KV.put(K.current, JSON.stringify(state));
  }

  await pushEntries(env, fresh);
  const status: CycleStatus = {
    ok: liveReadings.length > 0,
    completedAt: new Date().toISOString(),
    sources: liveReadings.map((reading) => reading.source),
    warningsFresh: warningFetch?.succeeded ?? [],
  };
  await env.WEATHER_KV.put(K.statusCurrent, JSON.stringify(status));
}

async function runForecast(env: Env): Promise<void> {
  const [om, ow, vc] = await Promise.all([
    fetchOpenMeteo().catch(asNull("openmeteo")),
    fetchOpenWeather(env).catch(asNull("openweather")),
    fetchVisualCrossing(env).catch(asNull("visualcrossing")),
  ]);

  const perSource = [om?.days ?? [], ow?.days ?? [], vc?.days ?? []].filter((d) => d.length > 0);
  if (perSource.length === 0) {
    log("warn", { msg: "no forecast sources" });
    const status: CycleStatus = { ok: false, completedAt: new Date().toISOString(), message: "no forecast sources" };
    await env.WEATHER_KV.put(K.statusForecast, JSON.stringify(status));
    return;
  }

  const next = buildDayEnsembles(perSource);
  const prev = await load<DayEnsemble[]>(env, K.baselineForecast);
  const entry = forecastRevision(prev, next);
  if (entry) {
    await env.WEATHER_KV.put(K.baselineForecast, JSON.stringify(next));
    await pushEntries(env, [entry]);
  }
  const sources = [om, ow, vc]
    .flatMap((result) => result?.days[0]?.source ? [result.days[0].source] : []);
  const status: CycleStatus = { ok: true, completedAt: new Date().toISOString(), sources };
  await env.WEATHER_KV.put(K.statusForecast, JSON.stringify(status));
}

function asNull(source: string) {
  return (e: unknown) => {
    log("warn", { msg: "source failed", source, error: e instanceof Error ? e.message : String(e) });
    return null;
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname, origin } = url;
    if (pathname === "/index.html" || (url.hostname === WORKERS_HOST && pathname === "/")) {
      if (url.hostname === WORKERS_HOST) url.hostname = SITE_HOST;
      url.protocol = "https:";
      url.pathname = "/";
      return Response.redirect(url.toString(), 301);
    }

    const discovery = discoveryResponse(pathname);
    if (discovery) return discovery;

    const entries = (await load<FeedEntry[]>(env, K.entries)) ?? [];

    switch (pathname) {
      case "/feed.atom":
        return atom(renderAtom(entries, `Pogoda — ${CONFIG.place}`, origin, "/feed.atom", FEED_ID));
      case "/warnings.atom":
        return atom(renderAtom(
          entries.filter((e) => e.kind === "warning_new" || e.kind === "warning_lifted"),
          `Ostrzeżenia IMGW — ${CONFIG.place}`,
          origin,
          "/warnings.atom",
          `${FEED_ID}:warnings`,
        ));
      case "/state.json": {
        const state = await load<CurrentState>(env, K.current);
        return json({ place: CONFIG.place, ...state, entryCount: entries.length });
      }
      case "/healthz": {
        const [current, forecast] = await Promise.all([
          load<CycleStatus>(env, K.statusCurrent),
          load<CycleStatus>(env, K.statusForecast),
        ]);
        const currentAgeMs = current ? Date.now() - Date.parse(current.completedAt) : null;
        const healthy = Boolean(current?.ok && currentAgeMs !== null && currentAgeMs <= CONFIG.currentStaleAfterMs);
        return json({ ok: healthy, entries: entries.length, current, forecast, currentAgeMs }, healthy ? 200 : 503);
      }
      case "/": {
        const state = await load<CurrentState>(env, K.current);
        return new Response(renderPage(SITE_ORIGIN, state, entries), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300, stale-while-revalidate=600",
            "link": '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"',
          },
        });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const job = event.cron === "0 5 * * *" ? runForecast(env) : runCurrent(env);
    ctx.waitUntil(job.catch((e) => log("error", { msg: "cron failed", cron: event.cron, error: String(e) })));
  },
};

function discoveryResponse(pathname: string): Response | undefined {
  switch (pathname) {
    case "/robots.txt":
      return cachedResponse(ROBOTS, "text/plain; charset=utf-8", 86400);
    case "/sitemap.xml":
      return cachedResponse(SITEMAP, "application/xml; charset=utf-8", 86400);
    case "/index.md":
      return cachedResponse(INDEX_MD, "text/markdown; charset=utf-8", 3600);
    case "/llms.txt":
      return cachedResponse(LLMS, "text/plain; charset=utf-8", 3600);
    case "/llms-full.txt":
      return cachedResponse(LLMS_FULL, "text/plain; charset=utf-8", 3600);
  }
}

function cachedResponse(body: string, contentType: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": `max-age=${maxAge}`,
    },
  });
}

function atom(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "max-age=600",
      "access-control-allow-origin": "*",
    },
  });
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
