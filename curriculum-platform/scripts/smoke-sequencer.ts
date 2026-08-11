/**
 * Lightweight sequencer smoke test (no test runner required).
 * Run: npx tsx scripts/smoke-sequencer.ts
 */

import { buildDemoCalendar, DEMO_SCHEDULE } from "../lib/schedule/demo-data";
import { sequenceSkillsOntoCalendar } from "../lib/schedule/sequencer";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const calendar = buildDemoCalendar("2026-03-02", 28);
const lessons = sequenceSkillsOntoCalendar({
  teacherExternalId: "T001",
  classExternalId: "C4A",
  calendarDays: calendar,
  schedule: DEMO_SCHEDULE,
  gradeLevel: "4",
});

assert(lessons.length > 0, "expected scheduled lessons");

const nonInstructional = new Set(
  calendar.filter((d) => !d.isInstructional).map((d) => d.date)
);
for (const l of lessons) {
  assert(
    !nonInstructional.has(l.scheduledDate),
    `lesson on non-instructional day ${l.scheduledDate}`
  );
}

const math = lessons.filter((l) => l.frameworkCode === "ccss-math");
const korean = lessons.filter((l) => l.frameworkCode === "kr2022-korean");
const science = lessons.filter((l) => l.frameworkCode === "ngss-science");
const history = lessons.filter((l) => l.frameworkCode === "kr2022-history");
assert(math.length > 0, "expected CCSS math lessons");
assert(korean.length > 0, "expected KR korean lessons");
assert(science.length > 0, "expected NGSS science lessons");
assert(history.length > 0, "expected KR history lessons");

// Sequence indexes are contiguous
for (let i = 0; i < lessons.length; i++) {
  assert(lessons[i].sequenceIndex === i, "sequenceIndex must be contiguous");
}

console.log(
  `✓ sequencer smoke OK — ${lessons.length} lessons (math=${math.length}, korean=${korean.length}, science=${science.length}, history=${history.length})`
);
