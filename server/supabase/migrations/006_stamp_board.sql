-- Stamp Board: per-student stamp positions on the class board
CREATE TABLE IF NOT EXISTS stamp_board_stamps (
  id          BIGSERIAL PRIMARY KEY,
  class_id    TEXT NOT NULL REFERENCES classes(id) ON UPDATE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE,
  x_pct       NUMERIC(5, 2) NOT NULL,
  y_pct       NUMERIC(5, 2) NOT NULL,
  rot_deg     SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stamp_board_class_idx ON stamp_board_stamps (class_id);
CREATE INDEX IF NOT EXISTS stamp_board_class_student_idx ON stamp_board_stamps (class_id, student_id);
