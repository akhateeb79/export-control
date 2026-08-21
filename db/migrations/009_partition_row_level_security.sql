DO $$
DECLARE
  partition_name TEXT;
BEGIN
  FOR partition_name IN
    SELECT child.relname
    FROM pg_inherits inheritance
    JOIN pg_class parent ON parent.oid = inheritance.inhparent
    JOIN pg_class child ON child.oid = inheritance.inhrelid
    JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
    WHERE namespace.nspname = 'public'
      AND parent.relname IN ('audit_events', 'vendor_access_log')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', partition_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      partition_name
    );
  END LOOP;
END;
$$;