-- Mr.Park Class — Supabase Phase 2 (run after 001_phase1.sql)
-- Combines 002_phase2_dollars_attendance.sql + 003_phase2_homework.sql

-- ---------------------------------------------------------------------------
-- dollar_balances (was Dollar_Balances)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dollar_balances (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON UPDATE CASCADE,
  balance    NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ---------------------------------------------------------------------------
-- classroom_map + homework (was Classroom_Map, Homework_* sheets)
-- Homework_Manual_Pending stays on Google Sheets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classroom_map (
  class_id    TEXT PRIMARY KEY REFERENCES classes(id) ON UPDATE CASCADE,
  course_id   TEXT NOT NULL DEFAULT '',
  course_name TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS homework_log (
  homework_id        TEXT PRIMARY KEY,
  class_id           TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  assigned_date      DATE NOT NULL,
  title              TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  classroom_work_id  TEXT NOT NULL DEFAULT '',
  posted_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS homework_log_class_date_idx
  ON homework_log (class_id, assigned_date DESC);

CREATE TABLE IF NOT EXISTS homework_items (
  item_id              TEXT PRIMARY KEY,
  homework_id          TEXT NOT NULL REFERENCES homework_log(homework_id) ON DELETE CASCADE,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  title                TEXT NOT NULL DEFAULT '',
  description          TEXT NOT NULL DEFAULT '',
  target_student_ids   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS homework_items_homework_idx
  ON homework_items (homework_id, sort_order);

CREATE TABLE IF NOT EXISTS homework_completion (
  item_id       TEXT NOT NULL REFERENCES homework_items(item_id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  completed     BOOLEAN NOT NULL DEFAULT false,
  completed_at  TIMESTAMPTZ,
  fix_note      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (item_id, student_id)
);

CREATE INDEX IF NOT EXISTS homework_completion_student_idx
  ON homework_completion (student_id);

DROP TRIGGER IF EXISTS classroom_map_updated_at ON classroom_map;
CREATE TRIGGER classroom_map_updated_at
  BEFORE UPDATE ON classroom_map
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS homework_log_updated_at ON homework_log;
CREATE TRIGGER homework_log_updated_at
  BEFORE UPDATE ON homework_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE classroom_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_completion ENABLE ROW LEVEL SECURITY;
