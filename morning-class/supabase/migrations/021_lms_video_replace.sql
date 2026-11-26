-- In-progress file replacement for a library video.
-- The live video_uid keeps playing until the new Cloudflare asset is ready.

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS replace_video_uid TEXT NOT NULL DEFAULT '';

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS replace_status TEXT NOT NULL DEFAULT '';

ALTER TABLE salt_morning.lms_library_videos
  ADD COLUMN IF NOT EXISTS replace_status_message TEXT NOT NULL DEFAULT '';
