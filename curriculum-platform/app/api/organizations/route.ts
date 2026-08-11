import { getPrisma } from "@/lib/db";
import { listFrameworks as listSeedFrameworks } from "@/lib/curriculum/seed-loader";

export const runtime = "nodejs";

const KNOWN_ORGS: Record<
  string,
  { name: string; timezone: string }
> = {
  "salt-morning": {
    name: "Salt Morning Academy",
    timezone: "Asia/Seoul",
  },
  "acme-academy": {
    name: "Acme Academy",
    timezone: "America/Los_Angeles",
  },
};

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

  const frameworks = listSeedFrameworks();
  const publicCount = frameworks.filter(
    (f) => f.isPublic !== false && !f.organizationCode
  ).length;

  const orgCodes = new Set<string>();
  for (const f of frameworks) {
    if (f.organizationCode) orgCodes.add(f.organizationCode);
  }
  // Always surface demo schools even if they only consume the public catalog
  orgCodes.add("salt-morning");
  orgCodes.add("acme-academy");

  const organizations = [
    {
      id: "public",
      code: "public",
      name: "Public standards catalog",
      timezone: "UTC",
      frameworkCount: publicCount,
      teacherCount: 0,
    },
    ...[...orgCodes]
      .sort()
      .map((code) => {
        const known = KNOWN_ORGS[code] || {
          name: code,
          timezone: "UTC",
        };
        const owned = frameworks.filter((f) => f.organizationCode === code);
        const visible =
          owned.length +
          frameworks.filter(
            (f) => f.isPublic !== false && !f.organizationCode
          ).length;
        return {
          id: code,
          code,
          name: known.name,
          timezone: known.timezone,
          frameworkCount: visible,
          privateFrameworkCount: owned.filter((f) => f.isPublic === false)
            .length,
          teacherCount: code === "salt-morning" ? 1 : 0,
        };
      }),
  ];

  return Response.json({ organizations });
}
