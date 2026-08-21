-- The architecture references tenants and users but does not include their DDL.
-- These two root tables are the minimum dependency definitions required by the
-- documented foreign keys and tenant isolation policy.
CREATE TABLE tenants (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  status          VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  email           TEXT NOT NULL,
  role            VARCHAR(32) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE tenant_thresholds (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code            VARCHAR(48) NOT NULL REFERENCES threshold_definitions(code),
  value           NUMERIC NOT NULL,
  PRIMARY KEY (tenant_id, code)
);

CREATE TABLE tenant_subscriptions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  plan_code       VARCHAR(24) NOT NULL REFERENCES plans(code),
  status          VARCHAR(12) NOT NULL,          -- TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  cases_used      INTEGER NOT NULL DEFAULT 0,
  overage_cases   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE compliance_cases (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_ref        TEXT NOT NULL,                 -- tenant-visible sequence
  state           VARCHAR(24) NOT NULL REFERENCES workflow_states(code),
  destination_country VARCHAR(2) NOT NULL REFERENCES countries(code),
  stated_end_use  TEXT NOT NULL,
  incoterms       VARCHAR(8),
  planned_ship_date DATE,
  overall_risk    VARCHAR(8),                    -- LOW, MEDIUM, HIGH, BLOCKED
  fired_rule_code VARCHAR(16),                   -- which immutable rule, if any
  requires_rescreen BOOLEAN NOT NULL DEFAULT FALSE,
  decided_by      UUID REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_rationale TEXT,
  retention_until DATE NOT NULL,                 -- deletion blocked before this date
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_ref)
);
CREATE INDEX idx_case_queue ON compliance_cases (tenant_id, state, created_at DESC);
CREATE INDEX idx_case_rescreen ON compliance_cases (tenant_id) WHERE requires_rescreen;

CREATE TABLE parties (
  id              UUID PRIMARY KEY,              -- tenant party registry
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  legal_name      TEXT NOT NULL,
  name_script     VARCHAR(8) NOT NULL DEFAULT 'LATIN',
  original_script_name TEXT,                     -- Arabic retained alongside Latin
  country_code    VARCHAR(2) REFERENCES countries(code),
  address         TEXT,
  address_type    VARCHAR(24),                   -- PREMISES, PO_BOX, CORPORATE_SECRETARY
  registration_no TEXT,
  incorporated_on DATE,
  website         TEXT
);

CREATE TABLE party_owners (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  owner_name      TEXT NOT NULL,
  ownership_pct   NUMERIC(5,2),
  source          VARCHAR(16) NOT NULL DEFAULT 'CLIENT_SUPPLIED'
);

CREATE TABLE case_parties (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE CASCADE,
  party_id        UUID NOT NULL REFERENCES parties(id),
  party_role      VARCHAR(32) NOT NULL,          -- from lookup PARTY_ROLE
  UNIQUE (case_id, party_id, party_role)
);

CREATE TABLE products (
  id              UUID PRIMARY KEY,              -- tenant product catalogue
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  part_number     TEXT,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  specifications  JSONB,
  origin_country  VARCHAR(2) REFERENCES countries(code),
  us_content_pct  NUMERIC(5,2),
  UNIQUE (tenant_id, part_number)
);

CREATE TABLE screening_results (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id),
  party_id        UUID NOT NULL REFERENCES parties(id),
  source_code     VARCHAR(24) NOT NULL REFERENCES list_sources(code),
  list_version_id UUID NOT NULL REFERENCES list_versions(id),
  status          VARCHAR(16) NOT NULL,          -- CLEAR, POSSIBLE_HIT, CONFIRMED_HIT
  top_score       NUMERIC(5,2) NOT NULL,
  matched_entry_id UUID REFERENCES sanctions_entries(id),
  triggering_variant TEXT,                       -- which spelling caused the match
  screened_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CLEAR rows are written too. Absence of a match is itself a compliance record.

CREATE TABLE classification_results (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  case_id         UUID REFERENCES compliance_cases(id),   -- null when from catalogue
  agent_version_id UUID NOT NULL REFERENCES agent_versions(id),
  control_list_version_id UUID NOT NULL REFERENCES control_list_versions(id),
  eccn            VARCHAR(12),                   -- null when EAR99
  is_ear99        BOOLEAN NOT NULL DEFAULT FALSE,
  confidence      NUMERIC(5,2) NOT NULL,
  reasoning       TEXT NOT NULL,
  candidates_considered TEXT[] NOT NULL,          -- and why each was rejected
  rejection_reasons JSONB NOT NULL,
  requires_revalidation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assessment_results (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id),
  assessment_type VARCHAR(12) NOT NULL,          -- END_USER, END_USE, RISK
  agent_version_id UUID NOT NULL REFERENCES agent_versions(id),
  score           NUMERIC(5,2) NOT NULL,
  reasoning       TEXT NOT NULL,
  signals         JSONB NOT NULL,
  regulatory_basis TEXT,
  catchall_triggered VARCHAR(24),                -- end use only
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (case_id, assessment_type)
);

CREATE TABLE licence_determinations (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id),
  agent_version_id UUID NOT NULL REFERENCES agent_versions(id),
  outcome         VARCHAR(24) NOT NULL,          -- NLR, EXCEPTION, REQUIRED, PROHIBITED
  exception_code  VARCHAR(8) REFERENCES licence_exceptions(code),
  regulatory_basis TEXT NOT NULL,
  required_authority VARCHAR(16),
  reasoning       TEXT NOT NULL
);

CREATE TABLE licence_condition_evaluations (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  determination_id UUID NOT NULL REFERENCES licence_determinations(id) ON DELETE CASCADE,
  condition_id    SMALLINT NOT NULL REFERENCES licence_exception_conditions(id),
  status          VARCHAR(16) NOT NULL,          -- MET, UNMET, UNVERIFIABLE
  evidence        TEXT
);

CREATE TABLE red_flag_records (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE CASCADE,
  flag_code       VARCHAR(48) NOT NULL,          -- from lookup RED_FLAG
  observation     TEXT,
  observed_by     UUID NOT NULL REFERENCES users(id),
  resolution_status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  resolution_rationale TEXT,
  resolved_by     UUID REFERENCES users(id)
);

CREATE TABLE case_documents (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id),
  document_type   VARCHAR(32) NOT NULL,
  storage_key     TEXT NOT NULL,                 -- abstracted, not a provider URL
  original_filename TEXT NOT NULL,
  detected_language VARCHAR(5),
  extraction_status VARCHAR(16) NOT NULL,
  extracted_fields JSONB,
  field_confidence JSONB,
  confirmed_by    UUID REFERENCES users(id)
);

CREATE TABLE override_records (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id),
  system_recommendation VARCHAR(24) NOT NULL,
  human_decision  VARCHAR(24) NOT NULL,
  rationale       TEXT NOT NULL,
  actor_id        UUID NOT NULL REFERENCES users(id),
  actor_role      VARCHAR(32) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);