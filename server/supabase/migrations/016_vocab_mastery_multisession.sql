-- Multi-set daily quests + mastery promotion support
ALTER TABLE vocab_class_settings
  ADD COLUMN IF NOT EXISTS max_daily_sessions INTEGER NOT NULL DEFAULT 3
    CHECK (max_daily_sessions BETWEEN 1 AND 5);

ALTER TABLE vocab_daily_progress
  ADD COLUMN IF NOT EXISTS sessions_completed INTEGER NOT NULL DEFAULT 0;
