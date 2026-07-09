-- Phase 4: Class log (lesson/homework/writing + per-student daily marks)
-- Run in Supabase SQL editor after phases 1–3.

create table if not exists class_log_daily (
  class_id text not null,
  log_date date not null,
  lesson text,
  homework text,
  writing text,
  updated_at timestamptz not null default now(),
  primary key (class_id, log_date)
);

create table if not exists class_log_student_marks (
  class_id text not null,
  student_name text not null,
  log_date date not null,
  mark text not null,
  updated_at timestamptz not null default now(),
  primary key (class_id, student_name, log_date)
);

create index if not exists class_log_daily_date_idx on class_log_daily (log_date);
create index if not exists class_log_marks_date_idx on class_log_student_marks (log_date);
create index if not exists class_log_marks_class_idx on class_log_student_marks (class_id, log_date);
