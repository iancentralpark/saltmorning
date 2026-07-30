-- Vocab Grade System Rebuild: replace frequency-1..6000 engine with Grade 1-12 / tier-name
-- system + flat AI-generated word data (definition, Korean meaning, pre-baked cloze quiz).
-- Safe to run destructively: production has 0 rows in vocab_student_state/progress/daily_progress
-- and only 40 unused seed rows in vocab_words at the time of writing.

DROP TABLE IF EXISTS vocab_words CASCADE;

CREATE TABLE vocab_words (
  word_id               TEXT PRIMARY KEY,
  word                  TEXT NOT NULL,
  part_of_speech        TEXT,
  pronunciation         TEXT,
  grade_level           INTEGER NOT NULL CHECK (grade_level BETWEEN 1 AND 12),
  tier_name             TEXT NOT NULL,
  simple_definition     TEXT NOT NULL,
  korean_meaning        TEXT NOT NULL,
  example_sentence      TEXT NOT NULL,
  synonyms              JSONB NOT NULL DEFAULT '[]',
  antonyms              JSONB NOT NULL DEFAULT '[]',
  cloze_question        TEXT,
  wrong_options         JSONB,
  explanation_for_wrong TEXT,
  source                TEXT NOT NULL DEFAULT 'upload',
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vocab_words_grade_idx ON vocab_words (grade_level);
CREATE INDEX vocab_words_active_idx ON vocab_words (active);

ALTER TABLE vocab_words ENABLE ROW LEVEL SECURITY;

-- Re-link SRS progress rows to the recreated word table (CASCADE above dropped the old FK).
ALTER TABLE vocab_student_progress
  ADD CONSTRAINT vocab_student_progress_word_id_fkey
  FOREIGN KEY (word_id) REFERENCES vocab_words(word_id) ON UPDATE CASCADE ON DELETE CASCADE;

-- Student placement/rating now tracked on a discrete Grade 1-12 scale instead of frequency.
ALTER TABLE vocab_student_state
  DROP COLUMN IF EXISTS ability_freq,
  DROP COLUMN IF EXISTS tier_id,
  DROP COLUMN IF EXISTS start_frequency_level,
  ADD COLUMN IF NOT EXISTS grade_level INTEGER CHECK (grade_level BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS rating_score INTEGER NOT NULL DEFAULT 100;

-- Background AI batch-generation jobs for teacher word-bank uploads (paste / CSV / Excel).
CREATE TABLE IF NOT EXISTS vocab_gen_jobs (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'queued',
  total         INTEGER NOT NULL,
  completed     INTEGER NOT NULL DEFAULT 0,
  failed_words  JSONB NOT NULL DEFAULT '[]',
  pending       JSONB NOT NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vocab_gen_jobs ENABLE ROW LEVEL SECURITY;
