-- Mr.Park Class — Supabase Phase 3 (remaining main spreadsheet tabs)
-- Run after 002_phase2_all.sql
-- Class log (separate spreadsheet) stays on Google Sheets for now.

-- ---------------------------------------------------------------------------
-- students_withdrawn
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students_withdrawn (
  withdrawal_id    TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  class_id         TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  login_id         TEXT NOT NULL DEFAULT '',
  login_password   TEXT NOT NULL DEFAULT '',
  previous_status  TEXT NOT NULL DEFAULT '',
  withdrawn_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS students_withdrawn_class_idx ON students_withdrawn (class_id);

-- ---------------------------------------------------------------------------
-- student_leaves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_leaves (
  leave_id    TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  class_id    TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'Active',
  created_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS student_leaves_class_idx ON student_leaves (class_id, status);

-- ---------------------------------------------------------------------------
-- student_planned_attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_planned_attendance (
  notice_id    TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  notice_date  DATE NOT NULL,
  notice_type  TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS student_planned_attendance_class_date_idx
  ON student_planned_attendance (class_id, notice_date);

-- ---------------------------------------------------------------------------
-- homework_manual_pending
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS homework_manual_pending (
  pending_id   TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ,
  fix_note     TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------------------
-- textbooks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_textbooks (
  textbook_id   TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  book_type     TEXT NOT NULL DEFAULT '',
  unit_type     TEXT NOT NULL DEFAULT 'chapter',
  total_units   INTEGER NOT NULL DEFAULT 0,
  start_date    DATE,
  status        TEXT NOT NULL DEFAULT 'Active',
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS textbook_progress (
  id           BIGSERIAL PRIMARY KEY,
  record_date  DATE NOT NULL,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  textbook_id  TEXT NOT NULL REFERENCES class_textbooks(textbook_id) ON DELETE CASCADE,
  position     NUMERIC NOT NULL DEFAULT 0,
  CONSTRAINT textbook_progress_unique UNIQUE (record_date, class_id, textbook_id)
);

CREATE TABLE IF NOT EXISTS textbook_queue (
  queue_id     TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  name         TEXT NOT NULL DEFAULT '',
  book_type    TEXT NOT NULL DEFAULT '',
  unit_type    TEXT NOT NULL DEFAULT 'chapter',
  total_units  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- sidebar / library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_rules (
  class_id    TEXT PRIMARY KEY REFERENCES classes(id) ON UPDATE CASCADE,
  rules       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS library_books (
  book_id      TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'Pending',
  created_at   TIMESTAMPTZ,
  returned_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS class_announcements (
  class_id    TEXT PRIMARY KEY REFERENCES classes(id) ON UPDATE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS class_events (
  event_id     TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  event_date   DATE NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS class_video (
  class_id    TEXT PRIMARY KEY,
  video_url   TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- chambit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chambit_daily (
  record_date  DATE NOT NULL,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  PRIMARY KEY (record_date, class_id, student_id)
);

CREATE TABLE IF NOT EXISTS chambit_combo (
  student_id   TEXT PRIMARY KEY REFERENCES students(id) ON UPDATE CASCADE,
  combo_count  INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chambit_week_awards (
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  week_key     TEXT NOT NULL,
  awarded_at   TIMESTAMPTZ,
  PRIMARY KEY (student_id, week_key)
);

-- ---------------------------------------------------------------------------
-- lucky draw
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lucky_draw_tiers (
  tier_id     TEXT PRIMARY KEY,
  tier_name   TEXT NOT NULL DEFAULT '',
  weight      NUMERIC NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lucky_draw_prizes (
  tier_id      TEXT NOT NULL REFERENCES lucky_draw_tiers(tier_id) ON DELETE CASCADE,
  prize_text   TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (tier_id, sort_order)
);

CREATE TABLE IF NOT EXISTS lucky_draw_tickets (
  ticket_id    TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  tier         TEXT NOT NULL DEFAULT '',
  prize_text   TEXT NOT NULL DEFAULT '',
  drawn_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- makeup lessons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS makeup_lessons (
  makeup_id     TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  student_name  TEXT NOT NULL DEFAULT '',
  lesson_date   DATE NOT NULL,
  lesson_time   TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'Scheduled',
  created_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS makeup_lessons_class_date_idx ON makeup_lessons (class_id, lesson_date);

-- ---------------------------------------------------------------------------
-- triggers + RLS
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS class_textbooks_updated_at ON class_textbooks;
CREATE TRIGGER class_textbooks_updated_at
  BEFORE UPDATE ON class_textbooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE students_withdrawn ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_planned_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE homework_manual_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbook_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_video ENABLE ROW LEVEL SECURITY;
ALTER TABLE chambit_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE chambit_combo ENABLE ROW LEVEL SECURITY;
ALTER TABLE chambit_week_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE lucky_draw_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lucky_draw_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lucky_draw_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE makeup_lessons ENABLE ROW LEVEL SECURITY;
