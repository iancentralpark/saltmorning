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

| File | Pack | Grade span | Skills |
|------|------|------------|--------|
| `ccss-math-grade-4.json` | CCSS Math (complete + Practices) | K–8, HS, MP | 525 |
| `ccss-ela-grade-4.json` | CCSS ELA/Literacy (complete) | K–12 | 1,019 |
| `ngss-science-grade-4.json` | NGSS Performance Expectations (complete) | K–5, MS, HS | 208 |
| `kr2022-korean-grade-4.json` | 2022 개정 국어 (초·중·고 선택) | 1–12 | 228 |
| `kr2022-history-grade-4.json` | 2022 개정 사회/역사 (초·중·고 선택) | 3–12 | 348 |
| `custom-acme-sel.json` | Acme Academy private SEL | 4–5 | 5 |

**Total: 2,333 skills.** Rebuild via `scripts/build-official-catalogs.ts` — see `OFFICIAL_IMPORT.md`.

## Content language

| Framework subject | Display language |
|-------------------|------------------|
| `KOREAN_LANGUAGE`, `KOREAN_HISTORY` | Korean (`titleKo` / `statementKo`) |
| All others (CCSS, NGSS, …) | English (`title` / `statement`) |

UI chrome is always English. Bilingual fields may still be stored for reference.
