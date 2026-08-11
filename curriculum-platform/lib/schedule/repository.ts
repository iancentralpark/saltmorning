/**
 * Schedule / lesson-plan persistence port.
 * memory = process store; prisma = Postgres (requires migrate + seed).
 */

import type {
  LessonPlan,
  ScheduledLesson,
  SchoolCalendarDay,
  TeacherScheduleSlot,
  CurriculumNode,
} from "@/lib/types";
import { getStore } from "@/lib/store/runtime-store";
import { getPrisma } from "@/lib/db";
import { nodeDisplayTitle } from "@/lib/i18n/content-locale";
import { sequenceSkillsOntoCalendar } from "@/lib/schedule/sequencer";
import { getCurriculumRepository } from "@/lib/curriculum/repository";
import { generateLessonPlan } from "@/lib/ai/lesson-plan";
import {
  DEMO_CLASS_ID,
  DEMO_TEACHER_ID,
} from "@/lib/schedule/demo-data";
import {
  mergeCalendarOverlay,
  type CalendarOverlayDay,
} from "@/lib/schedule/calendar-sync";

export interface ScheduleRepository {
  getCalendar(): Promise<SchoolCalendarDay[]>;
  getTimetable(
    teacherExternalId: string,
    classExternalId: string
  ): Promise<TeacherScheduleSlot[]>;
  getScheduledLessons(
    teacherExternalId: string,
    classExternalId: string,
    date?: string
  ): Promise<ScheduledLesson[]>;
  ensureSequenced(gradeLevel?: string): Promise<ScheduledLesson[]>;
  resetAndSequence(gradeLevel?: string): Promise<ScheduledLesson[]>;
  getOrCreateLessonPlan(scheduledLessonId: string): Promise<LessonPlan>;
  generatePlansForDay(
    teacherExternalId: string,
    classExternalId: string,
    date: string
  ): Promise<LessonPlan[]>;
  applyCalendarOverlay(
    overlay: CalendarOverlayDay[],
    options?: { resequence?: boolean }
  ): Promise<SchoolCalendarDay[]>;
}

class MemoryScheduleRepository implements ScheduleRepository {
  async getCalendar() {
    return getStore().calendar;
  }
  async getTimetable(teacherExternalId: string, classExternalId: string) {
    return getStore().schedule.filter(
      (s) =>
        s.teacherExternalId === teacherExternalId &&
        s.classExternalId === classExternalId
    );
  }
  async getScheduledLessons(
    teacherExternalId: string,
    classExternalId: string,
    date?: string
  ) {
    await getStore().ensureSequenced();
    return getStore().getLessons(teacherExternalId, classExternalId, date);
  }
  async ensureSequenced(gradeLevel = "4") {
    return getStore().ensureSequenced(gradeLevel);
  }
  async resetAndSequence(gradeLevel = "4") {
    const store = getStore();
    store.scheduledLessons = [];
    store.lessonPlans.clear();
    return store.ensureSequenced(gradeLevel);
  }
  async getOrCreateLessonPlan(scheduledLessonId: string) {
    return getStore().getOrCreateLessonPlan(scheduledLessonId);
  }
  async generatePlansForDay(
    teacherExternalId: string,
    classExternalId: string,
    date: string
  ) {
    return getStore().generateAllPlansForDay(
      teacherExternalId,
      classExternalId,
      date
    );
  }

