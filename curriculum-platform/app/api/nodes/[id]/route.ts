import { getCurriculumRepository } from "@/lib/curriculum/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const node = await getCurriculumRepository().getNode(decodeURIComponent(id));
  if (!node) {
    return Response.json({ error: "Node not found" }, { status: 404 });
  }
  const { children: _c, ...rest } = node;
  return Response.json({
    node: {
      ...rest,
      childCount: node.children.length,
    },
  });
}
