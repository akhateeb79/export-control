CREATE TABLE countries (
  code            VARCHAR(2) PRIMARY KEY,        -- ISO 3166-1 alpha-2
  name_en         TEXT NOT NULL,
  name_ar         TEXT,
  ear_group       VARCHAR(4),                    -- A:1, B, D:1, E:1 etc
  is_embargoed    BOOLEAN NOT NULL DEFAULT FALSE,
  diversion_risk  SMALLINT NOT NULL DEFAULT 0,   -- 0 to 5, platform maintained
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE embargo_programs (
  code            VARCHAR(24) PRIMARY KEY,       -- e.g. OFAC_IRAN, EU_RU_SECTORAL
  authority       VARCHAR(16) NOT NULL,
  name            TEXT NOT NULL,
  is_comprehensive BOOLEAN NOT NULL,             -- drives immutable rule IM-2
  effective_from  DATE NOT NULL
);

CREATE TABLE country_embargo_programs (
  country_code    VARCHAR(2) REFERENCES countries(code),
  program_code    VARCHAR(24) REFERENCES embargo_programs(code),
  PRIMARY KEY (country_code, program_code)
);

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

CREATE TABLE sanctions_entry_identifiers (
  id              BIGSERIAL PRIMARY KEY,
  entry_id        UUID NOT NULL REFERENCES sanctions_entries(id) ON DELETE CASCADE,
  id_type         VARCHAR(32) NOT NULL,          -- PASSPORT, TAX_ID, REGISTRATION, IMO
  id_value        TEXT NOT NULL,
  country_code    VARCHAR(2) REFERENCES countries(code)
);

CREATE TABLE control_list_versions (
  id              UUID PRIMARY KEY,
  regime          VARCHAR(12) NOT NULL,          -- EAR, EU_DU
  version_label   TEXT NOT NULL,
  effective_from  DATE NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE
);

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

CREATE TABLE eccn_parameters (
  id              BIGSERIAL PRIMARY KEY,
  eccn            VARCHAR(12) NOT NULL REFERENCES eccn_entries(eccn),
  parameter_key   VARCHAR(48) NOT NULL,          -- narrowing dimension 3
  operator        VARCHAR(4) NOT NULL,           -- GT, GTE, LT, LTE, EQ, RANGE
  threshold_value NUMERIC,
  unit            VARCHAR(16)
);
CREATE INDEX idx_eccn_narrow ON eccn_entries (category, product_group) WHERE is_current;

CREATE TABLE licence_exceptions (
  code            VARCHAR(8) PRIMARY KEY,        -- STA, ENC, LVS, GBS, TSR, CIV
  regime          VARCHAR(12) NOT NULL,
  name            TEXT NOT NULL,
  full_text       TEXT NOT NULL
);

CREATE TABLE licence_exception_conditions (
  id              SMALLSERIAL PRIMARY KEY,
  exception_code  VARCHAR(8) NOT NULL REFERENCES licence_exceptions(code),
  sequence        SMALLINT NOT NULL,
  condition_text  TEXT NOT NULL,
  is_verifiable_automatically BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE lookup_types (
  code            VARCHAR(32) PRIMARY KEY,       -- PARTY_ROLE, DOCUMENT_TYPE, RED_FLAG
  name            TEXT NOT NULL,
  is_system       BOOLEAN NOT NULL DEFAULT FALSE -- system types cannot be deleted
);

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