# AGENTS.md

## Cursor Cloud specific instructions

This repo hosts several apps for Salt Academy / Mr. Park. Only the two Node
Express apps and the Python solver run locally; the root `Code.js` + `*.html`
and `_dollar_system/` are Google Apps Script projects that cannot run in this
environment (they deploy to Google via `clasp`). The `server/` Node API is the
local backend substitute for the root Apps Script UI.

### Services

| Service | Dir | Dev command | Port | Required creds to boot? |
|---------|-----|-------------|------|-------------------------|
| Mr. Park Class API + portals | `server/` | `npm run dev` | 8787 | No (see below) |
| Salt Morning Class portals | `morning-class/` | `npm run dev` | 8790 | No (see below) |
| Timetable solver (FastAPI + OR-Tools) | `morning-class/` | `npm run solver` | 8791 | No (optional service) |

Dev servers use `node --watch`, so they hot-reload on file changes. Health
checks: `GET /api/health` (both Node apps) and `GET /health` (solver).

### Non-obvious caveats

- Both Node apps **boot and serve their HTML pages without any credentials**;
  they only `console.warn` about missing Google/Supabase config. Any request
  that touches data (login, roster, attendance, vocab, messages) needs
  `GOOGLE_APPLICATION_CREDENTIALS` (a `server/service-account.json`) and/or
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Those secrets are not present in
  this environment, so expect data APIs to fail while the UI still renders.
- `.env` is **optional for local boot**: `src/config.js` in each app has default
  `PORT`/`SPREADSHEET_ID`. Copy `<app>/.env.example` to `<app>/.env` only when
  you need to set real credentials. `.env`, `service-account.json`, and
  `node_modules/` are gitignored.
- The timetable solver is only used by `/api/admin/timetable/*` in
  `morning-class`. The morning-class app runs fine without it.
- `server/` `npm start` runs a `prestart` hook (`scripts/build-public.js`) that
  regenerates `server/public/` from the repo-root Apps Script HTML. For local
  development use `npm run dev`, which serves the already-committed
  `server/public/` directly and skips that build step.
- There are **no automated tests and no lint/formatter configs** in this repo
  (no jest/mocha/vitest, no eslint/prettier, no CI). `npm run check-setup` in
  each Node app only validates that env/credentials are present.

### Setup references

- `server/README.md` and `server/SETUP-KO.md`: full server setup (Google Cloud
  service account, Supabase phases, Classroom OAuth).
- `server/docs/vocab-booster-multi-tenant.md`: shared multi-tenant Vocab Booster.
- Python solver deps: `morning-class/solver/requirements.txt`
  (`pip3 install -r morning-class/solver/requirements.txt`).
