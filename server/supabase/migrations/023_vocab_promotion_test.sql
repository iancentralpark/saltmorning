-- Restore / formalize Promotion Test (BO3) for multi-tenant shared engine
-- Live DB already has most columns; this migration is idempotent.

ALTER TABLE vocab_student_state
  ADD COLUMN IF NOT EXISTS promotion_test_status TEXT NOT NULL DEFAULT 'LOCKED',
  ADD COLUMN IF NOT EXISTS test_wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_test_unlocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promotion_test_notify_unlock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promotion_test_notify_retry BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE vocab_student_state
  DROP CONSTRAINT IF EXISTS vocab_student_state_promotion_test_status_check;

ALTER TABLE vocab_student_state
  ADD CONSTRAINT vocab_student_state_promotion_test_status_check
  CHECK (promotion_test_status IN ('LOCKED', 'AVAILABLE', 'IN_PROGRESS', 'PASSED', 'FAILED'));

CREATE TABLE IF NOT EXISTS vocab_promotion_test_rounds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL DEFAULT 'mrpark',
  student_id    TEXT NOT NULL,
  round_number  INTEGER NOT NULL CHECK (round_number >= 1 AND round_number <= 3),
  wins_before   INTEGER NOT NULL DEFAULT 0,
  losses_before INTEGER NOT NULL DEFAULT 0,
  grade_level   INTEGER,
  tier_name     TEXT,
  questions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers       JSONB,
  correct_count INTEGER,
  passed        BOOLEAN,
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at  TIMESTAMPTZ
);

ALTER TABLE vocab_promotion_test_rounds ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE vocab_promotion_test_rounds SET tenant_id = 'mrpark' WHERE tenant_id IS NULL;
ALTER TABLE vocab_promotion_test_rounds ALTER COLUMN tenant_id SET DEFAULT 'mrpark';
ALTER TABLE vocab_promotion_test_rounds ALTER COLUMN tenant_id SET NOT NULL;

-- Host apps (Morning Class) don't share Mr. Park students PK — drop FK if present.
ALTER TABLE vocab_promotion_test_rounds
  DROP CONSTRAINT IF EXISTS vocab_promotion_test_rounds_student_id_fkey;

CREATE INDEX IF NOT EXISTS vocab_promo_rounds_tenant_student_idx
  ON vocab_promotion_test_rounds (tenant_id, student_id, created_at DESC);

-- Backfill: anyone already at 400 (or was auto-promoted away) can be set by ops;
-- unlock anyone currently sitting at score >= 400.
UPDATE vocab_student_state
SET promotion_test_status = 'AVAILABLE',
    promotion_test_unlocked_at = COALESCE(promotion_test_unlocked_at, now()),
    promotion_test_notify_unlock = true,
    updated_at = now()
WHERE placement_at IS NOT NULL
  AND promotion_score >= 400
  AND promotion_test_status = 'LOCKED'
  AND COALESCE(grade_level, 1) < 12;
