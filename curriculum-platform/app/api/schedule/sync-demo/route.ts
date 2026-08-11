import {
  holidaysMapToOverlay,
  type CalendarOverlayDay,
} from "@/lib/schedule/calendar-sync";
import { getScheduleRepository } from "@/lib/schedule/repository";

export const runtime = "nodejs";

/** Demo-only holiday sync for the schedule UI (no portal API key in the browser). */
export async function POST() {
  const overlay: CalendarOverlayDay[] = [
    ...holidaysMapToOverlay({
      "2026-03-03": "Samiljeol (synced)",
      "2026-03-09": "School Foundation Day",
    }),
    {
      date: "2026-03-06",
      dayType: "BLACKOUT",
      title: "Staff PD (synced)",
      isInstructional: false,
      source: "demo-ui",
    },
  ];

  const calendar = await getScheduleRepository().applyCalendarOverlay(overlay, {
    resequence: true,
  });

  return Response.json({
    ok: true,
    overlayCount: overlay.length,
    calendarDays: calendar.length,
    nonInstructional: calendar.filter((d) => !d.isInstructional).length,
  });
}
