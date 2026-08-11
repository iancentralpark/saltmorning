# CurricuMap — Curriculum Mapping & AI Lesson Planning

Interactive K-12 curriculum mindmap, calendar-aware AI lesson planning, and teacher-portal APIs.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- React Flow (`@xyflow/react`) mindmap
- PostgreSQL + Prisma
- Google Gemini via `@google/genai` (`GEMINI_API_KEY`): `gemini-2.5-pro` for lesson planning, `gemini-2.5-flash` for quizzes/worksheets; deterministic fallback when unset

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

## Quick start

```bash
cd curriculum-platform
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Pages

| Route | Purpose |
|-------|---------|
| `/` | Brand landing + loaded frameworks |
| `/map` | React Flow drill-down mindmap + skill drawer |
| `/schedule` | Calendar sequencing + AI lesson plan generation |
| `/docs/api` | External portal API reference |

### Demo IDs

- Teacher: `T001`
- Class: `C4A`
- Demo orgs: `salt-morning`, `acme-academy` (header **Demo login**)

### Portal example

```bash
curl -H "x-api-key: dev-portal-key" -H "x-organization-code: salt-morning" \
  "http://localhost:3000/api/portal/v1/teachers/T001/classes/C4A/lessons?date=2026-03-02&generate=1"
```

### Calendar cron

```bash
# Prefer Salt Morning (has Google holiday calendar):
curl -X POST http://localhost:8790/api/internal/curriculum-map/sync-calendar-cron \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"year":2026,"months":[3,4,5,6]}'

# Or CurricuMap local overlay:
curl -X POST http://localhost:3000/api/cron/calendar-sync \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"holidays":{"2026-03-01":"삼일절"}}'
```

## Prisma / seed

```bash
# Start Postgres, then:
cp .env.example .env   # set DATABASE_URL; optional CURRICULUM_STORE=prisma SCHEDULE_STORE=prisma
npx prisma migrate dev
npm run db:seed
npm run test:prisma
```

Seed packs:

- `prisma/seed/ccss-math-grade-4.json`
- `prisma/seed/kr2022-korean-grade-4.json`
- `prisma/seed/ngss-science-grade-4.json`
- `prisma/seed/kr2022-history-grade-4.json`

Curriculum data source: `CURRICULUM_STORE=seed` (default) or `prisma` after migrate/seed.  
Schedule persistence: `SCHEDULE_STORE=memory` (default) or `prisma`.

```bash
npm run test:smoke   # sequencer
npm run test:ui      # Playwright drawer + AI plans
npm run test:prisma  # Postgres schedule write path
```

### Salt Morning bridge

Set in `morning-class/.env`:

```
CURRICULUM_MAP_URL=http://localhost:3000
CURRICULUM_MAP_API_KEY=dev-portal-key
CURRICULUM_MAP_ORG_CODE=salt-morning
CRON_SECRET=dev-cron-secret
```

Teacher → Lesson plan panel exposes CurricuMap deep-links;  
`GET /api/teacher/curriculum-map/lessons` proxies portal lesson JSON.  
Host cron: `POST /api/internal/curriculum-map/sync-calendar-cron`.
