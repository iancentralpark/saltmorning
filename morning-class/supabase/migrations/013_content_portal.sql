-- Content-only class portal: per-student targeting for Oral Debrief + LMS lessons,
-- and portal_mode / content_flags on salt_morning.classes (roster Postgres bridge).
-- rosterBridge.js also ADD COLUMN IF NOT EXISTS these on first read/write.

ALTER TABLE salt_morning.classes
  ADD COLUMN IF NOT EXISTS portal_mode TEXT NOT NULL DEFAULT 'full';

ALTER TABLE salt_morning.classes
  ADD COLUMN IF NOT EXISTS content_flags TEXT NOT NULL DEFAULT '';

-- Empty target set = legacy "whole class". Non-empty = only listed students see it.
CREATE TABLE IF NOT EXISTS salt_morning.debrief_assignment_students (
  assignment_id TEXT NOT NULL REFERENCES salt_morning.debrief_assignments(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS sm_debrief_asg_student_idx
  ON salt_morning.debrief_assignment_students (student_id);

CREATE TABLE IF NOT EXISTS salt_morning.lms_lesson_students (
  lesson_id   TEXT NOT NULL REFERENCES salt_morning.lms_lessons(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, student_id)
);
CREATE INDEX IF NOT EXISTS sm_lms_lesson_student_idx
  ON salt_morning.lms_lesson_students (student_id);
