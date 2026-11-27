-- Math workbook jobs and the Pre-Algebra chapter catalog.
CREATE TABLE IF NOT EXISTS salt_morning.math_chapters (
  id TEXT PRIMARY KEY,
  curriculum_id TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS salt_morning.math_workbooks (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL DEFAULT '',
  chapter_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  progress JSONB,
  options JSONB,
  document JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_math_workbooks_teacher_idx
  ON salt_morning.math_workbooks (teacher_id, updated_at DESC);
