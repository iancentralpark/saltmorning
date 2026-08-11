import { getCurriculumRepository } from "@/lib/curriculum/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { code } = await params;
  const fw = await getCurriculumRepository().getFramework(code);
  if (!fw) {
    return Response.json({ error: "Framework not found" }, { status: 404 });
  }
  return Response.json({
    framework: fw.summary,
    tree: fw.root,
  });
}
