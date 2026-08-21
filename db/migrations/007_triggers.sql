CREATE OR REPLACE FUNCTION enforce_tenant_threshold_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  definition threshold_definitions%ROWTYPE;
BEGIN
  SELECT * INTO definition
  FROM threshold_definitions
  WHERE code = NEW.code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Threshold definition % does not exist', NEW.code;
  END IF;

  IF definition.stricter_is = 'HIGHER' AND NEW.value < definition.platform_floor THEN
    RAISE EXCEPTION 'Tenant threshold % cannot be below the platform floor %',
      NEW.code, definition.platform_floor;
  ELSIF definition.stricter_is = 'LOWER' AND NEW.value > definition.platform_floor THEN
    RAISE EXCEPTION 'Tenant threshold % cannot be above the platform floor %',
      NEW.code, definition.platform_floor;
  ELSIF definition.stricter_is NOT IN ('HIGHER', 'LOWER') THEN
    RAISE EXCEPTION 'Threshold % has an invalid stricter_is value %',
      NEW.code, definition.stricter_is;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_threshold_floor_enforcement
BEFORE INSERT OR UPDATE ON tenant_thresholds
FOR EACH ROW EXECUTE FUNCTION enforce_tenant_threshold_floor();

CREATE OR REPLACE FUNCTION protect_system_locked_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system_locked THEN
    RAISE EXCEPTION 'System-locked workflow transition % cannot be modified or deleted', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_transition_system_lock_guard
BEFORE UPDATE OR DELETE ON workflow_transitions
FOR EACH ROW EXECUTE FUNCTION protect_system_locked_transition();

CREATE OR REPLACE FUNCTION protect_published_agent_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published agent version % cannot be modified or deleted', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER published_agent_version_guard
BEFORE UPDATE OR DELETE ON agent_versions
FOR EACH ROW EXECUTE FUNCTION protect_published_agent_version();

CREATE OR REPLACE FUNCTION prevent_append_only_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only and cannot be modified or deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification();

CREATE TRIGGER vendor_access_log_append_only
BEFORE UPDATE OR DELETE ON vendor_access_log
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_modification();

CREATE OR REPLACE FUNCTION prevent_pre_retention_case_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.retention_until > CURRENT_DATE THEN
    RAISE EXCEPTION 'Compliance case % cannot be deleted before its retention date', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER compliance_case_retention_guard
BEFORE DELETE ON compliance_cases
FOR EACH ROW EXECUTE FUNCTION prevent_pre_retention_case_deletion();