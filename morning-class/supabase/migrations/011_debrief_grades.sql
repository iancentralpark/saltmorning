-- Oral Novel Debrief — rubric grade per session (Phase 4)
-- AI drafts a grade; a teacher must release it before the student can see it.

ALTER TABLE salt_morning.debrief_sessions ADD COLUMN IF NOT EXISTS grade JSONB;
ALTER TABLE salt_morning.debrief_sessions ADD COLUMN IF NOT EXISTS grade_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE salt_morning.debrief_sessions ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;
ALTER TABLE salt_morning.debrief_sessions ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ
