# Implementation Roadmap

## Steps 1–8 ✅
Data foundation, mindmap, schedule AI, portal APIs, UX polish, repositories, pack expansion.

## Step 9 — Prisma schedule persistence ✅
- Postgres migrate + curriculum/demo school seed
- `PrismaScheduleRepository` write path (sequence + lesson plans)
- `npm run test:prisma`

## Step 10 — Salt Morning deep-link ✅
- Teacher Lesson plan panel → CurricuMap schedule / mindmap links
- Proxy: `GET /api/teacher/curriculum-map/lessons`
- Embed mode (`?embed=1`) hides CurricuMap chrome

## Later
- Auth / multi-org tenancy UI
- Richer K–12 packs
- Two-way sync of Salt Morning calendar blackout dates into CurricuMap
