-- Keep the uploaded text only while a profile is still being built,
-- so a failed or interrupted job can start again. Cleared when the draft is ready.

ALTER TABLE salt_morning.debrief_books
  ADD COLUMN IF NOT EXISTS source_text TEXT NOT NULL DEFAULT '';

ALTER TABLE salt_morning.debrief_books
  ADD COLUMN IF NOT EXISTS auto_retries INTEGER NOT NULL DEFAULT 0;
