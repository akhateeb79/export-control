INSERT INTO lookup_types (code, name, is_system) VALUES
  ('PARTY_ROLE', 'Party role', TRUE),
  ('DOCUMENT_TYPE', 'Document type', TRUE),
  ('RED_FLAG', 'Red flag', TRUE),
  ('CASE_STATE', 'Case state', TRUE),
  ('AGENT_TYPE', 'Agent type', TRUE)
ON CONFLICT (code) DO NOTHING;