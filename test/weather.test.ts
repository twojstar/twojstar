import assert from "node:assert/strict";
import test from "node:test";
import { FEED_ID, renderAtom, warningEntries } from "../src/feed";
import worker from "../src/index";
import { renderPage } from "../src/page";
import type { Warning } from "../src/types";
import {
  reconcileWarnings, warningEndTimeMs,
} from "../src/warnings";

const meteo: Warning = {
  id: "meteo:1", category: "meteo", event: "Burze", level: 2,
  probability: 80, from: "2026-07-22T12:00:00",
  to: "2026-07-22T18:00:00", content: "Burze z gradem",
};
const hydro: Warning = {
  id: "hydro:1", category: "hydro",
  event: "Gwałtowne wzrosty stanów wody", level: 1,
  probability: null, from: null, to: null, content: "Możliwe wzrosty",
};
const beforeExpiry = Date.parse("2026-07-22T15:00:00Z");

test("failed IMGW category preserves its previous warnings", () => {
  const next = reconcileWarnings(
    [meteo, hydro],
    { warnings: [], succeeded: ["meteo"] },
    beforeExpiry,
  );
  assert.deepEqual(next, [hydro]);
  const entries = warningEntries([meteo, hydro], next);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "warning_lifted");
  assert.match(entries[0]?.title ?? "", /Burze/);
  assert.doesNotMatch(entries[0]?.title ?? "", /wzrosty/);
});

test("total IMGW outage preserves warnings before their end time", () => {
  const next = reconcileWarnings(
    [meteo, hydro],
    { warnings: [], succeeded: [] },
    beforeExpiry,
  );
  assert.deepEqual(next, [meteo, hydro]);
  assert.deepEqual(warningEntries([meteo, hydro], next), []);
});

test("expired warning is dropped even while IMGW is unavailable", () => {
  const afterExpiry = Date.parse("2026-07-22T16:01:00Z");
  const next = reconcileWarnings(
    [meteo, hydro],
    { warnings: [], succeeded: [] },
    afterExpiry,
  );
  assert.deepEqual(next, [hydro]);
});

test("IMGW wall time is interpreted in Europe/Warsaw", () => {
  assert.equal(
    warningEndTimeMs("2026-07-22 18:00:00"),
    Date.parse("2026-07-22T16:00:00Z"),
  );
});

test("expired warning entry says it expired rather than was cancelled", () => {
  const expired = { ...meteo, to: "2000-01-01T12:00:00Z" };
  const [entry] = warningEntries([expired], []);
  assert.match(entry?.title ?? "", /wygasło/);
  assert.doesNotMatch(entry?.title ?? "", /odwołano/);
});

test("warnings feed has its own id and self URL", () => {
  const xml = renderAtom(
    [], "Warnings", "https://weather.example",
    "/warnings.atom", `${FEED_ID}:warnings`,
  );
  assert.match(
    xml,
    /<id>tag:travny,2026:weather:koscielec:warnings<\/id>/,
  );
  assert.match(
    xml,
    /rel="self" href="https:\/\/weather\.example\/warnings\.atom"/,
  );
  assert.doesNotMatch(
    xml,
    /rel="self" href="https:\/\/weather\.example\/feed\.atom"/,
  );
});

test("weather page advertises its canonical and llms surface", () => {
  const html = renderPage("https://weather.trfny.com");
  assert.match(html, /rel="canonical" href="https:\/\/weather\.trfny\.com\/"/);
  assert.match(html, /rel="alternate" type="text\/markdown" href="\/index\.md"/);
  assert.match(html, /rel="describedby" href="\/llms\.txt"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /href="https:\/\/trfny\.com\/"/);
});

test("weather discovery routes do not require storage", async () => {
  const expected = {
    "/robots.txt": "https://weather.trfny.com/sitemap.xml",
    "/sitemap.xml": "https://weather.trfny.com/feed.atom",
    "/index.md": "https://weather.trfny.com/state.json",
    "/llms.txt": "https://weather.trfny.com/index.md",
    "/llms-full.txt": "https://weather.trfny.com/state.json",
  };

  for (const [path, canonicalUrl] of Object.entries(expected)) {
    const response = await worker.fetch(
      new Request(`https://weather.trfny.com${path}`),
      {} as Env,
    );
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(canonicalUrl));
  }
});
