import { getFramework } from "@/lib/curriculum/seed-loader";

export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { code } = await params;
  const fw = getFramework(code);
  if (!fw) {
    return Response.json({ error: "Framework not found" }, { status: 404 });
  }
  return Response.json({
    framework: fw.summary,
    tree: fw.root,
  });
}
