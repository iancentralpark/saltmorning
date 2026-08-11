import { assertPortalAuth } from "@/lib/portal/auth";
import { getScheduleRepository } from "@/lib/schedule/repository";
import { getStore } from "@/lib/store/runtime-store";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ teacherId: string; classId: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const denied = assertPortalAuth(req);
  if (denied) return denied;

  const { teacherId, classId } = await params;
  const date = req.nextUrl.searchParams.get("date") || undefined;
  const generate = req.nextUrl.searchParams.get("generate") === "1";
  const repo = getScheduleRepository();

  await repo.ensureSequenced("4");
  const lessons = await repo.getScheduledLessons(teacherId, classId, date);
  const store = getStore();

  const withPlans = await Promise.all(
    lessons.map(async (lesson) => {
      let lessonPlan = store.lessonPlans.get(lesson.id) || null;
      if (generate && !lessonPlan) {
        lessonPlan = await repo.getOrCreateLessonPlan(lesson.id);
      }
      return { ...lesson, lessonPlan };
    })
  );

  return Response.json({
    teacherId,
    classId,
    date: date ?? null,
    count: withPlans.length,
    lessons: withPlans,
  });
}
