import { formatProgramme, parseXmltvDate, scheduleForChannel } from "../public/xmltv.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseXmltvDate("20260726120000 +0200") === Date.UTC(2026, 6, 26, 10, 0, 0), "positive XMLTV offset mismatch");
assert(parseXmltvDate("20260726120000 -0500") === Date.UTC(2026, 6, 26, 17, 0, 0), "negative XMLTV offset mismatch");
for (const invalid of ["bad", "20261301120000 +0200", "20260230120000 +0200", "20260726250000 +0200", "20260726120000 +2460", "20260726120000 +02"]) {
  assert(parseXmltvDate(invalid) === null, `invalid XMLTV date was accepted: ${invalid}`);
}

const programmes = new Map([["channel.one", [
  { channel: "channel.one", start: 1_000, stop: 2_000, title: "Now" },
  { channel: "channel.one", start: 2_000, stop: 3_000, title: "Next" },
]]]);
const schedule = scheduleForChannel(programmes, "channel.one", 1_500);
assert(schedule.current?.title === "Now", "current programme mismatch");
assert(schedule.next?.title === "Next", "next programme mismatch");
assert(formatProgramme(schedule.current).includes("Now"), "programme formatting mismatch");
assert(scheduleForChannel(programmes, "missing", 1_500).current === null, "missing channel should be empty");

const openProgramme = new Map([["open", [
  { channel: "open", start: 10_000, stop: null, title: "Open" },
]]]);
assert(scheduleForChannel(openProgramme, "open", 10_000 + 60_000).current?.title === "Open", "recent stop-less programme should be current");
assert(scheduleForChannel(openProgramme, "open", 10_000 + 7 * 60 * 60 * 1_000).current === null, "expired stop-less programme stayed current");

console.log("XMLTV checks passed");
