CREATE TABLE audit_events (
  id              UUID NOT NULL,                          -- UUIDv7, time-ordered
  sequence_no     BIGINT GENERATED ALWAYS AS IDENTITY,    -- gap detection
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID REFERENCES compliance_cases(id),
  event_type      VARCHAR(48) NOT NULL,
  actor_type      VARCHAR(12) NOT NULL,                   -- USER, AGENT, SYSTEM
  actor_id        UUID,
  agent_version_id UUID REFERENCES agent_versions(id),
  before_state    JSONB,
  after_state     JSONB,
  rationale       TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash       CHAR(64),          -- previous entry_hash for this tenant
  entry_hash      CHAR(64) NOT NULL, -- SHA256(prev_hash || canonical row)
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE UNIQUE INDEX idx_audit_seq  ON audit_events (tenant_id, sequence_no, occurred_at);
CREATE INDEX        idx_audit_case ON audit_events (tenant_id, case_id, occurred_at);

CREATE TABLE vendor_access_log (
  id              UUID NOT NULL,                          -- UUIDv7
  sequence_no     BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  case_id         UUID REFERENCES compliance_cases(id),
  platform_actor  VARCHAR(64) NOT NULL,
  platform_role   VARCHAR(24) NOT NULL,
  reason          TEXT NOT NULL,     -- mandatory before content is served
  ticket_ref      TEXT,
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash       CHAR(64),
  entry_hash      CHAR(64) NOT NULL,
  PRIMARY KEY (id, accessed_at)
) PARTITION BY RANGE (accessed_at);

DO $$
DECLARE
  partition_start DATE;
  partition_end DATE;
  month_offset INTEGER;
BEGIN
  FOR month_offset IN 0..3 LOOP
    partition_start := (date_trunc('month', CURRENT_DATE) + (month_offset || ' months')::INTERVAL)::DATE;
    partition_end := (partition_start + INTERVAL '1 month')::DATE;

    EXECUTE format(
      'CREATE TABLE audit_events_%s PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      to_char(partition_start, 'YYYY_MM'),
      partition_start,
      partition_end
    );

    EXECUTE format(
      'CREATE TABLE vendor_access_log_%s PARTITION OF vendor_access_log FOR VALUES FROM (%L) TO (%L)',
      to_char(partition_start, 'YYYY_MM'),
      partition_start,
      partition_end
    );
  END LOOP;
END;
$$;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE vendor_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_access_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);