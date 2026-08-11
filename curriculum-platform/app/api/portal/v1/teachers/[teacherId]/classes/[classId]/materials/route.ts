import { assertPortalAuth } from "@/lib/portal/auth";
import { getStore } from "@/lib/store/runtime-store";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ teacherId: string; classId: string }>;
};

export async function GET(req: NextRequest, { params }: Params) {
  const denied = assertPortalAuth(req);
  if (denied) return denied;

  const { teacherId, classId } = await params;
  const store = getStore();
  store.ensureSequenced("4");

  return Response.json({
    teacherId,
    classId,
    materials: store.getMaterials(teacherId, classId),
  });
}
