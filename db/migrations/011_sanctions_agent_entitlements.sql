-- Slice 4 configuration is data, not hardcoded API behavior.
INSERT INTO agents (code, name, execution_order, is_deterministic, is_active)
VALUES ('SANCTIONS', 'Sanctions Screening', 1, TRUE, TRUE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  execution_order = EXCLUDED.execution_order,
  is_deterministic = EXCLUDED.is_deterministic,
  is_active = EXCLUDED.is_active;

INSERT INTO plan_agents (plan_code, agent_code)
VALUES
  ('PROFESSIONAL', 'SANCTIONS'),
  ('ENTERPRISE', 'SANCTIONS')
ON CONFLICT DO NOTHING;