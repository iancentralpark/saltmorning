-- Per-viewer chat hide (KakaoTalk-style leave).
-- Hiding a thread only affects that person's list. Messages stay for everyone else.
-- A newer message after hidden_at makes the thread reappear.

CREATE TABLE IF NOT EXISTS salt_morning.messenger_thread_hides (
  viewer_key TEXT NOT NULL,
  thread_id  TEXT NOT NULL,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_key, thread_id)
);
