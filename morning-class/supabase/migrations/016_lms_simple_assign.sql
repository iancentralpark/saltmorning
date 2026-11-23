-- Online Lessons: per-student assignments with their own due date, soft unassign,
-- real play-time tracking, and a per-class default due window.

-- Each row is one student's assignment of one class video.
-- created_at doubles as "assigned at". removed_at set = taken back (watch history kept).
ALTER TABLE salt_morning.lms_lesson_students
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

ALTER TABLE salt_morning.lms_lesson_students
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ;

ALTER TABLE salt_morning.lms_lesson_students
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- Existing targeted assignments inherit the schedule that was set on the class video.
UPDATE salt_morning.lms_lesson_students s
   SET due_at = l.due_at
  FROM salt_morning.lms_lessons l
 WHERE l.id = s.lesson_id AND s.due_at IS NULL AND l.due_at IS NOT NULL;

UPDATE salt_morning.lms_lesson_students s
   SET available_from = l.available_from
  FROM salt_morning.lms_lessons l
 WHERE l.id = s.lesson_id AND s.available_from IS NULL AND l.available_from IS NOT NULL;

-- played_seconds: video seconds actually played (rewatching counts again).
-- played_wall_seconds: the same play time divided by playback speed.
-- coverage: one character per second of video, '1' = that second was played.
-- wall_credit: seconds of play time the next report may still claim (earned in real time).
ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS played_seconds REAL NOT NULL DEFAULT 0;

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS played_wall_seconds REAL NOT NULL DEFAULT 0;

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT '';

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS completed_manually BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS wall_credit REAL NOT NULL DEFAULT 30;

-- Older rows only know the furthest point reached. Treat that stretch as watched so
-- nobody's visible progress drops when the stricter tracking starts.
UPDATE salt_morning.lms_progress
   SET coverage = repeat('1', LEAST(watched_seconds, 43200))
 WHERE coverage = '' AND watched_seconds > 0;

CREATE TABLE IF NOT EXISTS salt_morning.lms_class_settings (
  class_id         TEXT PRIMARY KEY,
  default_due_days INTEGER NOT NULL DEFAULT 7,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
