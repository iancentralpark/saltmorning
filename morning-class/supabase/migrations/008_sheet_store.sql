-- Generic Postgres stand-in for remaining Google Sheets tabs.
-- Typed domains (grades / roster / dollars / attendance / messenger / bus logs)
-- keep their own tables; this store covers everything else and also acts as
-- a Sheets-API compatible fallback so Google is no longer required at runtime.

CREATE TABLE IF NOT EXISTS salt_morning.sheet_tabs (
  sheet_name  TEXT PRIMARY KEY,
  headers     JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salt_morning.sheet_rows (
  id          BIGSERIAL PRIMARY KEY,
  sheet_name  TEXT NOT NULL REFERENCES salt_morning.sheet_tabs(sheet_name) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  cells       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_sheet_rows_sheet_sort_idx
  ON salt_morning.sheet_rows (sheet_name, sort_order, id);
