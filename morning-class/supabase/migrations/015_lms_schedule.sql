-- Online Lessons Phase 1: scheduled unlock + due dates for class assignments.
-- available_from NULL = visible as soon as published.
-- due_at NULL = no deadline.

ALTER TABLE salt_morning.lms_lessons
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ;

ALTER TABLE salt_morning.lms_lessons
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sm_lms_lessons_schedule_idx
  ON salt_morning.lms_lessons (class_id, available_from, due_at);
