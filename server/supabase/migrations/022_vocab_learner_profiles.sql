-- Optional display metadata for platform admin (name / school / class labels)
CREATE TABLE IF NOT EXISTS vocab_learner_profiles (
  tenant_id    TEXT NOT NULL REFERENCES vocab_tenants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  student_id   TEXT NOT NULL,
  name         TEXT,
  school_name  TEXT,
  class_id     TEXT,
  class_name   TEXT,
  school_grade INTEGER,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, student_id)
);

CREATE INDEX IF NOT EXISTS vocab_learner_profiles_name_idx
  ON vocab_learner_profiles (tenant_id, name);
