-- Gradebook hot path: weights, assessment columns, and scores.
CREATE TABLE IF NOT EXISTS salt_morning.grade_weights (
  weight_id         TEXT PRIMARY KEY,
  class_id          TEXT NOT NULL,
  term              TEXT NOT NULL,
  subject           TEXT NOT NULL,
  category_key      TEXT NOT NULL,
  label             TEXT NOT NULL DEFAULT '',
  weight_percent    NUMERIC NOT NULL DEFAULT 0,
  aggregation       TEXT NOT NULL DEFAULT 'average',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  default_max_score NUMERIC NOT NULL DEFAULT 100,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, term, subject, category_key)
);
CREATE INDEX IF NOT EXISTS sm_gw_class_idx
  ON salt_morning.grade_weights (class_id, term, subject);

CREATE TABLE IF NOT EXISTS salt_morning.grade_assessments (
  assessment_id TEXT PRIMARY KEY,
  class_id      TEXT NOT NULL,
  term          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  category_key  TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  assess_date   DATE NOT NULL,
  max_score     NUMERIC NOT NULL DEFAULT 100,
  teacher_id    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_ga_class_idx
  ON salt_morning.grade_assessments (class_id, term, subject, assess_date);

CREATE TABLE IF NOT EXISTS salt_morning.grade_entries (
  record_id      TEXT PRIMARY KEY,
  class_id       TEXT NOT NULL,
  student_id     TEXT NOT NULL,
  subject        TEXT NOT NULL,
  entry_date     DATE NOT NULL,
  score          NUMERIC NOT NULL DEFAULT 0,
  max_score      NUMERIC NOT NULL DEFAULT 100,
  category_key   TEXT NOT NULL DEFAULT '',
  teacher_id     TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assessment_id  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sm_ge_class_subj_idx
  ON salt_morning.grade_entries (class_id, subject, entry_date);
CREATE INDEX IF NOT EXISTS sm_ge_assessment_idx
  ON salt_morning.grade_entries (assessment_id, student_id);
CREATE INDEX IF NOT EXISTS sm_ge_student_idx
  ON salt_morning.grade_entries (student_id, class_id);
CREATE UNIQUE INDEX IF NOT EXISTS sm_ge_assessment_student_uidx
  ON salt_morning.grade_entries (assessment_id, student_id)
  WHERE assessment_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS sm_ge_daily_uidx
  ON salt_morning.grade_entries (class_id, student_id, subject, entry_date, category_key)
  WHERE assessment_id = '';

INSERT INTO salt_morning.meta (key, value)
VALUES ('schema_version', '5')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
