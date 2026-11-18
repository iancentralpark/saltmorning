-- Oral Novel Debrief — student oral sessions (Phase 3)
-- Audio is NOT stored; only the text transcript of each turn.

CREATE TABLE IF NOT EXISTS salt_morning.debrief_sessions (
  id             TEXT PRIMARY KEY,
  assignment_id  TEXT NOT NULL REFERENCES salt_morning.debrief_assignments(id) ON DELETE CASCADE,
  book_id        TEXT NOT NULL,
  class_id       TEXT NOT NULL,
  student_id     TEXT NOT NULL,
  student_name   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  turns          JSONB NOT NULL DEFAULT '[]'::jsonb,
  plan_asked     INTEGER NOT NULL DEFAULT 0,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_debrief_sessions_unique_idx
  ON salt_morning.debrief_sessions (assignment_id, student_id);

CREATE INDEX IF NOT EXISTS sm_debrief_sessions_class_idx
  ON salt_morning.debrief_sessions (class_id, updated_at DESC);
