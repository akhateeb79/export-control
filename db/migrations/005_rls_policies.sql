ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_thresholds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_thresholds
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE compliance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compliance_cases
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON parties
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE party_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_owners FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON party_owners
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE case_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_parties
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE screening_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE screening_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON screening_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE classification_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON classification_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assessment_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE licence_determinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_determinations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON licence_determinations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE licence_condition_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_condition_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON licence_condition_evaluations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE red_flag_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_flag_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON red_flag_records
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_documents
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE override_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE override_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON override_records
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);