-- Durable Novel Study workbook jobs (survive Railway deploys; /tmp alone does not).
CREATE TABLE IF NOT EXISTS salt_morning.novel_study_jobs (
  id               TEXT PRIMARY KEY,
  teacher_id       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ready',
  progress         INTEGER NOT NULL DEFAULT 0,
  message          TEXT NOT NULL DEFAULT '',
  error            TEXT,
  meta             JSONB,
  options          JSONB,
  page_count       INTEGER NOT NULL DEFAULT 0,
  chunks           JSONB NOT NULL DEFAULT '[]'::jsonb,
  parts            JSONB NOT NULL DEFAULT '[]'::jsonb,
  culminating      JSONB,
  google_docs_url  TEXT,
  has_docx         BOOLEAN NOT NULL DEFAULT false,
  docx             BYTEA,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_novel_study_jobs_teacher_updated_idx
  ON salt_morning.novel_study_jobs (teacher_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS sm_novel_study_jobs_updated_idx
  ON salt_morning.novel_study_jobs (updated_at);