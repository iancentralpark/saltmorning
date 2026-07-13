-- English Buddy chat history (per student, retained ~7 days on server)
CREATE TABLE IF NOT EXISTS english_buddy_messages (
  id          TEXT PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS english_buddy_student_created_idx
  ON english_buddy_messages (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS english_buddy_class_student_idx
  ON english_buddy_messages (class_id, student_id, created_at DESC);

ALTER TABLE english_buddy_messages ENABLE ROW LEVEL SECURITY;
