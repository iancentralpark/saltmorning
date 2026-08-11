import { assertPortalAuth, resolvePortalContext } from "@/lib/portal/auth";
import {
  holidaysMapToOverlay,
  type CalendarOverlayDay,
} from "@/lib/schedule/calendar-sync";
import { getScheduleRepository } from "@/lib/schedule/repository";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Sync holidays/blackouts from Salt Morning (or any portal) into CurricuMap.
 *
 * Body:
 * {
 *   days?: [{ date, dayType?, title?, isInstructional? }],
 *   holidays?: { "2026-03-01": "삼일절", ... },
 *   resequence?: boolean  // default true — rebuild skill→slot mapping
 * }
 *
 * Optional header: x-organization-code (required when PORTAL_REQUIRE_ORG=1)
 */
export async function POST(req: NextRequest) {
  const denied = assertPortalAuth(req);
  if (denied) return denied;

  const ctx = resolvePortalContext(req);
  if (ctx instanceof Response) return ctx;

  const body = (await req.json().catch(() => ({}))) as {
    days?: CalendarOverlayDay[];
    holidays?: Record<string, string>;
    blackouts?: Array<{ date: string; title?: string }>;
    resequence?: boolean;
    organizationCode?: string;
  };

  const organizationCode =
    body.organizationCode || ctx.organizationCode || null;

  const overlay: CalendarOverlayDay[] = [
    ...(body.days || []),
    ...holidaysMapToOverlay(body.holidays || {}),
    ...(body.blackouts || []).map((b) => ({
      date: b.date,
      dayType: "BLACKOUT" as const,
      title: b.title || "Blackout",
      isInstructional: false,
      source: "portal-blackout",
    })),
  ];

  if (overlay.length === 0) {
    return Response.json(
      { error: "Provide days, holidays, and/or blackouts" },
      { status: 400 }
    );
  }

  const repo = getScheduleRepository();
  const calendar = await repo.applyCalendarOverlay(overlay, {
    resequence: body.resequence !== false,
  });

  return Response.json({
    ok: true,
    organizationCode,
    overlayCount: overlay.length,
    calendarDays: calendar.length,
    nonInstructional: calendar.filter((d) => !d.isInstructional).length,
  });
}
