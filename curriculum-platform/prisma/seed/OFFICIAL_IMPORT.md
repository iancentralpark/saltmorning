# Official pack import notes

CurricuMap public seed packs are **official-complete** coded catalogs:

| Pack | Source | Skills |
|------|--------|--------|
| `ccss-math-grade-4.json` | [Common Standards Project](https://api.commonstandardsproject.com) CCSS Math | 525 |
| `ccss-ela-grade-4.json` | CSP CCSS ELA/Literacy | 1,019 |
| `ngss-science-grade-4.json` | CSP NGSS Performance Expectations | 208 |
| `kr2022-korean-grade-4.json` | NCIC 별책 5 (국어) PDF | 228 |
| `kr2022-history-grade-4.json` | NCIC 별책 7 (사회) PDF | 348 |

## Rebuild from upstream

```bash
# Download KR PDFs if missing (NCIC)
curl -L -o imports/kr-korean-2022.pdf \
  'https://ncic.re.kr/inv/org/download.do?year=2022&seq=10003553&orgType=ogi4'
curl -L -o imports/kr-social-2022.pdf \
  'https://ncic.re.kr/inv/org/download.do?year=2022&seq=10003800&orgType=ogi4'

python3 scripts/extract-kr-official.py
npx tsx scripts/build-official-catalogs.ts
npm run test:seed
```

## Ad-hoc CSV/JSON import

```bash
npm run import:pack -- --in imports/catalog.csv --out prisma/seed/x.json \
  --code x --name X --subject MATH --region US-CCSS
```

CSV columns: `grade,domainCode,domainTitle,conceptCode,conceptTitle,skillCode,skillTitle,summary,objective,mastery,bloom`

## Notes

- Domain/concept codes are grade-scoped (`4:RL.4`) so codes stay unique across the pack; **skill codes** keep official identifiers (`RL.4.1`, `4-PS3-1`, `[4국01-01]`).
- `custom-acme-sel.json` remains a private sample pack.
- PDFs under `imports/` are build inputs (large); extracted JSON sidecars can be committed for reproducible builds without re-downloading.
