-- Mr.Park Class — Supabase Phase 2b: homework + classroom map
-- Run in Supabase SQL Editor after 002_phase2_dollars_attendance.sql
-- Homework_Manual_Pending stays on Google Sheets for now.

-- ---------------------------------------------------------------------------
-- classroom_map (was Classroom_Map)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classroom_map (
  class_id    TEXT PRIMARY KEY REFERENCES classes(id) ON UPDATE CASCADE,
  course_id   TEXT NOT NULL DEFAULT '',
  course_name TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- homework_log (was Homework_Log)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- homework_items (was Homework_Items)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- homework_completion (was Homework_Completion)
-- ---------------------------------------------------------------------------
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
