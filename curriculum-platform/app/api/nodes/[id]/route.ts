import { getNode } from "@/lib/curriculum/seed-loader";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const node = getNode(decodeURIComponent(id));
  if (!node) {
    return Response.json({ error: "Node not found" }, { status: 404 });
  }
  // Return without deep children for drawer payload
  const { children: _c, ...rest } = node;
  return Response.json({
    node: {
      ...rest,
      childCount: node.children.length,
    },
  });
}
