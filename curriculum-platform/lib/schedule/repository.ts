/**
 * Schedule / lesson-plan persistence port.
 * In-memory runtime today; Prisma methods ready for DB-backed deployment.
 */

import type {
  LessonPlan,
  ScheduledLesson,
  SchoolCalendarDay,
  TeacherScheduleSlot,
} from "@/lib/types";
import { getStore } from "@/lib/store/runtime-store";
import { getPrisma } from "@/lib/db";

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
}

/**
 * Prisma-backed schedule repository (requires seeded Organization/Teacher/Class rows).
 * Throws until org graph is provisioned — AutoScheduleRepository falls back to memory.
 */
export class PrismaScheduleRepository implements ScheduleRepository {
  async getCalendar(): Promise<SchoolCalendarDay[]> {
    const prisma = getPrisma();
    const cal = await prisma.schoolCalendar.findFirst({
      orderBy: { startDate: "desc" },
      include: { days: { orderBy: { date: "asc" } } },
    });
    if (!cal) throw new Error("No SchoolCalendar in database");
    return cal.days.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      dayType: d.dayType,
      title: d.title ?? undefined,
      isInstructional: d.isInstructional,
    }));
  }

  async getTimetable(teacherExternalId: string, classExternalId: string) {
    const prisma = getPrisma();
    const teacher = await prisma.teacher.findFirst({
      where: { externalId: teacherExternalId },
    });
    const klass = await prisma.class.findFirst({
      where: { externalId: classExternalId },
    });
    if (!teacher || !klass) throw new Error("Teacher or class not found");

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

  async getScheduledLessons(
    teacherExternalId: string,
    classExternalId: string,
    date?: string
  ): Promise<ScheduledLesson[]> {
    const prisma = getPrisma();
    const teacher = await prisma.teacher.findFirst({
      where: { externalId: teacherExternalId },
    });
    const klass = await prisma.class.findFirst({
      where: { externalId: classExternalId },
    });
    if (!teacher || !klass) return [];

    const rows = await prisma.scheduledLesson.findMany({
      where: {
        teacherId: teacher.id,
        classId: klass.id,
        ...(date
          ? { scheduledDate: new Date(`${date}T00:00:00.000Z`) }
          : {}),
      },
      include: { skillNode: true },
      orderBy: [{ scheduledDate: "asc" }, { period: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      teacherExternalId,
      classExternalId,
      skillNodeId: r.skillNodeId,
      skillCode: r.skillNode.code,
      skillTitle: r.skillNode.titleKo || r.skillNode.title,
      frameworkCode: "", // filled by join if needed
      scheduledDate: r.scheduledDate.toISOString().slice(0, 10),
      period: r.period,
      sequenceIndex: r.sequenceIndex,
      status: r.status as ScheduledLesson["status"],
    }));
  }

  async ensureSequenced(_gradeLevel?: string): Promise<ScheduledLesson[]> {
    throw new Error(
      "PrismaScheduleRepository.ensureSequenced not implemented — provision calendar + run sequencer write path"
    );
  }

  async resetAndSequence(_gradeLevel?: string): Promise<ScheduledLesson[]> {
    throw new Error("PrismaScheduleRepository.resetAndSequence not implemented");
  }

  async getOrCreateLessonPlan(_scheduledLessonId: string): Promise<LessonPlan> {
    throw new Error("PrismaScheduleRepository.getOrCreateLessonPlan not implemented");
  }

  async generatePlansForDay(
    _teacherExternalId: string,
    _classExternalId: string,
    _date: string
  ): Promise<LessonPlan[]> {
    throw new Error("PrismaScheduleRepository.generatePlansForDay not implemented");
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
    } catch {
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
}

let singleton: ScheduleRepository | null = null;

export function getScheduleRepository(): ScheduleRepository {
  if (!singleton) singleton = new AutoScheduleRepository();
  return singleton;
}
