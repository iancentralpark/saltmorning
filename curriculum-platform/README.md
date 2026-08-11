# Curriculum Mapping & AI Lesson Planning Platform

Interactive K-12 curriculum mindmap, calendar-aware AI lesson planning, and teacher-portal APIs.

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL + Prisma
- React Flow (mindmap) — planned
- OpenAI / Vercel AI SDK — planned

## Step 1 (this PR)

1. **Prisma schema** — multi-framework, hierarchy, schedules, lesson plans  
   → `prisma/schema.prisma`
2. **Sample seed JSON**  
   - Common Core Math Grade 4 → `prisma/seed/ccss-math-grade-4.json`  
   - Korea 2022 Revised Curriculum · Korean Language Grade 4 → `prisma/seed/kr2022-korean-grade-4.json`

## Quick start (when DB is available)

```bash
cd curriculum-platform
cp .env.example .env   # set DATABASE_URL
npm install
npx prisma migrate dev
npm run db:seed
```

## Framework-agnostic model

`Framework` owns a tree of `CurriculumNode`s (`GRADE` → `DOMAIN` → `CONCEPT` → `SKILL`).  
Skills attach `LearningObjective`s and optional `Resource`s.  
Teachers map skills onto instructional days via `ScheduledLesson`, then generate `LessonPlan`s.
