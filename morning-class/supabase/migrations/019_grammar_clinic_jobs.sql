-- Persist grammar clinic exam generate jobs across process restarts.
CREATE TABLE IF NOT EXISTS salt_morning.grammar_clinic_jobs (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  progress JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_grammar_clinic_jobs_updated_idx
  ON salt_morning.grammar_clinic_jobs (updated_at DESC);
