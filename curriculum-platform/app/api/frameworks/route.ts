import { getCurriculumRepository } from "@/lib/curriculum/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  const repo = getCurriculumRepository();
  let frameworks = await repo.listFrameworks();

  if (org && org !== "all") {
    frameworks = frameworks.filter((f) => {
      if (org === "public") return f.isPublic !== false && !f.organizationCode;
      // org-specific view: public catalog + that org's packs
      return (
        f.isPublic !== false ||
        f.organizationCode === org ||
        !f.organizationCode
      );
    });
  }

  return Response.json({ frameworks, org: org || null });
}
