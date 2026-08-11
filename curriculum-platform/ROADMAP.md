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
- Demo timetable includes ELA Monday P1

## Later
- Auth / multi-org tenancy UI
- Richer full K–12 packs
- Auto-sync cron from Salt Morning holiday calendar
