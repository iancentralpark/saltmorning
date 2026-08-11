import { getPrisma } from "@/lib/db";
import { listFrameworks as listSeedFrameworks } from "@/lib/curriculum/seed-loader";

export const runtime = "nodejs";

export async function GET() {
  const mode = process.env.CURRICULUM_STORE || "seed";

  if (mode === "prisma") {
    try {
      const orgs = await getPrisma().organization.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          timezone: true,
          _count: { select: { frameworks: true, teachers: true } },
        },
      });
      return Response.json({
        organizations: orgs.map((o) => ({
          id: o.id,
          code: o.code,
          name: o.name,
          timezone: o.timezone,
          frameworkCount: o._count.frameworks,
          teacherCount: o._count.teachers,
        })),
      });
    } catch {
      // fall through
    }
  }

  // Seed-mode / fallback: synthetic public catalog
  const frameworks = listSeedFrameworks();
  return Response.json({
    organizations: [
      {
        id: "public",
        code: "public",
        name: "Public standards catalog",
        timezone: "UTC",
        frameworkCount: frameworks.length,
        teacherCount: 0,
      },
      {
        id: "salt-morning",
        code: "salt-morning",
        name: "Salt Morning Academy",
        timezone: "Asia/Seoul",
        frameworkCount: frameworks.length,
        teacherCount: 1,
      },
    ],
  });
}
