CREATE TABLE IF NOT EXISTS app_state (
  owner_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_state_updated_at_idx ON app_state(updated_at DESC);
