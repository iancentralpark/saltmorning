-- Oral Novel Debrief — Book Debrief Profiles (Phase 1)
-- Full book text is NOT stored long-term; only profile JSON (+ short excerpt).

CREATE TABLE IF NOT EXISTS salt_morning.debrief_books (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  author             TEXT NOT NULL DEFAULT '',
  grade_band         TEXT NOT NULL DEFAULT 'middle',
  lexile_level       TEXT,
  source_type        TEXT NOT NULL DEFAULT 'text',
  source_excerpt     TEXT NOT NULL DEFAULT '',
  novel_study_job_id TEXT,
  debrief_profile    JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_verified        BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'ready',
  progress           INTEGER NOT NULL DEFAULT 100,
  message            TEXT NOT NULL DEFAULT '',
  error              TEXT,
  created_by         TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_debrief_books_updated_idx
  ON salt_morning.debrief_books (updated_at DESC);

CREATE INDEX IF NOT EXISTS sm_debrief_books_creator_idx
  ON salt_morning.debrief_books (created_by, updated_at DESC);

CREATE INDEX IF NOT EXISTS sm_debrief_books_verified_idx
  ON salt_morning.debrief_books (is_verified, updated_at DESC);

-- Class assignments (Phase 2 stub — table ready, APIs later)
CREATE TABLE IF NOT EXISTS salt_morning.debrief_assignments (
  id                   TEXT PRIMARY KEY,
  class_id             TEXT NOT NULL,
  book_id              TEXT NOT NULL REFERENCES salt_morning.debrief_books(id) ON DELETE RESTRICT,
  title                TEXT NOT NULL,
  custom_instructions  TEXT NOT NULL DEFAULT '',
  due_date             TEXT,
  created_by           TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_debrief_assignments_class_idx
  ON salt_morning.debrief_assignments (class_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS sm_debrief_assignments_book_idx
  ON salt_morning.debrief_assignments (book_id);
