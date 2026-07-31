-- Teacher-set school grade (1–12) used as Placement adaptive start ability
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS school_grade INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_school_grade_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_school_grade_check
      CHECK (school_grade IS NULL OR (school_grade BETWEEN 1 AND 12));
  END IF;
END $$;
