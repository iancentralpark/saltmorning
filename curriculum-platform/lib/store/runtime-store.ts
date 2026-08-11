import type { AiMaterial, LessonPlan, ScheduledLesson } from "@/lib/types";
import {
  DEMO_CLASS_ID,
  DEMO_SCHEDULE,
  DEMO_TEACHER_ID,
  buildDemoCalendar,
} from "@/lib/schedule/demo-data";
import { sequenceSkillsOntoCalendar } from "@/lib/schedule/sequencer";
import { generateLessonPlan } from "@/lib/ai/lesson-plan";
import { getCurriculumRepository } from "@/lib/curriculum/repository";
import type { CurriculumNode } from "@/lib/types";
import {
  mergeCalendarOverlay,
  type CalendarOverlayDay,
} from "@/lib/schedule/calendar-sync";

/**
 * In-memory runtime store for demo / portal APIs until Postgres is wired.
 * Process-local; resets on server restart.
 */
class RuntimeStore {
  scheduledLessons: ScheduledLesson[] = [];
  lessonPlans = new Map<string, LessonPlan>();
  materials: AiMaterial[] = [];
  calendar = buildDemoCalendar("2026-03-02", 28);
  schedule = DEMO_SCHEDULE;

  applyCalendarOverlay(overlay: CalendarOverlayDay[], resequence = true) {
    this.calendar = mergeCalendarOverlay(this.calendar, overlay);
    if (resequence) {
      this.scheduledLessons = [];
      this.lessonPlans.clear();
    }
    return this.calendar;
  }

  async ensureSequenced(gradeLevel = "4") {
    if (this.scheduledLessons.length > 0) return this.scheduledLessons;

    const repo = getCurriculumRepository();
    const frameworks = [
      ...new Set(
        this.schedule
          .map((s) => s.frameworkCode)
          .filter(Boolean) as string[]
      ),
    ];
    const skillsByFramework: Record<string, CurriculumNode[]> = {};
    for (const code of frameworks) {
      skillsByFramework[code] = await repo.listSkills(code, gradeLevel);
    }

    this.scheduledLessons = sequenceSkillsOntoCalendar({
      teacherExternalId: DEMO_TEACHER_ID,
      classExternalId: DEMO_CLASS_ID,
      calendarDays: this.calendar,
      schedule: this.schedule,
      skillsByFramework,
    });
    return this.scheduledLessons;
  }

  getLessons(teacherId: string, classId: string, date?: string) {
    return this.scheduledLessons.filter(
      (l) =>
        l.teacherExternalId === teacherId &&
        l.classExternalId === classId &&
        (!date || l.scheduledDate === date)
    );
  }

  async getOrCreateLessonPlan(lessonId: string): Promise<LessonPlan> {
    const existing = this.lessonPlans.get(lessonId);
    if (existing) return existing;

    await this.ensureSequenced();
    const lesson = this.scheduledLessons.find((l) => l.id === lessonId);
    if (!lesson) throw new Error(`Scheduled lesson not found: ${lessonId}`);

    const plan = await generateLessonPlan(lesson);
    this.lessonPlans.set(lessonId, plan);
    lesson.status = "GENERATED";
    return plan;
  }

  async generateAllPlansForDay(
    teacherId: string,
    classId: string,
    date: string
  ): Promise<LessonPlan[]> {
    await this.ensureSequenced();
    const lessons = this.getLessons(teacherId, classId, date);
    const plans: LessonPlan[] = [];
    for (const lesson of lessons) {
      plans.push(await this.getOrCreateLessonPlan(lesson.id));
    }
    return plans;
  }

  addMaterial(material: AiMaterial) {
    this.materials.unshift(material);
    return material;
  }

  getMaterials(teacherId: string, classId: string) {
    const skillIds = new Set(
      this.scheduledLessons
        .filter(
          (l) =>
            l.teacherExternalId === teacherId && l.classExternalId === classId
        )
        .map((l) => l.skillNodeId)
    );
    return this.materials.filter((m) => skillIds.has(m.nodeId));
  }
}

const globalForStore = globalThis as unknown as { __curriculumStore?: RuntimeStore };

export function getStore() {
  if (!globalForStore.__curriculumStore) {
    globalForStore.__curriculumStore = new RuntimeStore();
  }
  return globalForStore.__curriculumStore;
}

export { DEMO_TEACHER_ID, DEMO_CLASS_ID };
