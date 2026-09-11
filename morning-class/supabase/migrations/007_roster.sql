-- Salt Morning roster master data (classes / students / teachers / parents).
-- TEXT ids match existing gradebook and Sheets IDs — no cascading deletes into grades.

CREATE TABLE IF NOT EXISTS salt_morning.classes (
  class_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  schedule_type  TEXT NOT NULL DEFAULT 'Mon-Fri',
  allowed_days   TEXT NOT NULL DEFAULT '1,2,3,4,5',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salt_morning.students (
  student_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  class_id       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'Enrolled',
  login_id       TEXT NOT NULL DEFAULT '',
  login_password TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sm_students_login_uidx
  ON salt_morning.students (login_id) WHERE login_id <> '';
CREATE INDEX IF NOT EXISTS sm_students_class_idx
  ON salt_morning.students (class_id) WHERE class_id <> '';

CREATE TABLE IF NOT EXISTS salt_morning.student_profiles (
  student_id         TEXT PRIMARY KEY,
  photo_path         TEXT NOT NULL DEFAULT '',
  date_of_birth      TEXT NOT NULL DEFAULT '',
  gender             TEXT NOT NULL DEFAULT '',
  nationality        TEXT NOT NULL DEFAULT '',
  address            TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  parent_name        TEXT NOT NULL DEFAULT '',
  parent_phone       TEXT NOT NULL DEFAULT '',
  parent_email       TEXT NOT NULL DEFAULT '',
  emergency_contact  TEXT NOT NULL DEFAULT '',
  emergency_phone    TEXT NOT NULL DEFAULT '',
  previous_school    TEXT NOT NULL DEFAULT '',
  grade_level        TEXT NOT NULL DEFAULT '',
  enrolled_date      TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salt_morning.student_profile_fields (
  field_id    TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  section     TEXT NOT NULL DEFAULT '',
  label       TEXT NOT NULL DEFAULT '',
  value       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sm_spf_student_idx
  ON salt_morning.student_profile_fields (student_id, section, sort_order);

CREATE TABLE IF NOT EXISTS salt_morning.teachers (
  teacher_id         TEXT PRIMARY KEY,
  name               TEXT NOT NULL DEFAULT '',
  login_id           TEXT NOT NULL DEFAULT '',
  login_password     TEXT NOT NULL DEFAULT '',
  homeroom_class_ids TEXT NOT NULL DEFAULT '',
  staff_role         TEXT NOT NULL DEFAULT 'Teacher',
  head_teacher_id    TEXT NOT NULL DEFAULT '',
  permissions_json   TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sm_teachers_login_uidx
  ON salt_morning.teachers (login_id) WHERE login_id <> '';

CREATE TABLE IF NOT EXISTS salt_morning.teacher_profiles (
  teacher_id         TEXT PRIMARY KEY,
  photo_path         TEXT NOT NULL DEFAULT '',
  date_of_birth      TEXT NOT NULL DEFAULT '',
  gender             TEXT NOT NULL DEFAULT '',
  nationality        TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  address            TEXT NOT NULL DEFAULT '',
  emergency_contact  TEXT NOT NULL DEFAULT '',
  emergency_phone    TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  hire_date          TEXT NOT NULL DEFAULT '',
  education          TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  preferred_name     TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salt_morning.class_teachers (
  class_id         TEXT NOT NULL,
  teacher_id       TEXT NOT NULL,
  assignment_type  TEXT NOT NULL DEFAULT 'Subject',
  subject          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (class_id, teacher_id, assignment_type, subject)
);
CREATE INDEX IF NOT EXISTS sm_ct_teacher_idx
  ON salt_morning.class_teachers (teacher_id);

CREATE TABLE IF NOT EXISTS salt_morning.parents (
  parent_id          TEXT PRIMARY KEY,
  legacy_student_id  TEXT NOT NULL DEFAULT '',
  name               TEXT NOT NULL DEFAULT '',
  login_id           TEXT NOT NULL DEFAULT '',
  login_password     TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sm_parents_login_uidx
  ON salt_morning.parents (login_id) WHERE login_id <> '';

CREATE TABLE IF NOT EXISTS salt_morning.parent_students (
  link_id       TEXT PRIMARY KEY,
  parent_id     TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  relationship  TEXT NOT NULL DEFAULT 'Guardian',
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, student_id)
);
CREATE INDEX IF NOT EXISTS sm_ps_student_idx
  ON salt_morning.parent_students (student_id);
