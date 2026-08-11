/**
 * Prisma schedule persistence smoke.
 * Requires: DATABASE_URL, migrate, db:seed
 * Run: SCHEDULE_STORE=prisma CURRICULUM_STORE=prisma npx tsx scripts/smoke-prisma-schedule.ts
 */

import {
  getScheduleRepository,
  resetScheduleRepositorySingleton,
} from "../lib/schedule/repository";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  process.env.CURRICULUM_STORE = "prisma";
  process.env.SCHEDULE_STORE = "prisma";
  resetScheduleRepositorySingleton();

  const repo = getScheduleRepository();
  const lessons = await repo.resetAndSequence("4");
  assert(lessons.length > 0, "expected sequenced lessons in DB");

  const date = lessons[0].scheduledDate;
  const dayLessons = await repo.getScheduledLessons("T001", "C4A", date);
  assert(dayLessons.length > 0, "expected lessons on first date");

  const plans = await repo.generatePlansForDay("T001", "C4A", date);
  assert(plans.length === dayLessons.length, "plan count mismatch");
  assert(plans[0].title.length > 0, "plan title empty");

  // Idempotent second call
  const again = await repo.generatePlansForDay("T001", "C4A", date);
  assert(again[0].id === plans[0].id, "expected persisted plan reuse");

  console.log(
    `✓ prisma schedule smoke OK — ${lessons.length} lessons, ${plans.length} plans on ${date}`
  );
  console.log(`  title: ${plans[0].title}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
