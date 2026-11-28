-- SAT mock tests: sets, assignments, a student's sitting, and the answers given.
-- A set holds six module lists: rw1, rw2e, rw2h, m1, m2e, m2h (the second module of each
-- section has an easier and a harder version; a student only ever sees one of them).

CREATE TABLE IF NOT EXISTS salt_morning.sat_test_sets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  structure    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS salt_morning.sat_test_set_items (
  set_id       TEXT NOT NULL REFERENCES salt_morning.sat_test_sets(id) ON DELETE CASCADE,
  module_key   TEXT NOT NULL,
  position     INTEGER NOT NULL,
  question_id  TEXT NOT NULL REFERENCES salt_morning.sat_questions(id),
  PRIMARY KEY (set_id, module_key, position)
);

CREATE INDEX IF NOT EXISTS sm_sat_test_set_items_question_idx
  ON salt_morning.sat_test_set_items (question_id);

CREATE TABLE IF NOT EXISTS salt_morning.sat_assignments (
  id              TEXT PRIMARY KEY,
  set_id          TEXT NOT NULL REFERENCES salt_morning.sat_test_sets(id) ON DELETE CASCADE,
  target_type     TEXT NOT NULL DEFAULT 'class',
  class_id        TEXT NOT NULL DEFAULT '',
  class_name      TEXT NOT NULL DEFAULT '',
  student_id      TEXT NOT NULL DEFAULT '',
  student_name    TEXT NOT NULL DEFAULT '',
  available_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ,
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sm_sat_assignments_set_idx
  ON salt_morning.sat_assignments (set_id);
CREATE INDEX IF NOT EXISTS sm_sat_assignments_class_idx
  ON salt_morning.sat_assignments (class_id);
CREATE INDEX IF NOT EXISTS sm_sat_assignments_student_idx
  ON salt_morning.sat_assignments (student_id);

CREATE TABLE IF NOT EXISTS salt_morning.sat_sessions (
  id               TEXT PRIMARY KEY,
  set_id           TEXT NOT NULL REFERENCES salt_morning.sat_test_sets(id) ON DELETE CASCADE,
  assignment_id    TEXT REFERENCES salt_morning.sat_assignments(id) ON DELETE SET NULL,
  student_id       TEXT NOT NULL DEFAULT '',
  student_name     TEXT NOT NULL DEFAULT '',
  class_id         TEXT NOT NULL DEFAULT '',
  is_preview       BOOLEAN NOT NULL DEFAULT false,
  step             TEXT NOT NULL DEFAULT 'rw1',
  step_started_at  TIMESTAMPTZ,
  step_deadline    TIMESTAMPTZ,
  route_rw         TEXT NOT NULL DEFAULT '',
  route_math       TEXT NOT NULL DEFAULT '',
  module_results   JSONB NOT NULL DEFAULT '{}'::jsonb,
  result           JSONB,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_sat_sessions_student_idx
  ON salt_morning.sat_sessions (student_id);
CREATE INDEX IF NOT EXISTS sm_sat_sessions_assignment_idx
  ON salt_morning.sat_sessions (assignment_id);
CREATE UNIQUE INDEX IF NOT EXISTS sm_sat_sessions_one_per_assignment
  ON salt_morning.sat_sessions (assignment_id, student_id) WHERE assignment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS salt_morning.sat_answers (
  session_id   TEXT NOT NULL REFERENCES salt_morning.sat_sessions(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES salt_morning.sat_questions(id),
  module_key   TEXT NOT NULL,
  position     INTEGER NOT NULL,
  answer       TEXT NOT NULL DEFAULT '',
  marked       BOOLEAN NOT NULL DEFAULT false,
  eliminated   JSONB NOT NULL DEFAULT '[]'::jsonb,
  time_ms      INTEGER NOT NULL DEFAULT 0,
  is_correct   BOOLEAN,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS sm_sat_answers_question_idx
  ON salt_morning.sat_answers (question_id);

CREATE TABLE IF NOT EXISTS salt_morning.sat_score_tables (
  section     TEXT NOT NULL,
  route       TEXT NOT NULL,
  points      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (section, route)
)
;
