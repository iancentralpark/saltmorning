-- Custom attendance/tool roster order per class
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (PARTITION BY class_id ORDER BY name ASC) - 1)::integer AS rn
  FROM students
)
UPDATE students s
SET sort_order = ranked.rn
FROM ranked
WHERE s.id = ranked.id;

CREATE INDEX IF NOT EXISTS students_class_sort_idx
  ON students (class_id, sort_order, name);
