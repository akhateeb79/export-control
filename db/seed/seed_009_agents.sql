INSERT INTO agents (code, name, execution_order, is_deterministic) VALUES
  ('CLASSIFY', 'Product Classification', 10, FALSE),
  ('SANCTIONS', 'Sanctions Screening', 20, TRUE),
  ('END_USER', 'End User Assessment', 30, FALSE),
  ('END_USE', 'End Use Assessment', 40, FALSE),
  ('RISK', 'Risk Assessment', 50, TRUE),
  ('LICENCE', 'Licence Decision', 60, FALSE),
  ('DOCUMENT', 'Document Intelligence', 70, FALSE),
  ('AUDIT', 'Audit and Monitoring', 80, TRUE),
  ('INTELLIGENCE', 'Compliance Intelligence', 90, FALSE)
ON CONFLICT (code) DO NOTHING;