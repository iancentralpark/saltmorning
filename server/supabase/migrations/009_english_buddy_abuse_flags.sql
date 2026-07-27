-- Virtual Mr. Park abuse / AI-dependency warning flags for teacher alerts
CREATE TABLE IF NOT EXISTS english_buddy_abuse_flags (
  id           TEXT PRIMARY KEY,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id   TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  status       TEXT NOT NULL DEFAULT 'AI_DEPENDENCY_WARNING'
               CHECK (status IN ('AI_DEPENDENCY_WARNING', 'REVIEWED')),
  reasons      TEXT NOT NULL DEFAULT '[]',
  metrics      TEXT NOT NULL DEFAULT '{}',
  flagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS english_buddy_abuse_class_flagged_idx
  ON english_buddy_abuse_flags (class_id, flagged_at DESC);

CREATE INDEX IF NOT EXISTS english_buddy_abuse_student_idx
  ON english_buddy_abuse_flags (student_id, flagged_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS english_buddy_abuse_open_unique_idx
  ON english_buddy_abuse_flags (class_id, student_id)
  WHERE status = 'AI_DEPENDENCY_WARNING';

ALTER TABLE english_buddy_abuse_flags ENABLE ROW LEVEL SECURITY;
