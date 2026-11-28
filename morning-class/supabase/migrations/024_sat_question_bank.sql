-- SAT question bank: PDF import jobs, the questions converted from them, and their figures.
-- The uploaded PDF is kept in sat_import_chunks so a job survives a restart and the
-- review screen can always show the original page next to the converted question.

CREATE TABLE IF NOT EXISTS salt_morning.sat_import_jobs (
  id              TEXT PRIMARY KEY,
  filename        TEXT NOT NULL DEFAULT '',
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  chunk_size      INTEGER NOT NULL DEFAULT 0,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'uploading',
  status_message  TEXT NOT NULL DEFAULT '',
  page_count      INTEGER NOT NULL DEFAULT 0,
  pages_scanned   INTEGER NOT NULL DEFAULT 0,
  split_mode      TEXT NOT NULL DEFAULT '',
  sample_passed   BOOLEAN NOT NULL DEFAULT false,
  model           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_sat_import_jobs_created_idx
  ON salt_morning.sat_import_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS salt_morning.sat_import_chunks (
  job_id  TEXT NOT NULL REFERENCES salt_morning.sat_import_jobs(id) ON DELETE CASCADE,
  idx     INTEGER NOT NULL,
  data    BYTEA NOT NULL,
  PRIMARY KEY (job_id, idx)
);

-- PDF bytes do not compress, so skip the attempt.
ALTER TABLE salt_morning.sat_import_chunks ALTER COLUMN data SET STORAGE EXTERNAL;

-- One unit is the page range of one question (or a window of pages when the PDF has no
-- question markers). Units are converted independently so a job can stop and continue.
CREATE TABLE IF NOT EXISTS salt_morning.sat_import_units (
  job_id          TEXT NOT NULL REFERENCES salt_morning.sat_import_jobs(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  page_from       INTEGER NOT NULL,
  page_to         INTEGER NOT NULL,
  context_to      INTEGER NOT NULL DEFAULT 0,
  source_id       TEXT NOT NULL DEFAULT '',
  in_sample       BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  question_count  INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, idx)
);

CREATE INDEX IF NOT EXISTS sm_sat_import_units_status_idx
  ON salt_morning.sat_import_units (job_id, status, idx);

CREATE TABLE IF NOT EXISTS salt_morning.sat_questions (
  id                TEXT PRIMARY KEY,
  source_id         TEXT NOT NULL DEFAULT '',
  import_job_id     TEXT,
  unit_idx          INTEGER,
  page_from         INTEGER,
  page_to           INTEGER,
  section           TEXT NOT NULL DEFAULT '',
  domain            TEXT NOT NULL DEFAULT '',
  skill             TEXT NOT NULL DEFAULT '',
  difficulty        TEXT NOT NULL DEFAULT '',
  qtype             TEXT NOT NULL DEFAULT 'mcq',
  passage           TEXT NOT NULL DEFAULT '',
  stem              TEXT NOT NULL DEFAULT '',
  choices           JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer            TEXT NOT NULL DEFAULT '',
  accepted_answers  JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale         TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'review',
  flags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_facts      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes             TEXT NOT NULL DEFAULT '',
  edited            BOOLEAN NOT NULL DEFAULT false,
  reviewed_by       TEXT NOT NULL DEFAULT '',
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_sat_questions_source_idx
  ON salt_morning.sat_questions (source_id) WHERE source_id <> '';

CREATE INDEX IF NOT EXISTS sm_sat_questions_filter_idx
  ON salt_morning.sat_questions (status, section, domain, difficulty);

CREATE INDEX IF NOT EXISTS sm_sat_questions_job_idx
  ON salt_morning.sat_questions (import_job_id, unit_idx);

CREATE TABLE IF NOT EXISTS salt_morning.sat_assets (
  id           TEXT PRIMARY KEY,
  question_id  TEXT NOT NULL REFERENCES salt_morning.sat_questions(id) ON DELETE CASCADE,
  ref          TEXT NOT NULL,
  page         INTEGER,
  box          JSONB,
  mime         TEXT NOT NULL DEFAULT 'image/png',
  width        INTEGER NOT NULL DEFAULT 0,
  height       INTEGER NOT NULL DEFAULT 0,
  data         BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, ref)
);
