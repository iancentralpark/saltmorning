-- Allow Salt Morning Class (and other apps) to share vocab_* tables
-- without requiring rows in Mr. Park's students/classes tables.
-- Word bank + progress remain in the same Supabase project.

ALTER TABLE IF EXISTS vocab_student_state
  DROP CONSTRAINT IF EXISTS vocab_student_state_student_id_fkey;

ALTER TABLE IF EXISTS vocab_student_progress
  DROP CONSTRAINT IF EXISTS vocab_student_progress_student_id_fkey;

ALTER TABLE IF EXISTS vocab_daily_progress
  DROP CONSTRAINT IF EXISTS vocab_daily_progress_student_id_fkey;

ALTER TABLE IF EXISTS vocab_class_settings
  DROP CONSTRAINT IF EXISTS vocab_class_settings_class_id_fkey;
