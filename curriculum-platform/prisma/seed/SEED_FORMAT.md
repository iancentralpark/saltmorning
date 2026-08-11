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

| File | Pack |
|------|------|
| `ccss-math-grade-4.json` | Common Core Math · Grade 4 sample |
| `kr2022-korean-grade-4.json` | 2022 개정 국어 · 초4 sample (+ CUSTOM school node) |
| `ngss-science-grade-4.json` | NGSS Science · Grade 4 sample (energy + ESS slice) |
| `kr2022-history-grade-4.json` | 2022 개정 한국사(초등 사회 연계) · 초4 sample (+ CUSTOM) |
| `ccss-ela-grade-4.json` | Common Core ELA · Grade 4 sample (RL + W) |
| `ccss-math-grade-5.json` | Common Core Math · Grade 5 sample (5.NBT) |
| `custom-acme-sel.json` | Acme Academy private SEL pack (`organizationCode: acme-academy`) |

## Content language

| Framework subject | Display language |
|-------------------|------------------|
| `KOREAN_LANGUAGE`, `KOREAN_HISTORY` | Korean (`titleKo` / `statementKo`) |
| All others (CCSS, NGSS, …) | English (`title` / `statement`) |

UI chrome is always English. Bilingual fields may still be stored for reference.
