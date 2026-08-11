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

### Production

Live on Railway: **https://curricumap-production.up.railway.app**  
Health: https://curricumap-production.up.railway.app/api/health  

```bash
npm run deploy:railway
```

See [OPS.md](./OPS.md) for OAuth redirect URIs and Salt Morning bridge env.

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

Seed packs (full-band sample coverage — **533 skills** / 6 packs):

- `prisma/seed/ccss-math-grade-4.json` — CCSS Math **K–8 + HS Algebra/Geometry/Stats**
- `prisma/seed/ccss-ela-grade-4.json` — ELA **K–8 + HS 9–12** (RL/RI/RF/W/SL/L)
- `prisma/seed/ngss-science-grade-4.json` — NGSS **K–8 + HS**
- `prisma/seed/kr2022-korean-grade-4.json` — 국어 **1–9**
- `prisma/seed/kr2022-history-grade-4.json` — 한국사/사회 **3–9**
- `prisma/seed/custom-acme-sel.json` — private Acme SEL
- See `CURRICULUM_ROADMAP.md` + `prisma/seed/OFFICIAL_IMPORT.md` for expansion / denser imports

### Auth

| Mode | When |
|------|------|
| Demo login | Always (unless `DEMO_LOGIN_DISABLED=1`) |
| Google OAuth | When `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set |
| Microsoft OAuth | When `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` set |
| Apple Sign In | When `APPLE_CLIENT_ID` + team/key/private key set |
| Force login | `AUTH_REQUIRED=1` gates `/map` and `/schedule` |

Curriculum data source: `CURRICULUM_STORE=seed` (default) or `prisma` after migrate/seed.  
Schedule persistence: `SCHEDULE_STORE=memory` (default) or `prisma`.

```bash
npm run test:all     # seed + session + oauth + auth + sequencer + calendar
npm run test:smoke   # sequencer
npm run test:ui      # Playwright drawer + AI plans
npm run test:prisma  # Postgres schedule write path
npm run test:seed    # validate seed JSON packs
```

Production credentials & cron: see [OPS.md](./OPS.md).

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
