-- Teacher Select Class button order
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (ORDER BY name ASC, id ASC) - 1)::integer AS rn
  FROM classes
)
UPDATE classes c
SET sort_order = ranked.rn
FROM ranked
WHERE c.id = ranked.id;

CREATE INDEX IF NOT EXISTS classes_sort_order_idx
  ON classes (sort_order, name);
