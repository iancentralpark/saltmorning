-- SAT mistake review: one note per question a student missed (or left blank) in a finished test.
-- stage: blind (retry without the answer) -> verify (a new question of the same kind) -> done.

CREATE TABLE IF NOT EXISTS salt_morning.sat_review_notes (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES salt_morning.sat_sessions(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL,
  question_id         TEXT NOT NULL REFERENCES salt_morning.sat_questions(id),
  module_key          TEXT NOT NULL DEFAULT '',
  position            INTEGER NOT NULL DEFAULT 0,
  first_answer        TEXT NOT NULL DEFAULT '',
  stage               TEXT NOT NULL DEFAULT 'blind',
  blind_attempts      INTEGER NOT NULL DEFAULT 0,
  blind_wrong         JSONB NOT NULL DEFAULT '[]'::jsonb,
  blind_correct       BOOLEAN,
  verify_question_id  TEXT,
  verify_history      JSONB NOT NULL DEFAULT '[]'::jsonb,
  exhausted           BOOLEAN NOT NULL DEFAULT false,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS sm_sat_review_notes_student_idx
  ON salt_morning.sat_review_notes (student_id, stage);

CREATE INDEX IF NOT EXISTS sm_sat_review_notes_session_idx
  ON salt_morning.sat_review_notes (session_id);
