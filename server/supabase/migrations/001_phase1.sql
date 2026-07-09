-- Mr.Park Class — Supabase Phase 1
-- Tables: classes, students, messages
-- Run in Supabase Dashboard → SQL Editor (project: tedzjzntesjslpiefbbi)
--
-- Phase 1 scope (Supabase = source of truth):
--   • Class_List      → classes
--   • Student_List    → students (bcrypt passwords)
--   • Student_Messages → messages
-- Everything else stays on Google Sheets until Phase 2+.

-- ---------------------------------------------------------------------------
-- classes (was Class_List sheet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  schedule_type TEXT,
  allowed_days  INTEGER[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- students (was Student_List sheet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  status        TEXT NOT NULL DEFAULT 'Enrolled',
  login_id      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT students_status_check CHECK (status IN ('Enrolled', 'Withdrawn', 'Inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS students_login_id_unique ON students (lower(login_id));
CREATE INDEX IF NOT EXISTS students_class_id_idx ON students (class_id);

-- ---------------------------------------------------------------------------
-- messages (was Student_Messages sheet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  student_name TEXT NOT NULL DEFAULT '',
  sender       TEXT NOT NULL,
  body         TEXT NOT NULL,
  read_at      TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT messages_sender_check CHECK (sender IN ('student', 'teacher'))
);

CREATE INDEX IF NOT EXISTS messages_thread_idx
  ON messages (class_id, student_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_inbox_idx
  ON messages (created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_updated_at ON classes;
CREATE TRIGGER classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime (optional — enable after import for live message updates)
-- Dashboard → Database → Replication → add `messages` to supabase_realtime
-- Or uncomment:
-- ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ---------------------------------------------------------------------------
-- RLS: server uses service_role key (bypasses RLS). Lock down if adding client access later.
-- ---------------------------------------------------------------------------
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
