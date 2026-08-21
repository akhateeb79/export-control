-- Slice 4 authentication state. Existing migrations remain immutable.
CREATE TABLE auth_credentials (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  mfa_secret      TEXT,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_sessions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      CHAR(64) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  replaced_by     UUID REFERENCES refresh_sessions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_sessions_user ON refresh_sessions (tenant_id, user_id, expires_at);

ALTER TABLE refresh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refresh_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);