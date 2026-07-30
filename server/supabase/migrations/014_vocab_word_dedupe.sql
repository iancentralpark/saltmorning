-- One row per vocabulary word (case-insensitive).
-- Adds word_key, backfills it, collapses duplicate rows, and enforces uniqueness.
-- Safe while student progress is empty / CASCADE-linked.

ALTER TABLE vocab_words
  ADD COLUMN IF NOT EXISTS word_key TEXT;

UPDATE vocab_words
SET word_key = lower(trim(word))
WHERE word_key IS NULL OR word_key = '';

-- Keep the newest row per word_key; drop the rest.
DELETE FROM vocab_words a
USING vocab_words b
WHERE a.word_key IS NOT NULL
  AND b.word_key IS NOT NULL
  AND a.word_key = b.word_key
  AND a.word_id <> b.word_id
  AND (
    COALESCE(a.updated_at, a.created_at, '-infinity'::timestamptz)
      < COALESCE(b.updated_at, b.created_at, '-infinity'::timestamptz)
    OR (
      COALESCE(a.updated_at, a.created_at, '-infinity'::timestamptz)
        = COALESCE(b.updated_at, b.created_at, '-infinity'::timestamptz)
      AND a.word_id < b.word_id
    )
  );

-- Canonicalize word_id to w_<slug> (grade no longer part of the id).
-- Two-step via temp id to avoid primary-key collisions during rename.
UPDATE vocab_words
SET word_id = 'tmp_' || word_id
WHERE word_id NOT LIKE 'tmp_%'
  AND word_id <> ('w_' || trim(both '_' from regexp_replace(word_key, '[^a-z0-9]+', '_', 'g')));

UPDATE vocab_words
SET word_id = 'w_' || trim(both '_' from regexp_replace(word_key, '[^a-z0-9]+', '_', 'g'))
WHERE word_id LIKE 'tmp_%';

CREATE UNIQUE INDEX IF NOT EXISTS vocab_words_word_key_uidx
  ON vocab_words (word_key);
