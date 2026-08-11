/**
 * Lightweight sequencer smoke test (no test runner required).
 * Run: npx tsx scripts/smoke-sequencer.ts
 */

import { listSkills } from "../lib/curriculum/seed-loader";
import { buildDemoCalendar, DEMO_SCHEDULE } from "../lib/schedule/demo-data";
import { sequenceSkillsOntoCalendar } from "../lib/schedule/sequencer";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const calendar = buildDemoCalendar("2026-03-02", 28);
const frameworks = [
  ...new Set(DEMO_SCHEDULE.map((s) => s.frameworkCode).filter(Boolean) as string[]),
];
const skillsByFramework = Object.fromEntries(
  frameworks.map((code) => [code, listSkills(code, "4")])
);

const lessons = sequenceSkillsOntoCalendar({
  teacherExternalId: "T001",
  classExternalId: "C4A",
  calendarDays: calendar,
  schedule: DEMO_SCHEDULE,
  skillsByFramework,
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
const ela = lessons.filter((l) => l.frameworkCode === "ccss-ela");
const korean = lessons.filter((l) => l.frameworkCode === "kr2022-korean");
const science = lessons.filter((l) => l.frameworkCode === "ngss-science");
const history = lessons.filter((l) => l.frameworkCode === "kr2022-history");
assert(math.length > 0, "expected CCSS math lessons");
assert(ela.length > 0, "expected CCSS ELA lessons");
assert(korean.length > 0, "expected KR korean lessons");
assert(science.length > 0, "expected NGSS science lessons");
assert(history.length > 0, "expected KR history lessons");

for (let i = 0; i < lessons.length; i++) {
  assert(lessons[i].sequenceIndex === i, "sequenceIndex must be contiguous");
}

console.log(
  `✓ sequencer smoke OK — ${lessons.length} lessons (math=${math.length}, ela=${ela.length}, korean=${korean.length}, science=${science.length}, history=${history.length})`
);
console.log(`  sample math title: ${math[0].skillTitle}`);
console.log(`  sample korean title: ${korean[0].skillTitle}`);
