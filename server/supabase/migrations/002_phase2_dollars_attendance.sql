-- Mr.Park Class — Supabase Phase 2a: dollars + attendance
-- Run in Supabase SQL Editor after 001_phase1.sql

-- ---------------------------------------------------------------------------
-- dollar_balances (was Dollar_Balances)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dollar_balances (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON UPDATE CASCADE,
  balance    NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- dollar_transactions (was Dollar_Transactions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dollar_transactions (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  class_id    TEXT REFERENCES classes(id) ON UPDATE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  amount      NUMERIC NOT NULL,
  new_balance NUMERIC NOT NULL,
  reason      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS dollar_transactions_student_idx
  ON dollar_transactions (student_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- attendance_records (was Attendance_Data)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
  id           BIGSERIAL PRIMARY KEY,
  record_date  DATE NOT NULL,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  attendance   TEXT NOT NULL DEFAULT '',
  vocab_score  NUMERIC,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_unique UNIQUE (record_date, class_id, student_id)
);

CREATE INDEX IF NOT EXISTS attendance_records_class_date_idx
  ON attendance_records (class_id, record_date);

DROP TRIGGER IF EXISTS attendance_records_updated_at ON attendance_records;
CREATE TRIGGER attendance_records_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE dollar_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE dollar_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
