Export Control & Trade Compliance Platform
Technical Architecture Specification
Schema · API · ingestion · matching · knowledge base · deployment
Version 1.1 — amendment A-4 applied

## 1. System Topology

### 1.1 Runtime components

| Component | Deployment | Responsibility |
|---|---|---|
| API and web application | Reserved VM | Express REST API, React build, orchestrator, async worker process |
| Matching service | Same VM, separate process on an internal port | Deterministic name matching against the sanctions index |
| Ingestion job | Scheduled Deployment | Fetch, parse, normalise and version list sources |
| Database | Managed PostgreSQL | All persistent state |
| Object storage | Abstracted behind one interface | Uploaded documents and generated reports |

> The matching service is a separate process rather than a separate deployment because it is stateless, latency-sensitive, and called on every case. An internal HTTP call on localhost costs under a millisecond; a cross-deployment call costs tens.

### 1.2 Technology stack

| Layer | Choice | Reason |
|---|---|---|
| API | Node with Express | Simplest fit for REST, broad library support |
| Frontend | React | Confirmed |
| Matching | Python with rapidfuzz | C++ backed, handles the full index in milliseconds |
| Database | PostgreSQL | Row-level security is the isolation guarantee |
| Model access | Anthropic API over HTTPS | Direct, no intermediary |
| Jobs | Scheduled Deployment plus an in-process worker loop | Sufficient at this scale; no external queue needed |

---

## 2. Database Conventions

### 2.1 Primary key strategy

| Table nature | PK type | Examples |
|---|---|---|
| Reference with a stable natural key | VARCHAR code | countries.code = AE, list_sources.code = OFAC_SDN, workflow_states.code = BLOCKED |
| Control list entries | VARCHAR code | eccn_entries.eccn = 3A001 |
| Tenant transactional data | UUID | compliance_cases, case_parties, screening_results, audit_events |
| Platform configuration | SMALLINT or VARCHAR code | plans.code = PROFESSIONAL, lookup_types.code = PARTY_ROLE |
| High-volume append-only reference | BIGSERIAL | sanctions_entry_names |

> UUID for tenant data is not stylistic. Sequential integers leak transaction volume between tenants and are enumerable through the API. In a multi-tenant compliance product that is a disclosure risk, not a preference.

### 2.2 Universal columns

- Every tenant table carries tenant_id UUID NOT NULL with a foreign key to tenants
- Every table carries created_at and updated_at as TIMESTAMPTZ
- Every mutable table carries created_by and updated_by referencing users
- Audit and access log tables carry no updated columns — they are append-only by design

### 2.3 Referential integrity

- Every foreign key declared and enforced. No application-level-only relationships.
- ON DELETE RESTRICT is the default. Cascade is used only from a case to its owned children.
- Retention rules are enforced by trigger, not by application code, so no code path can bypass them.

---

## 3. Schema — Shared Reference

These tables hold no tenant_id. One copy serves every tenant. Updates propagate to all tenants simultaneously.

### 3.1 Geography and programmes

