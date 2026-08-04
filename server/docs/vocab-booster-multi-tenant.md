# Vocab Booster Platform — Multi-Tenant Architecture

Goal: one central Vocab Booster that any school website can attach, with
**central control of the product + word bank**, while each school (tenant)
only sees and manages **its own students’ progress**.

```
                    ┌──────────────────────────────┐
                    │   Vocab Booster Central      │
                    │                              │
                    │  • Global word bank          │
                    │  • Placement / SRS / quests   │
                    │  • Tenant registry           │
                    │  • Central admin console     │
                    │  • Public API + embed SDK    │
                    └──────────────┬───────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
     Mr. Park App           Salt Morning            School B site
     tenant=mrpark        tenant=salt-morning       tenant=school-b
     (own students)         (own students)          (own students)
```

## Principles

1. **Tenant isolation is mandatory**  
   Every progress row is keyed by `(tenant_id, external_student_id)`.  
   Raw host IDs like `S001` may collide across schools — never use them alone.

2. **Word bank is shared; progress is private**  
   `vocab_words` stays global (efficient, one source of truth).  
   `vocab_student_*` / `vocab_daily_*` / `vocab_class_settings` are tenant-scoped.

3. **Host apps stay thin**  
   A host site only needs to:
   - know its `tenant_id` + API key (or service JWT)
   - mint a short-lived **student session token** `{ tenantId, studentId, classId, name }`
   - mount the embed (`<script>` SDK or iframe)

4. **Central admin vs tenant admin**  
   - Platform owner: all tenants, word bank, generation jobs, billing later  
   - Tenant admin: only that tenant’s roster progress, class settings, overrides

5. **Feature flags per tenant**  
   e.g. `lucky_draw: true` (Mr. Park) / `false` (Morning Class), dollar adapter hooks.

## Data model (Phase 1)

```
vocab_tenants
  id            text PK   -- stable slug: mrpark | salt-morning | …
  name          text
  public_key    text      -- publishable id for embed boot
  secret_hash   text      -- server-side API secret (hashed)
  features      jsonb     -- { luckyDraw, dollarsMode, … }
  active        boolean

vocab_student_state
  PRIMARY KEY (tenant_id, student_id)
  student_id = host’s local id (NOT prefixed)

vocab_student_progress
  UNIQUE (tenant_id, student_id, word_id)

vocab_daily_progress
  UNIQUE (tenant_id, student_id, quest_date)

vocab_class_settings
  PRIMARY KEY (tenant_id, class_id)
```

Legacy `mc:` ID prefixes are migrated into `tenant_id = salt-morning` + bare `S001`.

## Attach flow for a new school (target UX)

1. Create tenant in central admin → get `public_key` + `secret`
2. On school site, after student login:

```html
<script src="https://vocab.example/embed.js"
        data-tenant-public-key="pk_live_…"
        data-session="SIGNED_JWT_FROM_YOUR_SERVER"></script>
<div id="vocab-booster-root"></div>
```

3. School server mints JWT with its secret:

```json
{ "tenantId": "school-b", "studentId": "STU-42", "classId": "G7-A", "name": "Mina" }
```

4. Embed talks only to central API; school never copies the word bank.

## API surface (v1)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/session` | Validate embed JWT → summary |
| GET | `/v1/placement/meta` | Placement config |
| POST | `/v1/placement/item` | Next adaptive item |
| POST | `/v1/placement/next` | Ability update |
| POST | `/v1/placement/score` | Persist placement |
| GET | `/v1/daily-queue` | Today’s SRS set |
| POST | `/v1/review` | Record card result |
| POST | `/v1/daily-test/submit` | Score set + rewards |
| GET | `/v1/admin/overview` | Tenant teacher overview |

All routes require tenant context (JWT or `Authorization: Bearer <tenant-secret>` for server-to-server).

## Rollout phases

| Phase | What | Status |
|-------|------|--------|
| **1** | `vocab_tenants` + `tenant_id` on progress tables; Mr.Park + Morning Class wired | **done** |
| **2** | Versioned `/api/vocab/v1` + tenant API secret + student session JWT | **this PR** |
| **3** | Embeddable JS widget (`/js/vocab-embed.js` + demo page) | **this PR** |
| **4** | Central admin UI (tenants, word bank, cross-tenant analytics) | later |
| **5** | Optional per-tenant word overlays / curriculum packs | later |

## Phase 2/3 — attach API (live on Mr. Park = central host)

### Host mint (server-to-server)

```http
POST /api/vocab/v1/session
Authorization: Bearer <tenant_api_secret>
X-Vocab-Tenant-Id: salt-morning
Content-Type: application/json

{ "studentId": "S001", "classId": "G7-A", "name": "Mina" }
```

Returns `{ token, expiresAt, session, tenant, summary }`.  
Store the plaintext secret only on the host (`VOCAB_TENANT_API_SECRET`); the DB keeps `secret_hash`.

### Embed

```html
<div id="vocab-booster-root"></div>
<script src="https://CENTRAL/js/vocab-embed.js"
        data-api-base="https://CENTRAL"
        data-session="TOKEN_FROM_MINT"
        async></script>
```

Demo page: `/vocab-embed-demo.html`  
Platform signing secret: `VOCAB_PLATFORM_SECRET` on the central service.  
CORS for arbitrary school sites: `VOCAB_EMBED_ORIGINS=*` (https origins).

Seed / rotate secrets: `node server/scripts/seed-vocab-tenant-secrets.js`

## Why this is efficient *and* safe

- **Efficient:** one word bank, one learning engine, one place to ship Placement/SRS fixes.
- **Safe:** tenant column enforces isolation (no more `S001` collisions across schools).
- **Stable:** host outages don’t corrupt other tenants; central schema changes are deliberate migrations.
- **Attachable:** a new school is config + JWT minting, not a code fork.

## Current apps mapping

| Host | `tenant_id` | Lucky Draw | Dollars |
|------|-------------|------------|---------|
| Mr. Park App | `mrpark` | on | Mr.Park dollarService |
| Salt Morning Class | `salt-morning` | off | Sheets dollarService |
| Future school | *(new slug)* | flag | adapter / none |
