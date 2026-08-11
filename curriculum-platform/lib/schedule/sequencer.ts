import { listSkills } from "@/lib/curriculum/seed-loader";
import { nodeDisplayTitle } from "@/lib/i18n/content-locale";
import type {
  DayOfWeek,
  ScheduledLesson,
  SchoolCalendarDay,
  TeacherScheduleSlot,
} from "@/lib/types";
import { slugId } from "@/lib/utils";

const DOW: DayOfWeek[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function dayOfWeek(isoDate: string): DayOfWeek {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return DOW[d.getUTCDay()];
}

/**
 * Sequentially place curriculum skill nodes into available class slots
 * on instructional calendar days, matching each slot's frameworkCode.
 */
export function sequenceSkillsOntoCalendar(input: {
  teacherExternalId: string;
  classExternalId: string;
  calendarDays: SchoolCalendarDay[];
  schedule: TeacherScheduleSlot[];
  gradeLevel?: string;
}): ScheduledLesson[] {
  const { teacherExternalId, classExternalId, calendarDays, schedule, gradeLevel } =
    input;

  const slots = schedule.filter(
    (s) =>
      s.teacherExternalId === teacherExternalId &&
      s.classExternalId === classExternalId
  );

  const frameworks = [
    ...new Set(slots.map((s) => s.frameworkCode).filter(Boolean) as string[]),
  ];

  const queues = new Map<string, ReturnType<typeof listSkills>>();
  for (const code of frameworks) {
    queues.set(code, [...listSkills(code, gradeLevel)]);
  }

  const instructional = calendarDays
    .filter((d) => d.isInstructional)
    .sort((a, b) => a.date.localeCompare(b.date));

  const planned: ScheduledLesson[] = [];
  let sequenceIndex = 0;

  for (const day of instructional) {
    const dow = dayOfWeek(day.date);
    const daySlots = slots
      .filter((s) => s.dayOfWeek === dow)
      .sort((a, b) => a.period - b.period);

    for (const slot of daySlots) {
      const fw = slot.frameworkCode;
      if (!fw) continue;
      const queue = queues.get(fw);
      if (!queue || queue.length === 0) continue;

      const skill = queue.shift()!;
      planned.push({
        id: slugId("lesson", teacherExternalId, classExternalId, day.date, slot.period),
        teacherExternalId,
        classExternalId,
        skillNodeId: skill.id,
        skillCode: skill.code,
        skillTitle: nodeDisplayTitle(skill, { frameworkCode: fw }),
        frameworkCode: fw,
        scheduledDate: day.date,
        period: slot.period,
        sequenceIndex: sequenceIndex++,
        status: "PLANNED",
      });
    }
  }

  return planned;
}
