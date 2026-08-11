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

## Step 11 — Calendar blackout sync ✅
- `POST /api/portal/v1/calendar/sync` merges holidays/blackouts
- Salt Morning: `POST /api/teacher/curriculum-map/sync-calendar`
- Resequence skills after overlay (optional)

## Step 12 — Pack expansion ✅
- CCSS ELA Grade 4 (RL.4 + W.4)
- CCSS Math Grade 5 slice (5.NBT)
- Demo timetable includes ELA Monday P1
- `/api/health` readiness check

## Later
- Auth / session-backed multi-org tenancy
- Richer full K–12 packs
- Auto-sync cron from Salt Morning holiday calendar

## Step 13 — Multi-org polish + pack depth ✅
- Seed-mode honors `organizationCode` / `isPublic` (Acme SEL private)
- Header org switcher persists into map/home filters
- KR 한국사 + NGSS Grade 4 packs expanded
- Schedule calendar overlay legend + sync→resequence affordance
