import {
  holidaysMapToOverlay,
  type CalendarOverlayDay,
} from "@/lib/schedule/calendar-sync";
import { getScheduleRepository } from "@/lib/schedule/repository";
import { assertCronAuth } from "@/lib/portal/auth";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Cron / scheduler entry for calendar overlays.
 *
 * Auth: Bearer or x-cron-secret matching CRON_SECRET.
 *
 * Modes:
 * 1) Body with holidays/blackouts/days → apply locally (same as portal sync)
 * 2) No body + SALT_MORNING_URL → POST Salt Morning internal cron endpoint
 */
export async function POST(req: NextRequest) {
  const denied = assertCronAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    days?: CalendarOverlayDay[];
    holidays?: Record<string, string>;
    blackouts?: Array<{ date: string; title?: string }>;
    resequence?: boolean;
    year?: number;
    months?: number[];
  };

  const hasLocalOverlay =
    (body.days && body.days.length > 0) ||
    (body.holidays && Object.keys(body.holidays).length > 0) ||
    (body.blackouts && body.blackouts.length > 0);

  if (hasLocalOverlay) {
    const overlay: CalendarOverlayDay[] = [
      ...(body.days || []),
      ...holidaysMapToOverlay(body.holidays || {}),
      ...(body.blackouts || []).map((b) => ({
        date: b.date,
        dayType: "BLACKOUT" as const,
        title: b.title || "Blackout",
        isInstructional: false,
        source: "cron-blackout",
      })),
    ];
    const calendar = await getScheduleRepository().applyCalendarOverlay(
      overlay,
      { resequence: body.resequence !== false }
    );
    return Response.json({
      ok: true,
      mode: "local",
      overlayCount: overlay.length,
      calendarDays: calendar.length,
      nonInstructional: calendar.filter((d) => !d.isInstructional).length,
    });
  }

  const smUrl = String(process.env.SALT_MORNING_URL || "").replace(/\/$/, "");
  if (!smUrl) {
    return Response.json(
      {
        error:
          "Provide holidays/blackouts/days, or set SALT_MORNING_URL to pull via Salt Morning cron",
      },
      { status: 400 }
    );
  }

  const cronSecret =
    process.env.SALT_MORNING_CRON_SECRET || process.env.CRON_SECRET;
  const year = body.year || new Date().getFullYear();
  const months =
    body.months ||
    Array.from({ length: 12 }, (_, i) => i + 1);

  const res = await fetch(
    `${smUrl}/api/internal/curriculum-map/sync-calendar-cron`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret || "",
      },
      body: JSON.stringify({
        year,
        months,
        resequence: body.resequence !== false,
        organizationCode: "salt-morning",
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json(
      { error: json.error || "Salt Morning cron failed", detail: json },
      { status: res.status }
    );
  }
  return Response.json({ ok: true, mode: "salt-morning-proxy", ...json });
}
