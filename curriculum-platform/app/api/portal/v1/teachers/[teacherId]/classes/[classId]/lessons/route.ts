import { assertPortalAuth } from "@/lib/portal/auth";
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
  const store = getStore();

  const lessons = store.getLessons(teacherId, classId, date);

  const withPlans = await Promise.all(
    lessons.map(async (lesson) => {
      let plan = store.lessonPlans.get(lesson.id) || null;
      if (generate && !plan) {
        plan = await store.getOrCreateLessonPlan(lesson.id);
      }
      return { ...lesson, lessonPlan: plan };
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
