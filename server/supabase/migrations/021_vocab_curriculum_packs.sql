-- Phase 4/5: curriculum packs (optional per-tenant word subsets)

CREATE TABLE IF NOT EXISTS vocab_curriculum_packs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vocab_pack_words (
  pack_id  TEXT NOT NULL REFERENCES vocab_curriculum_packs(id) ON DELETE CASCADE,
  word_id  TEXT NOT NULL,
  PRIMARY KEY (pack_id, word_id)
);

CREATE INDEX IF NOT EXISTS vocab_pack_words_word_idx ON vocab_pack_words (word_id);

CREATE TABLE IF NOT EXISTS vocab_tenant_packs (
  tenant_id TEXT NOT NULL REFERENCES vocab_tenants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  pack_id   TEXT NOT NULL REFERENCES vocab_curriculum_packs(id) ON DELETE CASCADE,
  active    BOOLEAN NOT NULL DEFAULT true,
  priority  INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pack_id)
);

CREATE INDEX IF NOT EXISTS vocab_tenant_packs_pack_idx ON vocab_tenant_packs (pack_id);
