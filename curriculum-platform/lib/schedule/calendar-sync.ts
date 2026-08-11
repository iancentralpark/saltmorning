import type { CalendarDayType, SchoolCalendarDay } from "@/lib/types";

export type CalendarOverlayDay = {
  date: string; // YYYY-MM-DD
  dayType?: CalendarDayType;
  title?: string;
  isInstructional?: boolean;
  /** If true (default for HOLIDAY/BLACKOUT/BREAK), force non-instructional */
  source?: string;
};

/**
 * Merge portal/Salt Morning holiday & blackout overlays onto a base calendar.
 * Overlay wins on matching dates; unknown dates are appended.
 */
export function mergeCalendarOverlay(
  base: SchoolCalendarDay[],
  overlay: CalendarOverlayDay[]
): SchoolCalendarDay[] {
  const byDate = new Map<string, SchoolCalendarDay>();
  for (const d of base) {
    byDate.set(d.date, { ...d });
  }

  for (const o of overlay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue;
    const dayType = o.dayType || "HOLIDAY";
    const isInstructional =
      typeof o.isInstructional === "boolean"
        ? o.isInstructional
        : dayType === "INSTRUCTIONAL" || dayType === "SCHOOL_DAY_OVERRIDE";

    byDate.set(o.date, {
      date: o.date,
      dayType,
      title: o.title || byDate.get(o.date)?.title,
      isInstructional,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Convert Salt Morning holiday map { "2026-03-01": "삼일절" } → overlay days. */
export function holidaysMapToOverlay(
  map: Record<string, string>
): CalendarOverlayDay[] {
  return Object.entries(map).map(([date, title]) => ({
    date,
    dayType: "HOLIDAY" as const,
    title,
    isInstructional: false,
    source: "salt-morning-holidays",
  }));
}
