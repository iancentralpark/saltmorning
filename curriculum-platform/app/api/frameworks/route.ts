import { getCurriculumRepository } from "@/lib/curriculum/repository";
import { filterFrameworksForSession, getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  const session = await getSession();
  const repo = getCurriculumRepository();
  let frameworks = await repo.listFrameworks();

  frameworks = filterFrameworksForSession(frameworks, session, org);

  return Response.json({
    frameworks,
    org: org || null,
    sessionOrg: session?.orgCode || null,
    sessionRole: session?.role || null,
  });
}
