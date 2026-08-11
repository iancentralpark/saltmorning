import { getCurriculumRepository } from "@/lib/curriculum/repository";

export const runtime = "nodejs";

export async function GET() {
  const repo = getCurriculumRepository();
  return Response.json({ frameworks: await repo.listFrameworks() });
}