  async applyCalendarOverlay(
    overlay: CalendarOverlayDay[],
    options?: { resequence?: boolean }
  ) {
    const resequence = options?.resequence !== false;
    return getStore().applyCalendarOverlay(overlay, resequence);
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class PrismaScheduleRepository implements ScheduleRepository {
  private async resolvePeople(teacherExternalId: string, classExternalId: string) {
    const prisma = getPrisma();
    const teacher = await prisma.teacher.findFirst({
      where: { externalId: teacherExternalId },
    });
    const klass = await prisma.class.findFirst({
      where: { externalId: classExternalId },
    });
    if (!teacher || !klass) {
      throw new Error(
        `Teacher/class not found for ${teacherExternalId}/${classExternalId} — run db:seed`
      );
    }
    return { prisma, teacher, klass };
  }

  async getCalendar(): Promise<SchoolCalendarDay[]> {
    const prisma = getPrisma();
    const cal = await prisma.schoolCalendar.findFirst({
      orderBy: { startDate: "desc" },
      include: { days: { orderBy: { date: "asc" } } },
    });
    if (!cal) throw new Error("No SchoolCalendar in database");
    return cal.days.map((d) => ({
      date: toIsoDate(d.date),
      dayType: d.dayType,
      title: d.title ?? undefined,
      isInstructional: d.isInstructional,
    }));
  }

  async getTimetable(teacherExternalId: string, classExternalId: string) {
    const { prisma, teacher, klass } = await this.resolvePeople(
      teacherExternalId,
      classExternalId
    );
    const rows = await prisma.teacherSchedule.findMany({
      where: { teacherId: teacher.id, classId: klass.id },
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
    });

    return rows.map((s) => ({
      id: s.id,
      teacherExternalId,
      classExternalId,
      dayOfWeek: s.dayOfWeek,
      period: s.period,
      periodLabel: s.periodLabel ?? undefined,
      startTime: s.startTime ?? undefined,
      endTime: s.endTime ?? undefined,
      subject: s.subject ?? undefined,
      frameworkCode: s.frameworkCode ?? undefined,
    }));
  }

  private async mapScheduled(
    teacherExternalId: string,
    classExternalId: string,
    rows: Array<{
      id: string;
      skillNodeId: string;
      scheduledDate: Date;
      period: number;
      sequenceIndex: number;
      status: string;
      skillNode: {
        code: string | null;
        title: string;
        titleKo: string | null;
        framework: { code: string };
      };
    }>
  ): Promise<ScheduledLesson[]> {
    return rows.map((r) => ({
      id: r.id,
      teacherExternalId,
      classExternalId,
      skillNodeId: r.skillNodeId,
      skillCode: r.skillNode.code,
      skillTitle: nodeDisplayTitle(r.skillNode, {
        frameworkCode: r.skillNode.framework.code,
      }),
      frameworkCode: r.skillNode.framework.code,
      scheduledDate: toIsoDate(r.scheduledDate),
      period: r.period,
      sequenceIndex: r.sequenceIndex,
      status: r.status as ScheduledLesson["status"],
    }));
  }

  async getScheduledLessons(
    teacherExternalId: string,
    classExternalId: string,
    date?: string
  ): Promise<ScheduledLesson[]> {
    const { prisma, teacher, klass } = await this.resolvePeople(
      teacherExternalId,
      classExternalId
    );

    const rows = await prisma.scheduledLesson.findMany({
      where: {
        teacherId: teacher.id,
        classId: klass.id,
        ...(date ? { scheduledDate: new Date(`${date}T00:00:00.000Z`) } : {}),
      },
      include: { skillNode: { include: { framework: true } } },
      orderBy: [{ scheduledDate: "asc" }, { period: "asc" }],
    });

    return this.mapScheduled(teacherExternalId, classExternalId, rows);
  }

  async ensureSequenced(gradeLevel = "4"): Promise<ScheduledLesson[]> {
    const teacherExternalId = DEMO_TEACHER_ID;
    const classExternalId = DEMO_CLASS_ID;
    const existing = await this.getScheduledLessons(
      teacherExternalId,
      classExternalId
    );
    if (existing.length > 0) return existing;
    return this.resetAndSequence(gradeLevel);
  }

  async resetAndSequence(gradeLevel = "4"): Promise<ScheduledLesson[]> {
    const teacherExternalId = DEMO_TEACHER_ID;
    const classExternalId = DEMO_CLASS_ID;
    const { prisma, teacher, klass } = await this.resolvePeople(
      teacherExternalId,
      classExternalId
    );

    await prisma.lessonPlan.deleteMany({
      where: { teacherId: teacher.id, classId: klass.id },
    });
    await prisma.scheduledLesson.deleteMany({
      where: { teacherId: teacher.id, classId: klass.id },
    });

    const calendar = await this.getCalendar();
    const schedule = await this.getTimetable(teacherExternalId, classExternalId);
    const frameworks = [
      ...new Set(schedule.map((s) => s.frameworkCode).filter(Boolean) as string[]),
    ];

    const curriculum = getCurriculumRepository();
    const skillsByFramework: Record<string, CurriculumNode[]> = {};
    for (const code of frameworks) {
      skillsByFramework[code] = await curriculum.listSkills(code, gradeLevel);
    }

    const planned = sequenceSkillsOntoCalendar({
      teacherExternalId,
      classExternalId,
      calendarDays: calendar,
      schedule,
      skillsByFramework,
    });

    for (const lesson of planned) {
      await prisma.scheduledLesson.create({
        data: {
          teacherId: teacher.id,
          classId: klass.id,
          skillNodeId: lesson.skillNodeId,
          scheduledDate: new Date(`${lesson.scheduledDate}T00:00:00.000Z`),
          period: lesson.period,
          sequenceIndex: lesson.sequenceIndex,
          status: "PLANNED",
          metadata: {
            frameworkCode: lesson.frameworkCode,
            skillCode: lesson.skillCode,
          },
        },
      });
    }

    return this.getScheduledLessons(teacherExternalId, classExternalId);
  }

  async getOrCreateLessonPlan(scheduledLessonId: string): Promise<LessonPlan> {
    const prisma = getPrisma();
    const row = await prisma.scheduledLesson.findUnique({
      where: { id: scheduledLessonId },
      include: {
        teacher: true,
        class: true,
        skillNode: { include: { framework: true } },
        lessonPlan: true,
      },
    });
    if (!row) throw new Error(`Scheduled lesson not found: ${scheduledLessonId}`);

    if (row.lessonPlan) {
      return this.mapLessonPlan(row.lessonPlan, row.teacher.externalId, row.class.externalId);
    }

    const draft: ScheduledLesson = {
      id: row.id,
      teacherExternalId: row.teacher.externalId,
      classExternalId: row.class.externalId,
      skillNodeId: row.skillNodeId,
      skillCode: row.skillNode.code,
      skillTitle: nodeDisplayTitle(row.skillNode, {
        frameworkCode: row.skillNode.framework.code,
      }),
      frameworkCode: row.skillNode.framework.code,
      scheduledDate: toIsoDate(row.scheduledDate),
      period: row.period,
      sequenceIndex: row.sequenceIndex,
      status: row.status as ScheduledLesson["status"],
    };

    const generated = await generateLessonPlan(draft);

    const saved = await prisma.lessonPlan.create({
      data: {
        scheduledLessonId: row.id,
        teacherId: row.teacherId,
        classId: row.classId,
        skillNodeId: row.skillNodeId,
        lessonDate: row.scheduledDate,
        period: row.period,
        title: generated.title,
        status: "GENERATED",
        warmUp: generated.warmUp,
        instruction: generated.instruction,
        guidedPractice: generated.guidedPractice,
        formativeAssessment: generated.formativeAssessment,
        closure: generated.closure,
        materials: generated.materials,
        contentJson: generated.contentJson as object,
        model: generated.model,
        generatedAt: new Date(),
      },
    });

    await prisma.scheduledLesson.update({
      where: { id: row.id },
      data: { status: "GENERATED" },
    });

    return this.mapLessonPlan(saved, row.teacher.externalId, row.class.externalId);
  }

  private mapLessonPlan(
    p: {
      id: string;
      scheduledLessonId: string | null;
      skillNodeId: string | null;
      lessonDate: Date;
      period: number | null;
      title: string;
      status: string;
      warmUp: string | null;
      instruction: string | null;
      guidedPractice: string | null;
      formativeAssessment: string | null;
      closure: string | null;
      materials: string | null;
      contentJson: unknown;
      model: string | null;
      generatedAt: Date | null;
    },
    teacherExternalId: string,
    classExternalId: string
  ): LessonPlan {
    return {
      id: p.id,
      scheduledLessonId: p.scheduledLessonId || "",
      teacherExternalId,
      classExternalId,
      skillNodeId: p.skillNodeId || "",
      lessonDate: toIsoDate(p.lessonDate),
      period: p.period || 0,
      title: p.title,
      status: p.status as LessonPlan["status"],
      warmUp: p.warmUp || "",
      instruction: p.instruction || "",
      guidedPractice: p.guidedPractice || "",
      formativeAssessment: p.formativeAssessment || "",
      closure: p.closure || "",
      materials: p.materials || "",
      contentJson: (p.contentJson as Record<string, unknown>) || {},
      model: p.model || "unknown",
      generatedAt: (p.generatedAt || new Date()).toISOString(),
    };
  }

  async generatePlansForDay(
    teacherExternalId: string,
    classExternalId: string,
    date: string
  ): Promise<LessonPlan[]> {
    await this.ensureSequenced();
    const lessons = await this.getScheduledLessons(
      teacherExternalId,
      classExternalId,
      date
    );
    const plans: LessonPlan[] = [];
    for (const lesson of lessons) {
      plans.push(await this.getOrCreateLessonPlan(lesson.id));
    }
    return plans;
  }

  async applyCalendarOverlay(
    overlay: CalendarOverlayDay[],
    options?: { resequence?: boolean }
  ): Promise<SchoolCalendarDay[]> {
    const prisma = getPrisma();
    const cal = await prisma.schoolCalendar.findFirst({
      orderBy: { startDate: "desc" },
      include: { days: true },
    });
    if (!cal) throw new Error("No SchoolCalendar in database");

    const base = cal.days.map((d) => ({
      date: toIsoDate(d.date),
      dayType: d.dayType,
      title: d.title ?? undefined,
      isInstructional: d.isInstructional,
    }));
    const merged = mergeCalendarOverlay(base, overlay);

    for (const day of overlay) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
      const date = new Date(`${day.date}T00:00:00.000Z`);
      const dayType = day.dayType || "HOLIDAY";
      const isInstructional =
        typeof day.isInstructional === "boolean"
          ? day.isInstructional
          : dayType === "INSTRUCTIONAL" || dayType === "SCHOOL_DAY_OVERRIDE";

      const existing = await prisma.schoolCalendarDay.findUnique({
        where: { calendarId_date: { calendarId: cal.id, date } },
      });
      if (existing) {
        await prisma.schoolCalendarDay.update({
          where: { id: existing.id },
          data: {
            dayType,
            title: day.title ?? existing.title,
            isInstructional,
          },
        });
      } else {
        await prisma.schoolCalendarDay.create({
          data: {
            calendarId: cal.id,
            date,
            dayType,
            title: day.title ?? null,
            isInstructional,
          },
        });
      }
    }

    if (options?.resequence !== false) {
      await this.resetAndSequence("4");
    }

    return merged;
  }
}

class AutoScheduleRepository implements ScheduleRepository {
  private memory = new MemoryScheduleRepository();
  private prisma = new PrismaScheduleRepository();

