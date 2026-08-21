-- Credentials remain tenant-isolated; unauthenticated lookup is narrowly exposed
-- through a security-definer function rather than table privileges.
ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_credentials
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_lookup_owner') THEN
    CREATE ROLE auth_lookup_owner NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT SELECT ON auth_credentials TO auth_lookup_owner;

CREATE OR REPLACE FUNCTION lookup_auth_credential(p_email TEXT)
RETURNS TABLE (
  user_id UUID,
  tenant_id UUID,
  email TEXT,
  password_hash TEXT,
  mfa_secret TEXT,
  mfa_enabled BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.user_id, c.tenant_id, c.email, c.password_hash, c.mfa_secret, c.mfa_enabled
    FROM auth_credentials c
   WHERE c.email = lower(trim(p_email))
   LIMIT 1;
$$;

ALTER FUNCTION lookup_auth_credential(TEXT) OWNER TO auth_lookup_owner;
REVOKE ALL ON FUNCTION lookup_auth_credential(TEXT) FROM PUBLIC;

DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION lookup_auth_credential(TEXT) TO %I', current_user);
END;
$$;