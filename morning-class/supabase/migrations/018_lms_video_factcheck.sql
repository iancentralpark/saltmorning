-- Optional columns for LMS library video Gemini fact-check reports.
-- Also applied at runtime via ALTER IF NOT EXISTS in lmsVideoFactcheckService.

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS factcheck_json JSONB;

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS factcheck_at TIMESTAMPTZ;

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS factcheck_status TEXT;
