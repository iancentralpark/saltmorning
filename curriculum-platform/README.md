# CurricuMap — Curriculum Mapping & AI Lesson Planning

Interactive K-12 curriculum mindmap, calendar-aware AI lesson planning, and teacher-portal APIs.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- React Flow (`@xyflow/react`) mindmap
- PostgreSQL + Prisma (schema ready; UI uses seed-backed runtime store until DB is wired)
- OpenAI structured JSON when `OPENAI_API_KEY` is set (deterministic fallback otherwise)

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

### Portal example

```bash
curl "http://localhost:3000/api/portal/v1/teachers/T001/classes/C4A/lessons?date=2026-03-02&generate=1"
```

## Prisma / seed

```bash
npx prisma migrate dev
npm run db:seed
```

Seed packs:

- `prisma/seed/ccss-math-grade-4.json`
- `prisma/seed/kr2022-korean-grade-4.json`
- `prisma/seed/ngss-science-grade-4.json`

Curriculum data source: `CURRICULUM_STORE=seed` (default) or `prisma` after `npm run db:migrate && npm run db:seed`.

```bash
npm run test:smoke   # sequencer sanity check
```
