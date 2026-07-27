-- Advanced abuse flag fields for teacher alerts
ALTER TABLE english_buddy_abuse_flags
  ADD COLUMN IF NOT EXISTS abuse_type TEXT,
  ADD COLUMN IF NOT EXISTS alert_message TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT,
  ADD COLUMN IF NOT EXISTS sample_text TEXT;

CREATE INDEX IF NOT EXISTS english_buddy_abuse_type_idx
  ON english_buddy_abuse_flags (class_id, abuse_type, flagged_at DESC);
