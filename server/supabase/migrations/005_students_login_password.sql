-- Teacher-visible portal password (synced with Google Sheet LoginPassword column).
-- Run in Supabase SQL Editor after Phase 1.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS login_password TEXT NOT NULL DEFAULT '';
