-- Slice 5: tenant-safe product classification request, result, and job lifecycle.

BEGIN;

ALTER TABLE compliance_cases
  ADD CONSTRAINT compliance_cases_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE products
  ADD COLUMN product_fingerprint CHAR(64),
  ADD CONSTRAINT products_tenant_id_id_unique UNIQUE (tenant_id, id),
  ADD CONSTRAINT products_fingerprint_format_check
    CHECK (product_fingerprint IS NULL OR product_fingerprint ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX products_tenant_fingerprint_unique
  ON products (tenant_id, product_fingerprint)
  WHERE product_fingerprint IS NOT NULL;

CREATE TABLE case_products (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL,
  product_id      UUID NOT NULL,
  product_snapshot JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, product_id),
  FOREIGN KEY (tenant_id, case_id)
    REFERENCES compliance_cases(tenant_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX idx_case_products_case ON case_products (tenant_id, case_id);

ALTER TABLE classification_results
  ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'CLASSIFIED',
  ADD COLUMN requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cited_entry TEXT,
  ADD COLUMN cached BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD CONSTRAINT classification_results_status_check
    CHECK (status IN (
      'PENDING',
      'CLASSIFIED',
      'EAR99',
      'INSUFFICIENT_INFORMATION',
      'CANDIDATE_SET_INADEQUATE',
      'NEEDS_HUMAN_REVIEW',
      'FAILED'
    )),
  ADD CONSTRAINT classification_results_confidence_check
    CHECK (confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT classification_results_outcome_check
    CHECK (
      (status = 'EAR99' AND is_ear99 = TRUE AND eccn IS NULL)
      OR (status <> 'EAR99')
    ),
  ADD CONSTRAINT classification_results_case_tenant_fk
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES compliance_cases(tenant_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT classification_results_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT classification_results_tenant_id_id_unique UNIQUE (tenant_id, id);

UPDATE classification_results
   SET completed_at = created_at
 WHERE status IN ('CLASSIFIED', 'EAR99')
   AND completed_at IS NULL;

CREATE INDEX idx_classification_reusable
  ON classification_results (
    tenant_id,
    product_id,
    control_list_version_id,
    created_at DESC
  )
  WHERE status IN ('CLASSIFIED', 'EAR99')
    AND requires_revalidation = FALSE;
CREATE INDEX idx_classification_case
  ON classification_results (tenant_id, case_id, product_id, created_at DESC);

CREATE TABLE classification_agent_runs (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  classification_result_id UUID NOT NULL REFERENCES classification_results(id) ON DELETE CASCADE,
  stage           VARCHAR(16) NOT NULL,
  agent_version_id UUID NOT NULL REFERENCES agent_versions(id),
  status          VARCHAR(16) NOT NULL,
  input_hash      CHAR(64) NOT NULL,
  output          JSONB NOT NULL,
  error_code      VARCHAR(48),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT classification_agent_runs_stage_check
    CHECK (stage IN ('EXTRACTION', 'REASONING')),
  CONSTRAINT classification_agent_runs_status_check
    CHECK (status IN ('COMPLETED', 'FAILED')),
  CONSTRAINT classification_agent_runs_tenant_result_fk
    FOREIGN KEY (tenant_id, classification_result_id)
    REFERENCES classification_results(tenant_id, id)
    ON DELETE CASCADE
);
CREATE INDEX idx_classification_agent_runs_result
  ON classification_agent_runs (tenant_id, classification_result_id, stage);

CREATE TABLE classification_jobs (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL,
  case_product_id UUID NOT NULL REFERENCES case_products(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  requested_by    UUID REFERENCES users(id),
  control_list_version_id UUID REFERENCES control_list_versions(id),
  classification_result_id UUID REFERENCES classification_results(id),
  status          VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  attempts        SMALLINT NOT NULL DEFAULT 0,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_code      VARCHAR(48),
  error_detail    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT classification_jobs_status_check
    CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT classification_jobs_case_tenant_fk
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES compliance_cases(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT classification_jobs_product_tenant_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX classification_jobs_active_request_unique
  ON classification_jobs (tenant_id, case_product_id, request_fingerprint)
  WHERE status IN ('QUEUED', 'PROCESSING');
CREATE INDEX idx_classification_jobs_claim
  ON classification_jobs (status, available_at, created_at)
  WHERE status = 'QUEUED';

ALTER TABLE case_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_products
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE classification_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_agent_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON classification_agent_runs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE classification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON classification_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY tenant_isolation ON products;
CREATE POLICY tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY tenant_isolation ON classification_results;
CREATE POLICY tenant_isolation ON classification_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMIT;