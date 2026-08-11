# Full Curriculum Fill Plan

Goal: sample-depth → **coverage-complete** across major frameworks (still not every official PE line, but every grade band with multiple domains).

| Phase | Framework | Target | Status |
|-------|-----------|--------|--------|
| 1 | CCSS Math | K–8 thickened + HS Algebra / Geometry / Stats merged | ✅ ~106 skills |
| 2 | CCSS ELA | K–8 + HS 9–10 / 11–12 (RL/RI/RF/W/SL/L) | ✅ ~144 skills |
| 3 | NGSS | K–8 + HS Physical/Life/Earth/ETS | ✅ ~95 skills |
| 4 | KR 국어 | 1–9 (초·중) | ✅ ~111 skills |
| 5 | KR 한국사/사회 | 3–9 | ✅ ~72 skills |
| 6 | Validate + Railway redeploy | `npm run test:seed` → 533 skills / 6 packs | ✅ |

**Total:** 6 packs, **533 skills** (was ~112 before expansion).

Private pack unchanged: `custom-acme-sel` (5 skills).

Run (idempotent merge + dedupe if needed):

```bash
npx tsx scripts/expand-full-curriculum.ts
npx tsx scripts/dedupe-seed-skills.ts   # only if re-running left dupes
npm run test:seed
```

Notes:
- `ccss-math-geometry-stats.json` was merged into `ccss-math-grade-4.json` (HS) and removed.
- Coverage is **full-band sample**, not a line-by-line official catalog dump. See `prisma/seed/OFFICIAL_IMPORT.md` for denser imports.
