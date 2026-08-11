# Operations runbook (external credentials & hosts)

## Production URLs

| App | URL |
|-----|-----|
| **CurricuMap (live)** | https://curricumap-production.up.railway.app |
| Health | https://curricumap-production.up.railway.app/api/health |
| Railway project | https://railway.com/project/b110a25c-5edc-4f01-bd78-1f4f405b5ab9 |

Redeploy from `curriculum-platform/`:

```bash
bash scripts/railway-deploy.sh
# or
npx @railway/cli up --detach
```

In-app product work is complete in `ROADMAP.md`. Items below need human ops / console access for optional integrations.

## OAuth providers

| Provider | Env vars | Notes |
|----------|----------|-------|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Redirect → `https://curricumap-production.up.railway.app/api/auth/google/callback` |
| Microsoft Entra | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` | Redirect → `.../api/auth/microsoft/callback` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_REDIRECT_URI` | `.p8` key; rotate periodically; redirect → `.../api/auth/apple/callback` (form_post) |

Shared: `AUTH_SECRET`, `OAUTH_DEFAULT_ORG`, `OAUTH_EMAIL_ORG_MAP`, optional `AUTH_REQUIRED=1`, `DEMO_LOGIN_DISABLED=1`.

## Calendar cron

| Host | Endpoint | Secret |
|------|----------|--------|
| Salt Morning | `POST /api/internal/curriculum-map/sync-calendar-cron` | `CRON_SECRET` |
| CurricuMap | `POST /api/cron/calendar-sync` | `CRON_SECRET` (+ optional `SALT_MORNING_URL`) |

Salt Morning also needs Google Calendar service account JSON for KR holidays.

Point Salt Morning at CurricuMap:

```
CURRICULUM_MAP_URL=https://curricumap-production.up.railway.app
CURRICULUM_MAP_API_KEY=<same as CurricuMap PORTAL_API_KEY>
CURRICULUM_MAP_ORG_CODE=salt-morning
```

## Portal

- `PORTAL_API_KEY` on CurricuMap; same value as `CURRICULUM_MAP_API_KEY` on Salt Morning
- Optional `PORTAL_REQUIRE_ORG=1` to require `x-organization-code`

## Official catalog import

```bash
npx tsx scripts/import-official-pack.ts --in imports/your.csv --out prisma/seed/your.json \
  --code your-code --name "Your Pack" --subject MATH --region US-CCSS
npm run test:seed
```

See `prisma/seed/OFFICIAL_IMPORT.md`.
