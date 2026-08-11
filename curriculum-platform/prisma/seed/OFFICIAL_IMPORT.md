# Official pack import notes

CurricuMap seed packs are **sample-depth** trees (DOMAIN → CONCEPT → SKILL), not full official dumps.

## Importing denser catalogs

1. Follow [`SEED_FORMAT.md`](./SEED_FORMAT.md) JSON shape.
2. Prefer one framework file with multiple `GRADE` children (see CCSS Math K–8 + Algebra I).
3. Keep bilingual fields when required by content-locale rules (국어/한국사 → Korean display).
4. Place new `*.json` under `prisma/seed/` — `seed-loader` auto-loads them.
5. Optional Prisma reseed: `npm run db:seed`.

## Official sources (reference)

| Framework | Source |
|-----------|--------|
| CCSS Math / ELA | http://www.corestandards.org/ |
| NGSS | https://www.nextgenscience.org/ |
| KR 2022 | 교육부 고시 PDF (성취기준) |

When replacing a sample skill with an official code, keep `code` stable if schedules already reference it, or resequence after import.

## Expansion scripts

```bash
npx tsx scripts/expand-math-k12.ts
npx tsx scripts/expand-kr-ngss-grades.ts
npx tsx scripts/expand-k12-breadth.ts
npx tsx scripts/expand-hs-ms-packs.ts
```

These are idempotent where possible (skip grades that already exist).
