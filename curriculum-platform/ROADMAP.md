# Implementation Roadmap

## Step 1 — Data foundation ✅
- Prisma multi-framework schema
- Seed packs: CCSS Math G4, KR 2022 Korean G4

## Step 2 — Interactive curriculum mindmap ✅
- Next.js App Router shell (Tailwind)
- Curriculum tree APIs (seed-backed + repository port)
- React Flow drill-down: Framework → Grade → Domain → Concept → Skill
- Skill slide-over: objectives, resources, AI material generator

## Step 3 — Schedule & AI lesson plans ✅
- School calendar + weekly timetable inputs
- Sequential skill → instructional slot mapper
- Daily lesson plan generator (structured JSON; OpenAI when keyed, deterministic fallback)

## Step 4 — External teacher portal APIs ✅
- `GET /api/portal/v1/teachers/:teacherId/classes/:classId/lessons`
- `GET /api/portal/v1/teachers/:teacherId/classes/:classId/materials`
- API-key auth header for portal consumers

## Step 5 — Mindmap UX polish ✅
- Horizontal / vertical layout toggle
- Grade filter + fitView on layout changes
- Sequencer smoke script

## Step 6 — Persistence layer ✅ (seed default)
- `CurriculumRepository` port with `Seed` / `Prisma` / auto-fallback
- `CURRICULUM_STORE=seed|prisma` — Prisma path used when DB is seeded
- Next: migrate schedule/lesson runtime store to Postgres

## Step 7 — Expand curriculum packs ✅ (samples)
- NGSS Science Grade 4
- KR 2022 한국사 (초등 사회 연계) Grade 4 + CUSTOM school node

## Step 8 — Schedule repository port ✅
- `ScheduleRepository` (`memory` default, `prisma` partial + fallback)
- APIs routed through repository

## Later
- Salt Morning teacher portal deep-link / embed
- Auth / multi-org tenancy UI
- Full Prisma write path for sequencer + lesson plans
- Richer K–12 packs across all frameworks
