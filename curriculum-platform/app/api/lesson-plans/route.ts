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
  const date = url.searchParams.get("date") || undefined;
  const store = getStore();

  if (date) {
    const plans = await store.generateAllPlansForDay(teacherId, classId, date);
    return Response.json({ teacherId, classId, date, lessonPlans: plans });
  }

  const lessons = store.getLessons(teacherId, classId);
  const plans = [...store.lessonPlans.values()].filter(
    (p) =>
      p.teacherExternalId === teacherId && p.classExternalId === classId
  );

  return Response.json({
    teacherId,
    classId,
    scheduledCount: lessons.length,
    lessonPlans: plans,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    scheduledLessonId?: string;
    teacherId?: string;
    classId?: string;
    date?: string;
  };
  const store = getStore();

  if (body.scheduledLessonId) {
    try {
      const plan = await store.getOrCreateLessonPlan(body.scheduledLessonId);
      return Response.json({ lessonPlan: plan }, { status: 201 });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "Failed" },
        { status: 404 }
      );
    }
  }

  if (body.date) {
    const plans = await store.generateAllPlansForDay(
      body.teacherId || DEMO_TEACHER_ID,
      body.classId || DEMO_CLASS_ID,
      body.date
    );
    return Response.json({ lessonPlans: plans }, { status: 201 });
  }

  return Response.json(
    { error: "Provide scheduledLessonId or date" },
    { status: 400 }
  );
}
