import { getCurriculumRepository } from "@/lib/curriculum/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org");
  const repo = getCurriculumRepository();
  let frameworks = await repo.listFrameworks();

  if (org && org !== "all") {
    frameworks = frameworks.filter((f) => {
      const isPublicCatalog =
        f.isPublic !== false && !f.organizationCode;
      if (org === "public") return isPublicCatalog;
      // org-specific view: public catalog + that org's packs (incl. private)
      return isPublicCatalog || f.organizationCode === org;
    });
  }

  return Response.json({ frameworks, org: org || null });
}
