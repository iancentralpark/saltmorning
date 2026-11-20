-- Central video library (curriculum catalog) + richer watch analytics.
-- Class assignments (lms_lessons) can point at a shared library video.

CREATE TABLE IF NOT EXISTS salt_morning.lms_library_videos (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  category         TEXT NOT NULL DEFAULT '',
  curriculum       TEXT NOT NULL DEFAULT '',
  provider         TEXT NOT NULL DEFAULT 'cloudflare',
  video_uid        TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'uploading',
  status_message   TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sm_lms_library_cat_idx
  ON salt_morning.lms_library_videos (category, curriculum, created_at DESC);

CREATE INDEX IF NOT EXISTS sm_lms_library_status_idx
  ON salt_morning.lms_library_videos (status, updated_at DESC);

ALTER TABLE salt_morning.lms_lessons
  ADD COLUMN IF NOT EXISTS library_video_id TEXT;

CREATE INDEX IF NOT EXISTS sm_lms_lessons_library_idx
  ON salt_morning.lms_lessons (library_video_id);

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS last_playback_rate REAL NOT NULL DEFAULT 1;

ALTER TABLE salt_morning.lms_progress
  ADD COLUMN IF NOT EXISTS max_percent INTEGER NOT NULL DEFAULT 0;

-- Backfill: one library row per existing class lesson (shared video stays on CF once).
INSERT INTO salt_morning.lms_library_videos (
  id, title, description, category, curriculum, provider, video_uid,
  status, status_message, duration_seconds, created_by, created_at, updated_at
)
SELECT
  'lib_' || substr(md5(l.id), 1, 12),
  l.title,
  COALESCE(l.description, ''),
  'Migrated',
  COALESCE(l.class_id, ''),
  COALESCE(l.provider, 'cloudflare'),
  COALESCE(l.video_uid, ''),
  COALESCE(l.status, 'uploading'),
  COALESCE(l.status_message, ''),
  l.duration_seconds,
  COALESCE(l.created_by, ''),
  l.created_at,
  l.updated_at
FROM salt_morning.lms_lessons l
WHERE l.library_video_id IS NULL
  AND COALESCE(l.video_uid, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM salt_morning.lms_library_videos v WHERE v.video_uid = l.video_uid
  );

UPDATE salt_morning.lms_lessons l
SET library_video_id = v.id
FROM salt_morning.lms_library_videos v
WHERE l.library_video_id IS NULL
  AND l.video_uid <> ''
  AND v.video_uid = l.video_uid;
