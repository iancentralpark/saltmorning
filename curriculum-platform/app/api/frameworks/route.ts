import { listFrameworks } from "@/lib/curriculum/seed-loader";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ frameworks: listFrameworks() });
}
