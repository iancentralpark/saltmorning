-- Online LMS video lessons (Phase 5)
-- Videos live in Cloudflare Stream. Only the video uid and metadata are stored here.

CREATE TABLE IF NOT EXISTS salt_morning.lms_lessons (
  id               TEXT PRIMARY KEY,
  class_id         TEXT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  provider         TEXT NOT NULL DEFAULT 'cloudflare',
  video_uid        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'uploading',
  status_message   TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  order_index      INTEGER NOT NULL DEFAULT 0,
  published        BOOLEAN NOT NULL DEFAULT false,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_lms_lessons_class_idx
  ON salt_morning.lms_lessons (class_id, order_index, created_at);

CREATE TABLE IF NOT EXISTS salt_morning.lms_progress (
  lesson_id        TEXT NOT NULL REFERENCES salt_morning.lms_lessons(id) ON DELETE CASCADE,
  student_id       TEXT NOT NULL,
  student_name     TEXT NOT NULL DEFAULT '',
  class_id         TEXT NOT NULL,
  last_position    INTEGER NOT NULL DEFAULT 0,
  watched_seconds  INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);

CREATE INDEX IF NOT EXISTS sm_lms_progress_student_idx
  ON salt_morning.lms_progress (student_id, class_id);
