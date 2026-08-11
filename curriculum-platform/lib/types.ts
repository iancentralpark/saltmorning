export type NodeType =
  | "ROOT"
  | "GRADE"
  | "DOMAIN"
  | "CONCEPT"
  | "SKILL"
  | "CUSTOM";

export type LearningObjective = {
  id: string;
  code?: string | null;
  statement: string;
  statementKo?: string | null;
  masteryCriteria?: string | null;
  masteryCriteriaKo?: string | null;
  bloomLevel?: string | null;
  sortOrder: number;
};

export type ResourceItem = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  url?: string | null;
  mimeType?: string | null;
  sortOrder: number;
};

export type CurriculumNode = {
  id: string;
  frameworkCode: string;
  parentId: string | null;
  nodeType: NodeType;
  code?: string | null;
  title: string;
  titleKo?: string | null;
  summary?: string | null;
  gradeLevel?: string | null;
  sortOrder: number;
  positionX?: number | null;
  positionY?: number | null;
  metadata?: Record<string, unknown> | null;
  objectives: LearningObjective[];
  resources: ResourceItem[];
  children: CurriculumNode[];
};

export type FrameworkSummary = {
  code: string;
  name: string;
  nameKo?: string | null;
  subject: string;
  regionStandard: string;
  version: string;
  description?: string | null;
  gradeLevels: string[];
  skillCount: number;
};

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export type CalendarDayType =
  | "INSTRUCTIONAL"
  | "HOLIDAY"
  | "BREAK"
  | "EVENT"
  | "BLACKOUT"
  | "SCHOOL_DAY_OVERRIDE";

export type SchoolCalendarDay = {
  date: string; // YYYY-MM-DD
  dayType: CalendarDayType;
  title?: string;
  isInstructional: boolean;
};

export type TeacherScheduleSlot = {
  id: string;
  teacherExternalId: string;
  classExternalId: string;
  dayOfWeek: DayOfWeek;
  period: number;
  periodLabel?: string;
  startTime?: string;
  endTime?: string;
  subject?: string;
  frameworkCode?: string;
};

export type ScheduledLesson = {
  id: string;
  teacherExternalId: string;
  classExternalId: string;
  skillNodeId: string;
  skillCode?: string | null;
  skillTitle: string;
  frameworkCode: string;
  scheduledDate: string;
  period: number;
  sequenceIndex: number;
  status: "PLANNED" | "GENERATED" | "COMPLETED" | "SKIPPED";
};

export type LessonPlan = {
  id: string;
  scheduledLessonId: string;
  teacherExternalId: string;
  classExternalId: string;
  skillNodeId: string;
  lessonDate: string;
  period: number;
  title: string;
  status: "DRAFT" | "GENERATED" | "PUBLISHED";
  warmUp: string;
  instruction: string;
  guidedPractice: string;
  formativeAssessment: string;
  closure: string;
  materials: string;
  contentJson: Record<string, unknown>;
  model: string;
  generatedAt: string;
};

export type AiMaterial = {
  id: string;
  nodeId: string;
  type: string;
  title: string;
  contentJson: Record<string, unknown>;
  model: string;
  createdAt: string;
};
