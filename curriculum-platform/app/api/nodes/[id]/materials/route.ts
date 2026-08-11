import { generateAiMaterial, isMaterialType } from "@/lib/ai/materials";
import { getStore } from "@/lib/store/runtime-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { type?: string };
  const type = body.type || "DAILY_QUIZ";
  if (!isMaterialType(type)) {
    return Response.json(
      { error: `Invalid type. Use one of DAILY_QUIZ, FORMATIVE_TEST, WORKSHEET, EXIT_TICKET, WARM_UP` },
      { status: 400 }
    );
  }

  try {
    const material = await generateAiMaterial(decodeURIComponent(id), type);
    getStore().addMaterial(material);
    return Response.json({ material }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to generate" },
      { status: 404 }
    );
  }
}