  private usePrisma() {
    return (process.env.SCHEDULE_STORE || "memory") === "prisma";
  }

  private async withFallback<T>(fn: () => Promise<T>, fallback: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      console.warn("[schedule] prisma failed, falling back to memory:", e);
      return fallback();
    }
  }

  getCalendar() {
    if (!this.usePrisma()) return this.memory.getCalendar();
    return this.withFallback(
      () => this.prisma.getCalendar(),
      () => this.memory.getCalendar()
    );
  }

  getTimetable(t: string, c: string) {
    if (!this.usePrisma()) return this.memory.getTimetable(t, c);
    return this.withFallback(
      () => this.prisma.getTimetable(t, c),
      () => this.memory.getTimetable(t, c)
    );
  }

  getScheduledLessons(t: string, c: string, date?: string) {
    if (!this.usePrisma()) return this.memory.getScheduledLessons(t, c, date);
    return this.withFallback(
      () => this.prisma.getScheduledLessons(t, c, date),
      () => this.memory.getScheduledLessons(t, c, date)
    );
  }

  ensureSequenced(gradeLevel?: string) {
    if (!this.usePrisma()) return this.memory.ensureSequenced(gradeLevel);
    return this.withFallback(
      () => this.prisma.ensureSequenced(gradeLevel),
      () => this.memory.ensureSequenced(gradeLevel)
    );
  }