```
CREATE TABLE countries (
  code            VARCHAR(2) PRIMARY KEY,        -- ISO 3166-1 alpha-2
  name_en         TEXT NOT NULL,
  name_ar         TEXT,
  ear_group       VARCHAR(4),                    -- A:1, B, D:1, E:1 etc
  is_embargoed    BOOLEAN NOT NULL DEFAULT FALSE,
  diversion_risk  SMALLINT NOT NULL DEFAULT 0,   -- 0 to 5, platform maintained
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

```
CREATE TABLE embargo_programs (
  code            VARCHAR(24) PRIMARY KEY,       -- e.g. OFAC_IRAN, EU_RU_SECTORAL
  authority       VARCHAR(16) NOT NULL,
  name            TEXT NOT NULL,
  is_comprehensive BOOLEAN NOT NULL,             -- drives immutable rule IM-2
  effective_from  DATE NOT NULL
);
```

```
CREATE TABLE country_embargo_programs (
  country_code    VARCHAR(2) REFERENCES countries(code),
  program_code    VARCHAR(24) REFERENCES embargo_programs(code),
  PRIMARY KEY (country_code, program_code)
);
```

### 3.2 Sanctions — the normalised common schema

Every source is normalised into these four tables. The matching engine never knows which list a record came from.

```
CREATE TABLE list_sources (
  code            VARCHAR(24) PRIMARY KEY,       -- OFAC_SDN, BIS_ENTITY, BIS_DPL, BIS_UVL
  authority       VARCHAR(16) NOT NULL,
  name            TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  format          VARCHAR(8) NOT NULL,           -- XML, CSV, JSON
  is_blocking     BOOLEAN NOT NULL,              -- TRUE drives immutable rule IM-1
  sync_cron       VARCHAR(32) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

```
CREATE TABLE list_versions (
  id              UUID PRIMARY KEY,
  source_code     VARCHAR(24) NOT NULL REFERENCES list_sources(code),
  published_at    TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL,
  content_hash    CHAR(64) NOT NULL,             -- SHA-256, drives delta detection
  entry_count     INTEGER NOT NULL,
  added_count     INTEGER NOT NULL DEFAULT 0,
  removed_count   INTEGER NOT NULL DEFAULT 0,
  changed_count   INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(12) NOT NULL,          -- ACTIVE, SUPERSEDED, FAILED
  UNIQUE (source_code, content_hash)
);
```

```
CREATE TABLE sanctions_entries (
  id              UUID PRIMARY KEY,
  source_code     VARCHAR(24) NOT NULL REFERENCES list_sources(code),
  source_ref      TEXT NOT NULL,                 -- the publisher identifier
  entity_type     VARCHAR(12) NOT NULL,          -- INDIVIDUAL, ENTITY, VESSEL, AIRCRAFT
  programs        TEXT[],
  country_code    VARCHAR(2) REFERENCES countries(code),
  remarks         TEXT,
  first_seen_version UUID NOT NULL REFERENCES list_versions(id),
  last_seen_version  UUID NOT NULL REFERENCES list_versions(id),
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (source_code, source_ref)
);
```

```
CREATE TABLE sanctions_entry_names (
  id              BIGSERIAL PRIMARY KEY,
  entry_id        UUID NOT NULL REFERENCES sanctions_entries(id) ON DELETE CASCADE,
  name_type       VARCHAR(12) NOT NULL,          -- PRIMARY, AKA, FKA, LOW_QUALITY_AKA
  script          VARCHAR(8) NOT NULL DEFAULT 'LATIN',
  raw_name        TEXT NOT NULL,
  normalised_name TEXT NOT NULL,                 -- see section 6
  name_tokens     TEXT[] NOT NULL
);
CREATE INDEX idx_sen_norm ON sanctions_entry_names USING gin (name_tokens);
CREATE INDEX idx_sen_trgm ON sanctions_entry_names USING gin (normalised_name gin_trgm_ops);
```

> The trigram index is what makes screening fast enough to run inline. Enable pg_trgm before creating it. Candidate retrieval by trigram similarity reduces the comparison set from tens of thousands to tens before rapidfuzz scores them precisely.

```
CREATE TABLE sanctions_entry_identifiers (
  id              BIGSERIAL PRIMARY KEY,
  entry_id        UUID NOT NULL REFERENCES sanctions_entries(id) ON DELETE CASCADE,
  id_type         VARCHAR(32) NOT NULL,          -- PASSPORT, TAX_ID, REGISTRATION, IMO
  id_value        TEXT NOT NULL,
  country_code    VARCHAR(2) REFERENCES countries(code)
);
```

### 3.3 Control list

```
CREATE TABLE control_list_versions (
  id              UUID PRIMARY KEY,
  regime          VARCHAR(12) NOT NULL,          -- EAR, EU_DU
  version_label   TEXT NOT NULL,
  effective_from  DATE NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE
);
```

```
CREATE TABLE eccn_entries (
  eccn            VARCHAR(12) PRIMARY KEY,       -- 3A001
  version_id      UUID NOT NULL REFERENCES control_list_versions(id),
  category        SMALLINT NOT NULL,             -- 0 to 9, narrowing dimension 1
  product_group   CHAR(1) NOT NULL,              -- A to E, narrowing dimension 2
  heading         TEXT NOT NULL,
  full_text       TEXT NOT NULL,                 -- supplied to the model for candidates only
  reasons_for_control TEXT[] NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE
);
```

```
CREATE TABLE eccn_parameters (
  id              BIGSERIAL PRIMARY KEY,
  eccn            VARCHAR(12) NOT NULL REFERENCES eccn_entries(eccn),
  parameter_key   VARCHAR(48) NOT NULL,          -- narrowing dimension 3
  operator        VARCHAR(4) NOT NULL,           -- GT, GTE, LT, LTE, EQ, RANGE
  threshold_value NUMERIC,
  unit            VARCHAR(16)
);
CREATE INDEX idx_eccn_narrow ON eccn_entries (category, product_group) WHERE is_current;
```

```
CREATE TABLE licence_exceptions (
  code            VARCHAR(8) PRIMARY KEY,        -- STA, ENC, LVS, GBS, TSR, CIV
  regime          VARCHAR(12) NOT NULL,
  name            TEXT NOT NULL,
  full_text       TEXT NOT NULL
);
```

```
CREATE TABLE licence_exception_conditions (
  id              SMALLSERIAL PRIMARY KEY,
  exception_code  VARCHAR(8) NOT NULL REFERENCES licence_exceptions(code),
  sequence        SMALLINT NOT NULL,
  condition_text  TEXT NOT NULL,
  is_verifiable_automatically BOOLEAN NOT NULL DEFAULT FALSE
);
```

> Conditions are rows, not prose in a column. Immutable rule requires each to be evaluated and recorded individually as met, unmet or unverifiable. A single text blob makes that impossible.

---

## 4. Schema — Configuration Modules

These tables are what makes the platform configuration-driven. All are administered from the platform admin dashboard.

### 4.1 Lookups, messages, notifications

```
CREATE TABLE lookup_types (
  code            VARCHAR(32) PRIMARY KEY,       -- PARTY_ROLE, DOCUMENT_TYPE, RED_FLAG
  name            TEXT NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE -- system types cannot be deleted
);
```

```
CREATE TABLE lookup_values (
  id              SERIAL PRIMARY KEY,
  type_code       VARCHAR(32) NOT NULL REFERENCES lookup_types(code),
  value_code      VARCHAR(48) NOT NULL,
  label_key       VARCHAR(64) NOT NULL,          -- resolves via messages
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  metadata        JSONB,                         -- e.g. red flag weight and severity
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (type_code, value_code)
);
```

```
CREATE TABLE messages (
  message_key     VARCHAR(64) NOT NULL,
  locale          VARCHAR(5) NOT NULL,           -- en, ar
  content         TEXT NOT NULL,
  PRIMARY KEY (message_key, locale)
);
```

```
CREATE TABLE notification_rules (
  id              SERIAL PRIMARY KEY,
  event_code      VARCHAR(48) NOT NULL,          -- CASE_REVIEW_REQUIRED, LIST_UPDATE_URGENT
  recipient_rule  VARCHAR(32) NOT NULL,          -- ROLE:COMPLIANCE_OFFICER, PLATFORM_OPS
  channels        TEXT[] NOT NULL,               -- IN_APP, EMAIL
  template_key    VARCHAR(64) NOT NULL,
  is_urgent       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

### 4.2 Workflow

```
CREATE TABLE workflow_states (
  code            VARCHAR(24) PRIMARY KEY,       -- DRAFT, SCREENING, BLOCKED
  label_key       VARCHAR(64) NOT NULL,
  is_terminal     BOOLEAN NOT NULL DEFAULT FALSE,
  is_editable     BOOLEAN NOT NULL DEFAULT FALSE
);
```

```
CREATE TABLE workflow_transitions (
  id              SERIAL PRIMARY KEY,
  from_state      VARCHAR(24) NOT NULL REFERENCES workflow_states(code),
  to_state        VARCHAR(24) NOT NULL REFERENCES workflow_states(code),
  required_role   VARCHAR(32),                   -- null means system-initiated
  guard_expression TEXT,                         -- evaluated against case context
  requires_rationale BOOLEAN NOT NULL DEFAULT FALSE,
  is_system_locked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (from_state, to_state)
);
```

> is_system_locked marks transitions the immutable rules depend on. Any update or delete against a locked row is rejected by trigger. This is how a configuration-driven workflow still guarantees that no configuration can create a path from BLOCKED to APPROVED.

### 4.3 Thresholds with platform floors

```
CREATE TABLE threshold_definitions (
  code            VARCHAR(48) PRIMARY KEY,       -- SANCTIONS_CONFIRMED, CLASSIFY_MIN_CONF
  label_key       VARCHAR(64) NOT NULL,
  data_type       VARCHAR(8) NOT NULL,
  platform_floor  NUMERIC NOT NULL,              -- tenants may be stricter, never looser
  platform_default NUMERIC NOT NULL,
  stricter_is     VARCHAR(6) NOT NULL            -- HIGHER or LOWER
);
```

```
CREATE TABLE tenant_thresholds (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code            VARCHAR(48) NOT NULL REFERENCES threshold_definitions(code),
  value           NUMERIC NOT NULL,
  PRIMARY KEY (tenant_id, code)
);
-- Trigger enforces value against platform_floor per stricter_is direction.
```

### 4.4 Agents

```
CREATE TABLE agents (
  code            VARCHAR(24) PRIMARY KEY,       -- SANCTIONS, CLASSIFY, LICENCE
  name            TEXT NOT NULL,
  execution_order SMALLINT NOT NULL,
  is_deterministic BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

```
CREATE TABLE agent_versions (
  id              UUID PRIMARY KEY,
  agent_code      VARCHAR(24) NOT NULL REFERENCES agents(code),
  version_label   VARCHAR(16) NOT NULL,
  model_id        VARCHAR(48) NOT NULL,
  system_prompt   TEXT NOT NULL,
  max_tokens      INTEGER NOT NULL,
  temperature     NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  timeout_seconds SMALLINT NOT NULL DEFAULT 60,
  max_retries     SMALLINT NOT NULL DEFAULT 2,
  status          VARCHAR(12) NOT NULL,          -- DRAFT, PUBLISHED, ROLLED_BACK
  published_at    TIMESTAMPTZ,
  golden_set_score NUMERIC(5,2),
  UNIQUE (agent_code, version_label)
);
-- Rows with status PUBLISHED are immutable by trigger.
```

> Every result row records the agent_version id that produced it. Without this, a determination made two years ago cannot be reconstructed, because the prompt that produced it no longer exists in its original form.

### 4.5 Subscription and entitlement

```
CREATE TABLE plans (
  code            VARCHAR(24) PRIMARY KEY,       -- STARTER, PROFESSIONAL, ENTERPRISE
  name            TEXT NOT NULL,
  case_allowance  INTEGER,                       -- null means unlimited
  overage_rate    NUMERIC(8,4),
  user_seat_limit SMALLINT,
  api_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  retention_years SMALLINT NOT NULL DEFAULT 5,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

```
CREATE TABLE plan_agents (
  plan_code       VARCHAR(24) REFERENCES plans(code),
  agent_code      VARCHAR(24) REFERENCES agents(code),
  PRIMARY KEY (plan_code, agent_code)
);
```

```
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
```

---

## 5. Schema — Tenant Data

Every table in this section carries tenant_id and has row-level security enabled.

### 5.1 Core case tables

```
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
```

```
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
```

```
CREATE TABLE party_owners (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  owner_name      TEXT NOT NULL,
  ownership_pct   NUMERIC(5,2),
  source          VARCHAR(16) NOT NULL DEFAULT 'CLIENT_SUPPLIED'
);
```

> party_owners is how BR-3 is satisfied without a commercial data provider. The client supplies ownership from the trade licence; the platform screens those parties too. The source column makes the provenance explicit so the limitation is never obscured.

```
CREATE TABLE case_parties (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE CASCADE,
  party_id        UUID NOT NULL REFERENCES parties(id),
  party_role      VARCHAR(32) NOT NULL,          -- from lookup PARTY_ROLE
  UNIQUE (case_id, party_id, party_role)
);
```

```
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
```

### 5.2 Result tables

```
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
```

```
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
```

```
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
```

> One table, three typed rows, a unique constraint on the pair. End user and end use can never be written as a single combined value because the schema has no column to hold one. Immutable rule IM-10 is enforced by structure, not by discipline.

```
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
```

```
CREATE TABLE licence_condition_evaluations (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  determination_id UUID NOT NULL REFERENCES licence_determinations(id) ON DELETE CASCADE,
  condition_id    SMALLINT NOT NULL REFERENCES licence_exception_conditions(id),
  status          VARCHAR(16) NOT NULL,          -- MET, UNMET, UNVERIFIABLE
  evidence        TEXT
);
```

### 5.3 Red flags, documents, decisions

```
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
```

```
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
```

```
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
```

### 5.4 Audit and vendor access

Time-ordered UUID gives global uniqueness with sequential insert locality, avoiding the index fragmentation random keys cause on a high-volume table. The sequence column provides gap detection; hash chaining provides alteration detection. Together they yield tamper evidence, not only tamper prevention.

```
CREATE TABLE audit_events (
  id              UUID PRIMARY KEY,                     -- UUIDv7, time-ordered
  sequence_no     BIGINT GENERATED ALWAYS AS IDENTITY,  -- gap detection
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID REFERENCES compliance_cases(id),
  event_type      VARCHAR(48) NOT NULL,
  actor_type      VARCHAR(12) NOT NULL,                 -- USER, AGENT, SYSTEM
  actor_id        UUID,
  agent_version_id UUID REFERENCES agent_versions(id),
  before_state    JSONB,
  after_state     JSONB,
  rationale       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash       CHAR(64),          -- previous entry_hash for this tenant
  entry_hash      CHAR(64) NOT NULL  -- SHA256(prev_hash || canonical row)
) PARTITION BY RANGE (occurred_at);

CREATE UNIQUE INDEX idx_audit_seq  ON audit_events (tenant_id, sequence_no);
CREATE INDEX        idx_audit_case ON audit_events (tenant_id, case_id, occurred_at);

REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
CREATE RULE audit_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```

```
CREATE TABLE vendor_access_log (
  id              UUID PRIMARY KEY,                     -- UUIDv7
  sequence_no     BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID REFERENCES compliance_cases(id),
  platform_actor  VARCHAR(64) NOT NULL,
  platform_role   VARCHAR(24) NOT NULL,
  reason          TEXT NOT NULL,     -- mandatory before content is served
  ticket_ref      TEXT,
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash       CHAR(64),
  entry_hash      CHAR(64) NOT NULL
) PARTITION BY RANGE (accessed_at);
```

#### 5.4.1 Partition management

- Monthly partitions created ahead of need by a scheduled job
- Retention expiry becomes a partition drop, which is instant, rather than a mass delete that locks the table and bloats the heap
- Archival of an expiring partition to cold storage before drop, where the client has requested it

#### 5.4.2 Chain anchoring

Periodically record the head hash per tenant somewhere durable and separate: a monthly digest to the client compliance officer, or a write to append-only storage. If a client is later asked to prove their record was not altered after the fact, they verify the current chain against an anchor captured at a known past date. That is materially stronger than a vendor assurance of immutability, and it costs one scheduled job.

> This table is readable by the owning tenant. It is the mechanism that converts vendor accountability into a demonstrable control rather than an assurance.

---

## 6. Row-Level Security

### 6.1 Policy pattern

```
ALTER TABLE compliance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_cases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON compliance_cases
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Applied identically to every tenant table. FORCE is required so that the table owner is also subject to the policy.

### 6.2 The connection pooling trap

> This is the single most likely source of a cross-tenant data leak, and it is easy to miss.

With a connection pool, a plain SET persists on the physical connection after the request ends. The next request, potentially for a different tenant, inherits it. The isolation guarantee silently fails.

```
-- WRONG under pooling: value survives the request
SET app.tenant_id = '...';

-- CORRECT: scoped to the transaction, discarded on commit or rollback
BEGIN;
SET LOCAL app.tenant_id = '...';
-- all queries for this request
COMMIT;
```

Every request must open a transaction, set the tenant context with SET LOCAL, and run all queries inside it. This belongs in middleware, applied once, never per-handler.

### 6.3 Platform access path

Platform roles operate through a separate database role that bypasses tenant policy but is granted SELECT only on tenant tables. No INSERT, UPDATE or DELETE grant exists on any compliance record table for that role, so immutable rule IM-7 is enforced by permission rather than by application logic.

---

## 7. Name Matching

### 7.1 Pipeline

Stage 1 — normalise. Lowercase, strip punctuation and diacritics, collapse whitespace, remove legal suffixes and honorifics.

Stage 2 — generate variants. Apply the transliteration substitution table and particle rules to produce the candidate spelling set.

Stage 3 — retrieve candidates. Trigram similarity in PostgreSQL narrows tens of thousands of names to tens.

Stage 4 — score precisely. rapidfuzz computes token_set_ratio, token_sort_ratio and JaroWinkler for every variant against every candidate.

Stage 5 — resolve. Take the maximum score across all variants and all algorithms; record which variant and which algorithm produced it.

### 7.2 Normalisation rules

- Legal suffixes removed: LLC, L.L.C., FZE, FZCO, FZ-LLC, DMCC, EST, Establishment, Co, Company, Ltd, Limited, Trading, Gen Trdg, Group, Holding, International, Intl, PJSC, PSC, WLL, SPC
- Honorifics removed: Sheikh, Sh, Al Haj, Haji, Dr, Eng, Mr, Mrs, Sayed, Sayyid
- Diacritics folded to base Latin characters
- Hyphens and apostrophes converted to spaces, then whitespace collapsed
- Definite article handled as a variant rather than removed outright, because dropping it changes some names materially

### 7.3 Arabic transliteration substitutions

Rule-based and finite. This is not a task for a model — the mappings are well established and a deterministic table is faster, cheaper and reproducible in an audit.

| Arabic | Common Latin renderings |
|---|---|
| ال (definite article) | al, el, ul, al-, el-, or omitted |
| ة (ta marbuta, final) | a, ah, at, eh |
| ج | j, g, dj |
| ق | q, k, g, gh |
| خ | kh, ch, h, x |
| غ | gh, g, r |
| ث | th, s, t |
| ذ | dh, z, th, d |
| ض | d, dh, dt |
| ظ | z, dh, th |
| ع | a, aa, apostrophe, or omitted |
| ح | h, hh |
| ي (final) | i, y, ee, ie |
| و | w, u, oo, ou, o |
| ئ ؤ ء (hamza) | apostrophe or omitted |
| Doubled consonant (shadda) | single or doubled |

#### Name particles

- bin, ben, ibn, bn, b. — treated as interchangeable and optionally droppable
- abu, abo, abou, aboo — interchangeable
- abd, abdul, abdel, abdal, abd al, abd el — interchangeable, and the following element may join or separate
- umm, om — interchangeable

> Abdul Rahman, Abdulrahman, Abd al-Rahman and Abdel Rahman are the same name. A screening system that treats them as different names is not screening.

### 7.4 Scoring and thresholds

| Band | Default | Outcome |
|---|---|---|
| At or above confirmed threshold | 95 | CONFIRMED_HIT — immutable rule fires, case blocked |
| Between possible and confirmed | 82 to 94 | POSSIBLE_HIT — human review required |
| Below possible threshold | under 82 | CLEAR — recorded in the audit trail |

- Thresholds are tenant-configurable downward only. The platform floor prevents any tenant setting a confirmed threshold above the floor, which would let real matches through.
- Entries flagged as low-quality aliases by the publisher are scored with a configurable penalty rather than excluded, so they surface as possible hits rather than disappearing.
- Individuals and entities are scored separately; a person name matching a company name is suppressed unless the entity type is unknown.

### 7.5 Performance

A realistic case has six parties. Each generates roughly five variants. Trigram retrieval returns approximately fifty candidates per variant. That is fewer than two thousand precise comparisons per case, which rapidfuzz completes in well under a second on a single core.

---

## 8. Classification Knowledge Base

### 8.1 Two-stage narrowing

Supplying the entire control list to the model is impossible on cost and unreliable on accuracy. Retrieval alone produces approximate citations. The chosen approach is structured narrowing followed by focused reasoning.

| Stage | Operation | Model |
|---|---|---|
| 1 | Extract category, product group and salient technical parameters from the product description | Haiku — cheap, fast, structured output |
| 2 | Filter eccn_entries by category and product group, then by parameter thresholds | SQL — deterministic, no model |
| 3 | Supply full text of the five to ten surviving candidates and reason over them | Sonnet — the judgement step |
| 4 | Return the selected entry, the confidence, the reasoning, and why each rejected candidate was rejected | Sonnet |

### 8.2 Why this design

- Cost is bounded — the model sees ten entries, never the whole list
- Citations are exact, because the candidate set is drawn from structured records rather than similarity search
- The rejected candidates are recorded, which is what makes the determination defensible; a compliance officer can see what was considered
- When no candidate survives filtering, the case routes to human classification rather than the model guessing

### 8.3 Cache invalidation

A classification is bound to a control list version. When a new version becomes current, every classification made against a prior version has requires_revalidation set. The cached value is displayed with its date and version but cannot be reused for a new case until confirmed.

---

## 9. List Ingestion

### 9.1 Job sequence

- Fetch the source document over HTTPS
- Compute SHA-256 of the payload and compare against the latest list_versions row for that source
- If unchanged, record the check and exit
- If changed, parse according to the source format
- Normalise into sanctions_entries, names, identifiers and addresses
- Diff against the current set to derive added, removed and changed counts
- Insert the new list_version row and mark the prior one superseded within a single transaction
- Trigger the re-screening cascade

### 9.2 Re-screening cascade

```
-- Open cases involving an affected party return to screening
UPDATE compliance_cases SET state = 'SCREENING'
 WHERE id IN (SELECT case_id FROM affected_cases)
   AND state NOT IN (SELECT code FROM workflow_states WHERE is_terminal);

-- Approved cases within retention are flagged, not silently reopened
UPDATE compliance_cases SET requires_rescreen = TRUE
 WHERE id IN (SELECT case_id FROM affected_cases)
   AND state = 'APPROVED' AND retention_until >= CURRENT_DATE;
```

Where an approved case now involves a newly listed party, an urgent notification is dispatched immediately rather than batched.

### 9.3 Failure behaviour

- Fetch or parse failure leaves the prior version active and marked current
- The freshness indicator turns stale and appears on every screening result produced thereafter
- Platform operations is notified by email
- Screening continues, because stopping screening is more dangerous than screening against a slightly older list, provided the staleness is visible

---

## 10. API

### 10.1 Middleware chain

Applied in order to every request. No handler executes outside this chain.

| Order | Middleware | Failure response |
|---|---|---|
| 1 | Rate limiting by tenant and by IP | 429 |
| 2 | Token verification and signature check | 401 |
| 3 | Open transaction and SET LOCAL app.tenant_id | 500 |
| 4 | Subscription status check | 402 when suspended |
| 5 | Entitlement check for the requested capability | 403 |
| 6 | Role permission check | 403 |
| 7 | Handler execution | varies |
| 8 | Audit write, then commit | 500 with rollback |

> Steps 3 and 8 sit inside the same transaction. If the audit write fails, the business operation is rolled back with it. An action that is not recorded did not happen.

### 10.2 Endpoints

- POST /api/v1/auth/login — credentials, returns an MFA challenge
- POST /api/v1/auth/mfa — completes authentication, issues the access token
- POST /api/v1/auth/refresh — rotates the token
- POST /api/v1/cases — creates a case in DRAFT
- GET /api/v1/cases — lists with filters on state, risk, date and owner
- GET /api/v1/cases/{id} — full case with all six assessments rendered separately
- POST /api/v1/cases/{id}/documents — uploads and triggers extraction
- POST /api/v1/cases/{id}/confirm-extraction — accepts corrected field values
- POST /api/v1/cases/{id}/submit — moves to SCREENING and invokes the orchestrator
- GET /api/v1/cases/{id}/status — polling endpoint for asynchronous cases
- POST /api/v1/cases/{id}/decision — approve, block, escalate or close with rationale
- GET /api/v1/cases/{id}/report — generates and returns the compliance report
- GET /api/v1/queue/review and /queue/escalation — work queues
- GET /api/v1/access-log — the client-visible vendor access log
- GET /api/v1/audit/export — full record export in a regulator-readable form
- Platform administration under /api/v1/admin/, gated on platform role

### 10.3 Error taxonomy

| Code | Meaning | Example |
|---|---|---|
| VALIDATION_FAILED | Field-level rejection | Destination country not recognised |
| ENTITLEMENT_DENIED | Plan does not include the capability | API access on a Starter plan |
| PERMISSION_DENIED | Role lacks authority | Initiator attempting approval |
| IMMUTABLE_RULE | Action forbidden by a hard rule | Approval attempt on a blocked case |
| STALE_REFERENCE_DATA | List outside the freshness window | Screening halted, sync failed |
| AGENT_UNAVAILABLE | Model provider error after retries | Case held, not cleared |
| SUBSCRIPTION_SUSPENDED | Tenant suspended | New case creation refused, history readable |

> IMMUTABLE_RULE is returned rather than PERMISSION_DENIED deliberately. The distinction matters: the second implies a role with sufficient authority exists somewhere. For hard blocks, none does.

### 10.4 Synchronous and asynchronous routing

- The orchestrator estimates work from party count, document count and whether classification is cached
- Below the configured complexity threshold the request is served synchronously
- Above it, the case is queued and the client polls the status endpoint or receives a notification
- The routing threshold is configuration, not code

---

## 11. Security

- Passwords hashed with Argon2id; second factor mandatory for every role that can decide or configure
- Access tokens short-lived with rotating refresh tokens; hard session expiry with no silent extension
- Documents encrypted at rest; storage keys are opaque and never expose a provider path
- All secrets from environment variables; none present in the repository
- Uploads validated by content inspection, not by file extension
- Every mutating endpoint carries a distinct permission code checked against the role
- Platform role access to tenant content requires a reason string before the query executes
- Rate limits per tenant to prevent one tenant degrading another

---

## 12. Deployment and Portability

### 12.1 Topology

- Application on a Reserved VM — fixed cost, and a persistent process for the asynchronous worker
- Ingestion as a Scheduled Deployment on the configured cron
- Matching service as a second process on the same VM, bound to localhost
- Managed PostgreSQL with pg_trgm enabled

### 12.2 Portability rules

These determine whether migrating to regional hosting later is a two-week task or a rebuild.

- Standard PostgreSQL only — no platform-proprietary datastore for anything durable
- Every configuration value from environment variables; no hardcoded paths
- Standard Express and standard Python; no proprietary runtime features
- Authentication implemented in the application; never a platform-provided identity service
- Document storage behind a single interface so that swapping to object storage touches one file
- A Dockerfile maintained from the first commit, even though the current host does not require it
- Schema and migrations in version control, applied by migration tool, never by console
- No assumption that the filesystem persists between deployments

### 12.3 Build order

| Step | Deliverable | Why first |
|---|---|---|
| 1 | Ingestion pipeline and normalised schema | Everything depends on reference data existing |
| 2 | Matching service and sanctions agent | The highest-value agent, and deterministic so it is testable |
| 3 | Golden test set | Built alongside step 2, not after |
| 4 | Knowledge base and classification agent | Depends on the control list being loaded |
| 5 | Licence agent with its three assessment modules | Depends on steps 2 and 4 |
| 6 | Workflow, entitlement and administration modules | Depends on the domain being stable |
| 7 | Interface | Last, because it renders what already works |

---

> The platform recommends and evidences. The compliance officer determines.
