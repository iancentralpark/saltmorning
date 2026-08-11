-- CreateEnum
CREATE TYPE "FrameworkSubject" AS ENUM ('MATH', 'ELA', 'SCIENCE', 'KOREAN_LANGUAGE', 'KOREAN_HISTORY', 'SOCIAL_STUDIES', 'OTHER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CurriculumNodeType" AS ENUM ('ROOT', 'GRADE', 'DOMAIN', 'CONCEPT', 'SKILL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('PDF', 'WORKSHEET', 'SLIDES', 'VIDEO', 'LINK', 'OTHER');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "CalendarDayType" AS ENUM ('INSTRUCTIONAL', 'HOLIDAY', 'BREAK', 'EVENT', 'BLACKOUT', 'SCHOOL_DAY_OVERRIDE');

-- CreateEnum
CREATE TYPE "ScheduledLessonStatus" AS ENUM ('PLANNED', 'GENERATED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LessonPlanStatus" AS ENUM ('DRAFT', 'GENERATED', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AiMaterialType" AS ENUM ('DAILY_QUIZ', 'FORMATIVE_TEST', 'WORKSHEET', 'EXIT_TICKET', 'WARM_UP', 'OTHER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "organizationId" TEXT,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "gradeLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Framework" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKo" TEXT,
    "subject" "FrameworkSubject" NOT NULL DEFAULT 'OTHER',
    "regionStandard" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "description" TEXT,
    "metadata" JSONB,
    "organizationId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumNode" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "parentId" TEXT,
    "nodeType" "CurriculumNodeType" NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "titleKo" TEXT,
    "summary" TEXT,
    "gradeLevel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "positionX" DOUBLE PRECISION,
    "positionY" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjective" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "code" TEXT,
    "statement" TEXT NOT NULL,
    "statementKo" TEXT,
    "masteryCriteria" TEXT,
    "masteryCriteriaKo" TEXT,
    "bloomLevel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCalendar" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCalendarDay" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dayType" "CalendarDayType" NOT NULL DEFAULT 'INSTRUCTIONAL',
    "title" TEXT,
    "isInstructional" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,

    CONSTRAINT "SchoolCalendarDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherSchedule" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "period" INTEGER NOT NULL,
    "periodLabel" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "subject" TEXT,
    "frameworkCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledLesson" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "skillNodeId" TEXT NOT NULL,
    "teacherScheduleId" TEXT,
    "scheduledDate" DATE NOT NULL,
    "period" INTEGER NOT NULL,
    "sequenceIndex" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduledLessonStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonPlan" (
    "id" TEXT NOT NULL,
    "scheduledLessonId" TEXT,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "skillNodeId" TEXT,
    "lessonDate" DATE NOT NULL,
    "period" INTEGER,
    "title" TEXT NOT NULL,
    "status" "LessonPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "warmUp" TEXT,
    "instruction" TEXT,
    "guidedPractice" TEXT,
    "formativeAssessment" TEXT,
    "closure" TEXT,
    "materials" TEXT,
    "differentiation" TEXT,
    "homework" TEXT,
    "contentJson" JSONB,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMaterial" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT,
    "lessonPlanId" TEXT,
    "type" "AiMaterialType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "prompt" TEXT,
    "contentJson" JSONB NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE INDEX "Teacher_externalId_idx" ON "Teacher"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_organizationId_externalId_key" ON "Teacher"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Class_externalId_idx" ON "Class"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Class_organizationId_externalId_key" ON "Class"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Framework_code_key" ON "Framework"("code");

-- CreateIndex
CREATE INDEX "Framework_subject_regionStandard_idx" ON "Framework"("subject", "regionStandard");

-- CreateIndex
CREATE INDEX "CurriculumNode_frameworkId_nodeType_idx" ON "CurriculumNode"("frameworkId", "nodeType");

-- CreateIndex
CREATE INDEX "CurriculumNode_frameworkId_gradeLevel_idx" ON "CurriculumNode"("frameworkId", "gradeLevel");

-- CreateIndex
CREATE INDEX "CurriculumNode_parentId_sortOrder_idx" ON "CurriculumNode"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "CurriculumNode_code_idx" ON "CurriculumNode"("code");

-- CreateIndex
CREATE INDEX "LearningObjective_nodeId_sortOrder_idx" ON "LearningObjective"("nodeId", "sortOrder");

-- CreateIndex
CREATE INDEX "Resource_nodeId_type_idx" ON "Resource"("nodeId", "type");

-- CreateIndex
CREATE INDEX "SchoolCalendar_organizationId_academicYear_idx" ON "SchoolCalendar"("organizationId", "academicYear");

-- CreateIndex
CREATE INDEX "SchoolCalendarDay_calendarId_isInstructional_idx" ON "SchoolCalendarDay"("calendarId", "isInstructional");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolCalendarDay_calendarId_date_key" ON "SchoolCalendarDay"("calendarId", "date");

-- CreateIndex
CREATE INDEX "TeacherSchedule_teacherId_dayOfWeek_idx" ON "TeacherSchedule"("teacherId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TeacherSchedule_classId_idx" ON "TeacherSchedule"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSchedule_teacherId_classId_dayOfWeek_period_key" ON "TeacherSchedule"("teacherId", "classId", "dayOfWeek", "period");

-- CreateIndex
CREATE INDEX "ScheduledLesson_teacherId_scheduledDate_idx" ON "ScheduledLesson"("teacherId", "scheduledDate");

-- CreateIndex
CREATE INDEX "ScheduledLesson_classId_scheduledDate_idx" ON "ScheduledLesson"("classId", "scheduledDate");

-- CreateIndex
CREATE INDEX "ScheduledLesson_skillNodeId_idx" ON "ScheduledLesson"("skillNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledLesson_teacherId_classId_scheduledDate_period_key" ON "ScheduledLesson"("teacherId", "classId", "scheduledDate", "period");

-- CreateIndex
CREATE UNIQUE INDEX "LessonPlan_scheduledLessonId_key" ON "LessonPlan"("scheduledLessonId");

-- CreateIndex
CREATE INDEX "LessonPlan_teacherId_lessonDate_idx" ON "LessonPlan"("teacherId", "lessonDate");

-- CreateIndex
CREATE INDEX "LessonPlan_classId_lessonDate_idx" ON "LessonPlan"("classId", "lessonDate");

-- CreateIndex
CREATE INDEX "LessonPlan_status_idx" ON "LessonPlan"("status");

-- CreateIndex
CREATE INDEX "AiMaterial_nodeId_type_idx" ON "AiMaterial"("nodeId", "type");

-- CreateIndex
CREATE INDEX "AiMaterial_lessonPlanId_idx" ON "AiMaterial"("lessonPlanId");

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Framework" ADD CONSTRAINT "Framework_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumNode" ADD CONSTRAINT "CurriculumNode_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumNode" ADD CONSTRAINT "CurriculumNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CurriculumNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjective" ADD CONSTRAINT "LearningObjective_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CurriculumNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CurriculumNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCalendar" ADD CONSTRAINT "SchoolCalendar_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolCalendarDay" ADD CONSTRAINT "SchoolCalendarDay_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "SchoolCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSchedule" ADD CONSTRAINT "TeacherSchedule_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSchedule" ADD CONSTRAINT "TeacherSchedule_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledLesson" ADD CONSTRAINT "ScheduledLesson_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledLesson" ADD CONSTRAINT "ScheduledLesson_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledLesson" ADD CONSTRAINT "ScheduledLesson_skillNodeId_fkey" FOREIGN KEY ("skillNodeId") REFERENCES "CurriculumNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledLesson" ADD CONSTRAINT "ScheduledLesson_teacherScheduleId_fkey" FOREIGN KEY ("teacherScheduleId") REFERENCES "TeacherSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_scheduledLessonId_fkey" FOREIGN KEY ("scheduledLessonId") REFERENCES "ScheduledLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_skillNodeId_fkey" FOREIGN KEY ("skillNodeId") REFERENCES "CurriculumNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMaterial" ADD CONSTRAINT "AiMaterial_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CurriculumNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMaterial" ADD CONSTRAINT "AiMaterial_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
