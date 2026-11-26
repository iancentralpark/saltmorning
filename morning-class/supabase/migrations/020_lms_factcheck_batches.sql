-- Persist LMS lecture fact-check batches across process restarts.
CREATE TABLE IF NOT EXISTS salt_morning.lms_factcheck_batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  requested_mode TEXT NOT NULL DEFAULT 'smart',
  progress JSONB,
  items JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
