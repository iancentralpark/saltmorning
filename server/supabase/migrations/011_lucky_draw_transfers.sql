-- Lucky Draw ticket transfer audit log (teacher + student transfers)
CREATE TABLE IF NOT EXISTS lucky_draw_transfers (
  id            BIGSERIAL PRIMARY KEY,
  transfer_id   TEXT UNIQUE NOT NULL,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  class_id      TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,
  from_student_id TEXT NOT NULL,
  to_student_id   TEXT NOT NULL,
  tier          TEXT,
  prize_text    TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'teacher',
  actor_student_id TEXT
);

CREATE INDEX IF NOT EXISTS lucky_draw_transfers_class_at_idx
  ON lucky_draw_transfers (class_id, transferred_at DESC);

ALTER TABLE lucky_draw_transfers ENABLE ROW LEVEL SECURITY;
