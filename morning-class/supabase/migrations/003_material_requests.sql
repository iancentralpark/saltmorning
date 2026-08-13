-- Teaching material purchase requests (Teacher → Admin)
CREATE TABLE IF NOT EXISTS salt_morning.material_requests (
  request_id     TEXT PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  teacher_id     TEXT NOT NULL,
  teacher_name   TEXT NOT NULL DEFAULT '',
  class_id       TEXT NOT NULL DEFAULT '',
  class_name     TEXT NOT NULL DEFAULT '',
  subject        TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  item_name      TEXT NOT NULL DEFAULT '',
  quantity       NUMERIC NOT NULL DEFAULT 1,
  unit_price     NUMERIC NOT NULL DEFAULT 0,
  total_price    NUMERIC NOT NULL DEFAULT 0,
  purchase_link  TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'requested',
  admin_note     TEXT NOT NULL DEFAULT '',
  purchased_by   TEXT NOT NULL DEFAULT '',
  purchased_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sm_mat_req_status_idx
  ON salt_morning.material_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS sm_mat_req_teacher_idx
  ON salt_morning.material_requests (teacher_id, created_at DESC);

INSERT INTO salt_morning.meta (key, value)
VALUES ('schema_version', '3')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
