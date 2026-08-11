/**
 * Calendar overlay merge smoke.
 * Run: npx tsx scripts/smoke-calendar-sync.ts
 */

import { buildDemoCalendar } from "../lib/schedule/demo-data";
import {
  holidaysMapToOverlay,
  mergeCalendarOverlay,
} from "../lib/schedule/calendar-sync";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const base = buildDemoCalendar("2026-03-02", 14);
const overlay = [
  ...holidaysMapToOverlay({ "2026-03-03": "삼일절" }),
  {
    date: "2026-03-05",
    dayType: "BLACKOUT" as const,
    title: "Staff PD",
    isInstructional: false,
  },
];

const merged = mergeCalendarOverlay(base, overlay);
const mar3 = merged.find((d) => d.date === "2026-03-03");
const mar5 = merged.find((d) => d.date === "2026-03-05");

assert(mar3 && !mar3.isInstructional && mar3.title === "삼일절", "holiday overlay failed");
assert(mar5 && !mar5.isInstructional && mar5.dayType === "BLACKOUT", "blackout overlay failed");

console.log(
  `✓ calendar sync smoke OK — merged=${merged.length}, nonInstructional=${
    merged.filter((d) => !d.isInstructional).length
  }`
);
