DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_readonly') THEN
    CREATE ROLE platform_readonly NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

REVOKE ALL PRIVILEGES ON
  users,
  tenant_thresholds,
  tenant_subscriptions,
  compliance_cases,
  parties,
  party_owners,
  case_parties,
  products,
  screening_results,
  classification_results,
  assessment_results,
  licence_determinations,
  licence_condition_evaluations,
  red_flag_records,
  case_documents,
  override_records,
  audit_events,
  vendor_access_log
FROM platform_readonly;

GRANT SELECT ON
  users,
  tenant_thresholds,
  tenant_subscriptions,
  compliance_cases,
  parties,
  party_owners,
  case_parties,
  products,
  screening_results,
  classification_results,
  assessment_results,
  licence_determinations,
  licence_condition_evaluations,
  red_flag_records,
  case_documents,
  override_records,
  audit_events,
  vendor_access_log
TO platform_readonly;