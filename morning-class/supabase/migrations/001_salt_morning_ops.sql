-- Salt Morning Class — dedicated ops schema
-- Lives on Salt Morning's OWN Postgres (Railway). Never touches Mr.Park Supabase tables.

CREATE SCHEMA IF NOT EXISTS salt_morning;

CREATE TABLE IF NOT EXISTS salt_morning.dollar_balances (
  student_id TEXT PRIMARY KEY,
  balance    NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salt_morning.dollar_transactions (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  class_id    TEXT NOT NULL DEFAULT '',
  student_id  TEXT NOT NULL,
  amount      NUMERIC NOT NULL,
  new_balance NUMERIC NOT NULL,
  reason      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sm_dollar_tx_student_idx
  ON salt_morning.dollar_transactions (student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS salt_morning.messenger_messages (
  message_id       TEXT PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  thread_id        TEXT NOT NULL,
  thread_type      TEXT NOT NULL DEFAULT 'student',
  class_id         TEXT NOT NULL DEFAULT '',
  student_id       TEXT NOT NULL DEFAULT '',
  student_name     TEXT NOT NULL DEFAULT '',
  sender_role      TEXT NOT NULL DEFAULT '',
  sender_id        TEXT NOT NULL DEFAULT '',
  sender_name      TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL DEFAULT '',
  target_audience  TEXT NOT NULL DEFAULT '',
  read_at          TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sm_msg_thread_idx
  ON salt_morning.messenger_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS sm_msg_unread_idx
  ON salt_morning.messenger_messages (target_audience, read_at)
  WHERE deleted_at IS NULL AND read_at IS NULL;

CREATE TABLE IF NOT EXISTS salt_morning.attendance_records (
  id           BIGSERIAL PRIMARY KEY,
  record_date  DATE NOT NULL,
  class_id     TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  attendance   TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  excuse       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (record_date, class_id, student_id)
);
CREATE INDEX IF NOT EXISTS sm_att_class_date_idx
  ON salt_morning.attendance_records (class_id, record_date);

CREATE TABLE IF NOT EXISTS salt_morning.parent_attendance_notices (
  notice_id    TEXT PRIMARY KEY,
  notice_date  DATE NOT NULL,
  student_id   TEXT NOT NULL,
  parent_id    TEXT NOT NULL DEFAULT '',
  notice_type  TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notice_date, student_id)
);
CREATE INDEX IF NOT EXISTS sm_pan_date_idx
  ON salt_morning.parent_attendance_notices (notice_date);

CREATE TABLE IF NOT EXISTS salt_morning.bus_noshows (
  noshow_id    TEXT PRIMARY KEY,
  noshow_date  DATE NOT NULL,
  run_id       TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  reported_by  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sm_bus_ns_date_idx
  ON salt_morning.bus_noshows (noshow_date, run_id)
  WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS salt_morning.bus_duty_daily (
  id           BIGSERIAL PRIMARY KEY,
  duty_date    DATE NOT NULL,
  run_id       TEXT NOT NULL,
  teacher_id   TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  actor_role   TEXT NOT NULL DEFAULT '',
  actor_id     TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (duty_date, run_id)
);

CREATE TABLE IF NOT EXISTS salt_morning.bus_change_log (
  log_id       TEXT PRIMARY KEY,
  log_date     DATE NOT NULL,
  run_id       TEXT NOT NULL DEFAULT '',
  student_id   TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',
  actor_role   TEXT NOT NULL DEFAULT '',
  actor_id     TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_bus_log_date_idx
  ON salt_morning.bus_change_log (log_date, created_at DESC);

CREATE TABLE IF NOT EXISTS salt_morning.push_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  parent_id    TEXT NOT NULL,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sm_push_parent_idx
  ON salt_morning.push_subscriptions (parent_id);

CREATE TABLE IF NOT EXISTS salt_morning.meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO salt_morning.meta (key, value)
VALUES ('schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
