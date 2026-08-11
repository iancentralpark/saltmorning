import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, string> = {
    app: "ok",
    curriculumStore: process.env.CURRICULUM_STORE || "seed",
    scheduleStore: process.env.SCHEDULE_STORE || "memory",
  };

  if ((process.env.SCHEDULE_STORE || "memory") === "prisma") {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
  } else {
    checks.database = "skipped";
  }

  const ok = checks.database !== "error";
  return Response.json(
    { ok, checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
