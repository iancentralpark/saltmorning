# Full Curriculum Fill Plan

Goal: **official-complete** catalogs (every coded standard / PE / 성취기준), not sample slices.

| Framework | Source | Skills | Span |
|-----------|--------|--------|------|
| CCSS Math | Common Standards Project API | **525** | K–8 + HS N/Q/A/F/G/S + MP |
| CCSS ELA | Common Standards Project API | **1,019** | K–12 RL/RI/RF/W/SL/L + RH/RST/WHST |
| NGSS | CSP Performance Expectations | **208** | K–5 + MS + HS (unique PEs) |
| KR 국어 | NCIC 별책 5 PDF | **228** | 초·중 공통 + 고등 선택 |
| KR 사회/역사 | NCIC 별책 7 PDF | **348** | 초등 사회 + 중학 사회·역사 + 고등 선택 |
| Acme SEL | private sample | 5 | 4–5 |

**Total: 2,333 skills / 6 packs**

## Rebuild

```bash
# KR PDF extract (PDFs in imports/)
python3 scripts/extract-kr-official.py

# CSP + KR → seed JSON
npx tsx scripts/build-official-catalogs.ts

npm run test:seed
```

PDFs:
- `imports/kr-korean-2022.pdf` — NCIC seq 10003553
- `imports/kr-social-2022.pdf` — NCIC seq 10003800
