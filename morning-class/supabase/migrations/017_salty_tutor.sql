-- Salty tutor chat for content-only classes (English / grammar help).
-- Text only is stored; voice audio is never persisted.

CREATE TABLE IF NOT EXISTS salt_morning.salty_tutor_messages (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS salty_tutor_messages_student_idx
  ON salt_morning.salty_tutor_messages (class_id, student_id, created_at);

CREATE INDEX IF NOT EXISTS salty_tutor_messages_class_idx
  ON salt_morning.salty_tutor_messages (class_id, created_at DESC);
