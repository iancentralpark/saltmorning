import type {
  DayOfWeek,
  SchoolCalendarDay,
  TeacherScheduleSlot,
} from "@/lib/types";

const DOW: DayOfWeek[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Build a short demo window: instructional weekdays + a holiday/blackout. */
export function buildDemoCalendar(
  startDate: string,
  dayCount = 28
): SchoolCalendarDay[] {
  const days: SchoolCalendarDay[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = DOW[d.getUTCDay()];

    if (dow === "SAT" || dow === "SUN") {
      days.push({
        date: iso,
        dayType: "BREAK",
        title: "Weekend",
        isInstructional: false,
      });
      continue;
    }

    // Demo holiday mid-window
    if (i === 10) {
      days.push({
        date: iso,
        dayType: "HOLIDAY",
        title: "School Holiday",
        isInstructional: false,
      });
      continue;
    }

    if (i === 17) {
      days.push({
        date: iso,
        dayType: "BLACKOUT",
        title: "Staff PD Day",
        isInstructional: false,
      });
      continue;
    }

    days.push({
      date: iso,
      dayType: "INSTRUCTIONAL",
      isInstructional: true,
    });
  }

  return days;
}

export const DEMO_TEACHER_ID = "T001";
export const DEMO_CLASS_ID = "C4A";

export const DEMO_SCHEDULE: TeacherScheduleSlot[] = [
  {
    id: "sched-mon-1",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "MON",
    period: 1,
    periodLabel: "Period 1",
    startTime: "08:50",
    endTime: "09:35",
    subject: "ELA",
    frameworkCode: "ccss-ela",
  },
  {
    id: "sched-mon-2",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "MON",
    period: 2,
    periodLabel: "Period 2",
    startTime: "09:40",
    endTime: "10:25",
    subject: "Math",
    frameworkCode: "ccss-math",
  },
  {
    id: "sched-wed-2",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "WED",
    period: 2,
    periodLabel: "Period 2",
    startTime: "09:40",
    endTime: "10:25",
    subject: "Math",
    frameworkCode: "ccss-math",
  },
  {
    id: "sched-fri-2",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "FRI",
    period: 2,
    periodLabel: "Period 2",
    startTime: "09:40",
    endTime: "10:25",
    subject: "Math",
    frameworkCode: "ccss-math",
  },
  {
    id: "sched-tue-3",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "TUE",
    period: 3,
    periodLabel: "Period 3",
    startTime: "10:35",
    endTime: "11:20",
    subject: "Korean",
    frameworkCode: "kr2022-korean",
  },
  {
    id: "sched-thu-3",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "THU",
    period: 3,
    periodLabel: "Period 3",
    startTime: "10:35",
    endTime: "11:20",
    subject: "Korean",
    frameworkCode: "kr2022-korean",
  },
  {
    id: "sched-fri-4",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "FRI",
    period: 4,
    periodLabel: "Period 4",
    startTime: "11:30",
    endTime: "12:15",
    subject: "Science",
    frameworkCode: "ngss-science",
  },
  {
    id: "sched-wed-5",
    teacherExternalId: DEMO_TEACHER_ID,
    classExternalId: DEMO_CLASS_ID,
    dayOfWeek: "WED",
    period: 5,
    periodLabel: "Period 5",
    startTime: "13:10",
    endTime: "13:55",
    subject: "Korean History",
    frameworkCode: "kr2022-history",
  },
];
