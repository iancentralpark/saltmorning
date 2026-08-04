-- Vocab Booster multi-tenant foundation (idempotent-ish, safe ordering)
-- 1) tenants  2) add nullable tenant_id  3) drop old uniques
-- 4) backfill + strip mc:  5) dedupe  6) new composite keys

CREATE TABLE IF NOT EXISTS vocab_tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  public_key    TEXT UNIQUE,
  secret_hash   TEXT,
  features      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vocab_tenants (id, name, public_key, features) VALUES
  ('mrpark', 'Mr. Park App', 'pk_mrpark', '{"luckyDraw": true, "dollarsMode": "native"}'::jsonb),
  ('salt-morning', 'Salt Morning Class', 'pk_salt_morning', '{"luckyDraw": false, "dollarsMode": "sheets"}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      features = EXCLUDED.features,
      updated_at = now();

-- Add columns (nullable first)
ALTER TABLE vocab_student_state ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE vocab_student_progress ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE vocab_daily_progress ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE vocab_class_settings ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Drop OLD uniqueness / PKs before rewriting ids (avoids mc:S001 -> S001 collisions)
ALTER TABLE vocab_student_state DROP CONSTRAINT IF EXISTS vocab_student_state_pkey;
ALTER TABLE vocab_student_progress DROP CONSTRAINT IF EXISTS vocab_student_progress_student_id_word_id_key;
ALTER TABLE vocab_daily_progress DROP CONSTRAINT IF EXISTS vocab_daily_progress_student_id_quest_date_key;
ALTER TABLE vocab_class_settings DROP CONSTRAINT IF EXISTS vocab_class_settings_pkey;

-- Also drop any already-created new constraints from a partial prior run
ALTER TABLE vocab_student_state DROP CONSTRAINT IF EXISTS vocab_student_state_pkey;
ALTER TABLE vocab_student_progress DROP CONSTRAINT IF EXISTS vocab_student_progress_tenant_student_word_key;
ALTER TABLE vocab_daily_progress DROP CONSTRAINT IF EXISTS vocab_daily_progress_tenant_student_date_key;

-- Backfill tenant + strip mc: prefix
UPDATE vocab_student_state SET
  tenant_id = CASE WHEN student_id LIKE 'mc:%' THEN 'salt-morning' ELSE COALESCE(tenant_id, 'mrpark') END,
  student_id = CASE WHEN student_id LIKE 'mc:%' THEN substr(student_id, 4) ELSE student_id END,
  class_id = CASE WHEN class_id LIKE 'mc:%' THEN substr(class_id, 4) ELSE class_id END;

UPDATE vocab_student_progress SET
  tenant_id = CASE WHEN student_id LIKE 'mc:%' THEN 'salt-morning' ELSE COALESCE(tenant_id, 'mrpark') END,
  student_id = CASE WHEN student_id LIKE 'mc:%' THEN substr(student_id, 4) ELSE student_id END,
  class_id = CASE WHEN class_id LIKE 'mc:%' THEN substr(class_id, 4) ELSE class_id END;

UPDATE vocab_daily_progress SET
  tenant_id = CASE WHEN student_id LIKE 'mc:%' THEN 'salt-morning' ELSE COALESCE(tenant_id, 'mrpark') END,
  student_id = CASE WHEN student_id LIKE 'mc:%' THEN substr(student_id, 4) ELSE student_id END,
  class_id = CASE WHEN class_id LIKE 'mc:%' THEN substr(class_id, 4) ELSE class_id END;

UPDATE vocab_class_settings SET
  tenant_id = CASE WHEN class_id LIKE 'mc:%' THEN 'salt-morning' ELSE COALESCE(tenant_id, 'mrpark') END,
  class_id = CASE WHEN class_id LIKE 'mc:%' THEN substr(class_id, 4) ELSE class_id END;

UPDATE vocab_student_state SET tenant_id = 'mrpark' WHERE tenant_id IS NULL;
UPDATE vocab_student_progress SET tenant_id = 'mrpark' WHERE tenant_id IS NULL;
UPDATE vocab_daily_progress SET tenant_id = 'mrpark' WHERE tenant_id IS NULL;
UPDATE vocab_class_settings SET tenant_id = 'mrpark' WHERE tenant_id IS NULL;

-- Dedupe (keep newest)
DELETE FROM vocab_student_state a USING vocab_student_state b
WHERE a.tenant_id = b.tenant_id AND a.student_id = b.student_id AND a.ctid < b.ctid;

DELETE FROM vocab_student_progress a USING vocab_student_progress b
WHERE a.tenant_id = b.tenant_id AND a.student_id = b.student_id AND a.word_id = b.word_id AND a.ctid < b.ctid;

DELETE FROM vocab_daily_progress a USING vocab_daily_progress b
WHERE a.tenant_id = b.tenant_id AND a.student_id = b.student_id AND a.quest_date = b.quest_date AND a.ctid < b.ctid;

DELETE FROM vocab_class_settings a USING vocab_class_settings b
WHERE a.tenant_id = b.tenant_id AND a.class_id = b.class_id AND a.ctid < b.ctid;

-- NOT NULL + defaults
ALTER TABLE vocab_student_state ALTER COLUMN tenant_id SET DEFAULT 'mrpark';
ALTER TABLE vocab_student_state ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vocab_student_progress ALTER COLUMN tenant_id SET DEFAULT 'mrpark';
ALTER TABLE vocab_student_progress ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vocab_daily_progress ALTER COLUMN tenant_id SET DEFAULT 'mrpark';
ALTER TABLE vocab_daily_progress ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE vocab_class_settings ALTER COLUMN tenant_id SET DEFAULT 'mrpark';
ALTER TABLE vocab_class_settings ALTER COLUMN tenant_id SET NOT NULL;

-- New composite keys
ALTER TABLE vocab_student_state ADD PRIMARY KEY (tenant_id, student_id);
ALTER TABLE vocab_student_progress
  ADD CONSTRAINT vocab_student_progress_tenant_student_word_key UNIQUE (tenant_id, student_id, word_id);
ALTER TABLE vocab_daily_progress
  ADD CONSTRAINT vocab_daily_progress_tenant_student_date_key UNIQUE (tenant_id, student_id, quest_date);
ALTER TABLE vocab_class_settings ADD PRIMARY KEY (tenant_id, class_id);

-- FKs to tenants
ALTER TABLE vocab_student_state DROP CONSTRAINT IF EXISTS vocab_student_state_tenant_id_fkey;
ALTER TABLE vocab_student_state
  ADD CONSTRAINT vocab_student_state_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES vocab_tenants(id) ON UPDATE CASCADE;

ALTER TABLE vocab_student_progress DROP CONSTRAINT IF EXISTS vocab_student_progress_tenant_id_fkey;
ALTER TABLE vocab_student_progress
  ADD CONSTRAINT vocab_student_progress_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES vocab_tenants(id) ON UPDATE CASCADE;

ALTER TABLE vocab_daily_progress DROP CONSTRAINT IF EXISTS vocab_daily_progress_tenant_id_fkey;
ALTER TABLE vocab_daily_progress
  ADD CONSTRAINT vocab_daily_progress_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES vocab_tenants(id) ON UPDATE CASCADE;

ALTER TABLE vocab_class_settings DROP CONSTRAINT IF EXISTS vocab_class_settings_tenant_id_fkey;
ALTER TABLE vocab_class_settings
  ADD CONSTRAINT vocab_class_settings_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES vocab_tenants(id) ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS vocab_student_state_tenant_class_idx
  ON vocab_student_state (tenant_id, class_id);
CREATE INDEX IF NOT EXISTS vocab_student_progress_tenant_due_idx
  ON vocab_student_progress (tenant_id, student_id, next_due_at);
CREATE INDEX IF NOT EXISTS vocab_daily_progress_tenant_class_date_idx
  ON vocab_daily_progress (tenant_id, class_id, quest_date DESC);
