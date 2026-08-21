-- Keep the security-definer lookup independent of the function owner's schema search permissions.
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
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.user_id, c.tenant_id, c.email, c.password_hash, c.mfa_secret, c.mfa_enabled
    FROM public.auth_credentials c
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