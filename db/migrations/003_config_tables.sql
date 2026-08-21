CREATE TABLE messages (
  message_key     VARCHAR(64) NOT NULL,
  locale          VARCHAR(5) NOT NULL,           -- en, ar
  content         TEXT NOT NULL,
  PRIMARY KEY (message_key, locale)
);

CREATE TABLE notification_rules (
  id              SERIAL PRIMARY KEY,
  event_code      VARCHAR(48) NOT NULL,          -- CASE_REVIEW_REQUIRED, LIST_UPDATE_URGENT
  recipient_rule  VARCHAR(32) NOT NULL,          -- ROLE:COMPLIANCE_OFFICER, PLATFORM_OPS
  channels        TEXT[] NOT NULL,               -- IN_APP, EMAIL
  template_key    VARCHAR(64) NOT NULL,
  is_urgent       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE workflow_states (
  code            VARCHAR(24) PRIMARY KEY,       -- DRAFT, SCREENING, BLOCKED
  label_key       VARCHAR(64) NOT NULL,
  is_terminal     BOOLEAN NOT NULL DEFAULT FALSE,
  is_editable     BOOLEAN NOT NULL DEFAULT FALSE
);

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

CREATE TABLE threshold_definitions (
  code              VARCHAR(48) PRIMARY KEY,     -- SANCTIONS_CONFIRMED, CLASSIFY_MIN_CONF
  label_key         VARCHAR(64) NOT NULL,
  data_type         VARCHAR(8) NOT NULL,
  platform_floor    NUMERIC NOT NULL,            -- tenants may be stricter, never looser
  platform_default  NUMERIC NOT NULL,
  stricter_is       VARCHAR(6) NOT NULL          -- HIGHER or LOWER
);

CREATE TABLE agents (
  code            VARCHAR(24) PRIMARY KEY,       -- SANCTIONS, CLASSIFY, LICENCE
  name            TEXT NOT NULL,
  execution_order SMALLINT NOT NULL,
  is_deterministic BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

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

CREATE TABLE plan_agents (
  plan_code       VARCHAR(24) REFERENCES plans(code),
  agent_code      VARCHAR(24) REFERENCES agents(code),
  PRIMARY KEY (plan_code, agent_code)
);