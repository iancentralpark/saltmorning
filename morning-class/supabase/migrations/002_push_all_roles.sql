ALTER TABLE salt_morning.push_subscriptions ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE salt_morning.push_subscriptions ADD COLUMN IF NOT EXISTS user_id TEXT;
UPDATE salt_morning.push_subscriptions
  SET role = COALESCE(NULLIF(role,''), 'parent'),
      user_id = COALESCE(NULLIF(user_id,''), parent_id)
  WHERE user_id IS NULL OR user_id = '' OR role IS NULL OR role = '';
ALTER TABLE salt_morning.push_subscriptions ALTER COLUMN parent_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS sm_push_role_user_idx
  ON salt_morning.push_subscriptions (role, user_id);
