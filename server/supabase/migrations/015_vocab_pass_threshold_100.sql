-- Default daily quest pass threshold: perfect score only.
ALTER TABLE vocab_class_settings
  ALTER COLUMN pass_threshold SET DEFAULT 100;

UPDATE vocab_class_settings
SET pass_threshold = 100
WHERE pass_threshold IS DISTINCT FROM 100;