  resetAndSequence(gradeLevel?: string) {
    if (!this.usePrisma()) return this.memory.resetAndSequence(gradeLevel);
    return this.withFallback(
      () => this.prisma.resetAndSequence(gradeLevel),
      () => this.memory.resetAndSequence(gradeLevel)
    );
  }

  getOrCreateLessonPlan(id: string) {
    if (!this.usePrisma()) return this.memory.getOrCreateLessonPlan(id);
    return this.withFallback(
      () => this.prisma.getOrCreateLessonPlan(id),
      () => this.memory.getOrCreateLessonPlan(id)
    );
  }

  generatePlansForDay(t: string, c: string, date: string) {
    if (!this.usePrisma()) return this.memory.generatePlansForDay(t, c, date);
    return this.withFallback(
      () => this.prisma.generatePlansForDay(t, c, date),
      () => this.memory.generatePlansForDay(t, c, date)
    );
  }

  applyCalendarOverlay(
    overlay: CalendarOverlayDay[],
    options?: { resequence?: boolean }
  ) {
    if (!this.usePrisma()) {
      return this.memory.applyCalendarOverlay(overlay, options);
    }
    return this.withFallback(
      () => this.prisma.applyCalendarOverlay(overlay, options),
      () => this.memory.applyCalendarOverlay(overlay, options)
    );
  }
}

let singleton: ScheduleRepository | null = null;

export function getScheduleRepository(): ScheduleRepository {
  if (!singleton) singleton = new AutoScheduleRepository();
  return singleton;
}

/** Test helper — clear singleton between store mode switches. */
export function resetScheduleRepositorySingleton() {
  singleton = null;
}
