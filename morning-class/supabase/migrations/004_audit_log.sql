-- School-wide audit log (sheet fallback also exists in auditService.js)
CREATE TABLE IF NOT EXISTS salt_morning.audit_log (
  log_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_role TEXT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON salt_morning.audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON salt_morning.audit_log (action, created_at DESC);
