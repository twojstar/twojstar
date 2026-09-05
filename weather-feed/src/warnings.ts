import { CONFIG } from "./config";
import type { WarningFetchResult } from "./sources";
import type { Warning } from "./types";

const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function timeZoneOffsetMs(instantMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CONFIG.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value]),
  );
  const localAsUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return localAsUtc - instantMs;
}

/** Parse IMGW local timestamps without treating Warsaw wall time as UTC. */
export function warningEndTimeMs(value: string | null): number | null {
  if (!value) return null;
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const wallTime = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] ?? 0),
  );
  let instant = wallTime - timeZoneOffsetMs(wallTime);
  instant = wallTime - timeZoneOffsetMs(instant);
  return instant;
}

export function warningIsExpired(
  warning: Warning,
  nowMs = Date.now(),
): boolean {
  const endMs = warningEndTimeMs(warning.to);
  return endMs !== null && endMs <= nowMs;
}

/**
 * Replace only categories confirmed by IMGW during this cycle. A failed meteo
 * or hydro request keeps its previous warning only while it is still active.
 * Records without a usable end time remain preserved until IMGW answers again.
 */
export function reconcileWarnings(
  previous: readonly Warning[],
  result: WarningFetchResult,
  nowMs = Date.now(),
): Warning[] {
  const succeeded = new Set(result.succeeded);
  const preserved = previous.filter((warning) =>
    !succeeded.has(warning.category) && !warningIsExpired(warning, nowMs));
  return [...result.warnings, ...preserved];
}
