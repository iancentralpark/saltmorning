import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
  getStore,
} from "@/lib/store/runtime-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get("teacherId") || DEMO_TEACHER_ID;
  const classId = url.searchParams.get("classId") || DEMO_CLASS_ID;
  const store = getStore();
  const lessons = store.ensureSequenced("4");

  return Response.json({
    teacherId,
    classId,
    calendar: store.calendar,
    timetable: store.schedule.filter(
      (s) =>
        s.teacherExternalId === teacherId && s.classExternalId === classId
    ),
    scheduledLessons: lessons.filter(
      (l) =>
        l.teacherExternalId === teacherId && l.classExternalId === classId
    ),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    teacherId?: string;
    classId?: string;
    gradeLevel?: string;
    reset?: boolean;
  };
  const store = getStore();
  if (body.reset) {
    store.scheduledLessons = [];
    store.lessonPlans.clear();
  }
  const lessons = store.ensureSequenced(body.gradeLevel || "4");
  return Response.json({
    teacherId: body.teacherId || DEMO_TEACHER_ID,
    classId: body.classId || DEMO_CLASS_ID,
    count: lessons.length,
    scheduledLessons: lessons,
  });
}
