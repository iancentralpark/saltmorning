# Implementation Roadmap

## Step 1 — Data foundation ✅
- Prisma multi-framework schema
- Seed packs: CCSS Math G4, KR 2022 Korean G4

## Step 2 — Interactive curriculum mindmap
- Next.js App Router shell (Tailwind)
- Curriculum tree APIs (seed-backed + Prisma-ready)
- React Flow drill-down: Framework → Grade → Domain → Concept → Skill
- Skill slide-over: objectives, resources, AI material generator stub

## Step 3 — Schedule & AI lesson plans
- School calendar + weekly timetable inputs
- Sequential skill → instructional slot mapper
- Daily lesson plan generator (structured JSON; OpenAI when keyed, deterministic fallback)

## Step 4 — External teacher portal APIs
- `GET /api/portal/v1/teachers/:teacherId/classes/:classId/lessons`
- `GET /api/portal/v1/teachers/:teacherId/classes/:classId/materials`
- API-key auth header for portal consumers
