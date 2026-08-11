import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
} from "@/lib/store/runtime-store";
import { getScheduleRepository } from "@/lib/schedule/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get("teacherId") || DEMO_TEACHER_ID;
  const classId = url.searchParams.get("classId") || DEMO_CLASS_ID;
  const repo = getScheduleRepository();
  const lessons = await repo.ensureSequenced("4");

  return Response.json({
    teacherId,
    classId,
    calendar: await repo.getCalendar(),
    timetable: await repo.getTimetable(teacherId, classId),
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
  const repo = getScheduleRepository();
  const grade = body.gradeLevel || "4";
  const lessons = body.reset
    ? await repo.resetAndSequence(grade)
    : await repo.ensureSequenced(grade);

  return Response.json({
    teacherId: body.teacherId || DEMO_TEACHER_ID,
    classId: body.classId || DEMO_CLASS_ID,
    count: lessons.length,
    scheduledLessons: lessons,
  });
}
