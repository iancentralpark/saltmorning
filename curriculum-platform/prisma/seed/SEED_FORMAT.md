# Seed JSON format

Each curriculum pack file is a single JSON document:

```json
{
  "framework": { /* Framework fields */ },
  "tree": { /* CurriculumNode root with nested children */ }
}
```

## `framework`

| Field | Type | Maps to |
|-------|------|---------|
| `code` | string | `Framework.code` (unique) |
| `name` / `nameKo` | string | display names |
| `subject` | enum string | `FrameworkSubject` |
| `regionStandard` | string | e.g. `US-CCSS`, `KR-2022` |
| `version` | string | pack version |
| `description` | string? | |
| `organizationCode` | string? | Owning org for private packs (e.g. `acme-academy`) |
| `isPublic` | boolean? | Default `true` when unset / no owner; `false` for school-private |
| `metadata` | object? | `Json` — may include `ownerOrg`, `visibility` |

## `tree` / node

Recursive object:

| Field | Type | Maps to |
|-------|------|---------|
| `nodeType` | `ROOT` \| `GRADE` \| `DOMAIN` \| `CONCEPT` \| `SKILL` \| `CUSTOM` | `CurriculumNodeType` |
| `code` | string? | standard / achievement code |
| `title` / `titleKo` | string | |
| `gradeLevel` | string? | `"4"`, `"K"`, `"6-8"`… |
| `summary` | string? | |
| `sortOrder` | number | |
| `metadata` | object? | |
| `objectives` | array? | → `LearningObjective` (usually on `SKILL`) |
| `resources` | array? | → `Resource` |
| `children` | array? | nested nodes |

## Files in this folder

| File | Pack | Grade span | ~Skills |
|------|------|------------|---------|
| `ccss-math-grade-4.json` | Common Core Math · K–8 + HS Algebra/Geometry/Stats | K–8, HS | ~106 |
| `ccss-ela-grade-4.json` | Common Core ELA · RL/RI/RF/W/SL/L | K–8, 9–10, 11–12 | ~144 |
| `ngss-science-grade-4.json` | NGSS Science · Physical/Life/Earth/ETS | K–8, HS | ~95 |
| `kr2022-korean-grade-4.json` | 2022 개정 국어 · 듣기·말하기/읽기/쓰기/문법/문학 | 1–9 | ~111 |
| `kr2022-history-grade-4.json` | 2022 개정 한국사/사회 · 지리·역사·일반사회 | 3–9 | ~72 |
| `custom-acme-sel.json` | Acme Academy private SEL pack (`organizationCode: acme-academy`) | 4–5 | 5 |

**Total public sample coverage:** ~528 skills across 5 frameworks (plus 5 private SEL).  
Expand further with `scripts/expand-full-curriculum.ts`. See `OFFICIAL_IMPORT.md` for denser official catalog imports.

## Content language

| Framework subject | Display language |
|-------------------|------------------|
| `KOREAN_LANGUAGE`, `KOREAN_HISTORY` | Korean (`titleKo` / `statementKo`) |
| All others (CCSS, NGSS, …) | English (`title` / `statement`) |

UI chrome is always English. Bilingual fields may still be stored for reference.
